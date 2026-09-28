#!/usr/bin/env node

// Comment hygiene gate: inline comments stay short and carry no ticket IDs or
// dates, because history belongs in git and review threads, not the source.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const MAX_BLOCK_LINES = 6
const MAX_SHOWN = 80

const EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|sh|yml|yaml)$/u
const EXCLUDED_PREFIXES = ['supabase/snippets/']
// Files whose comments are data or quoted third-party text.
const EXEMPT = new Set([])

const R1_PATTERNS = [
  /\b(?:PS|WI|TA|TMOS|EOT|SEC|ADV)-\d+/u,
  /\bPR #\d+/iu,
  /\bissue #\d+/iu,
  /\bcodex #\d+/iu
]
const R2_PATTERN = /\b20\d\d-[01]\d-[0-3]\d\b/u

// Tool directives are machine-read, so they never count or violate.
const DIRECTIVE_PREFIX =
  /^(?:eslint-|eslint\b|global\s|@ts-|prettier-ignore|istanbul\b|c8\b|@vitest-environment|<reference\b|webpackChunkName|webpackPrefetch|webpackPreload|shellcheck\b|deno-lint-ignore|deno-fmt-ignore|@deno-types|@jsx|target-db:|census_kept_|squawk|yaml-language-server|zizmor\b|@license|@preserve|#region|#endregion|biome-ignore|knip-ignore|@refresh\b)/u
const DIRECTIVE_ANYWHERE = /(?:trufflehog:ignore|gitleaks:allow)/u
const LICENCE =
  /(?:SPDX-License-Identifier|\bCopyright\b|\bLicen[cs]ed under\b)/u

function isGenerated(text) {
  const head = text.split('\n', 5).join('\n')
  return /GENERATED|DO NOT EDIT|@generated/u.test(head)
}

function eligible(file) {
  if (!EXTENSIONS.test(file)) return false
  if (file.split('/').includes('node_modules')) return false
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) return false
  return !EXEMPT.has(file)
}

// Each extractor returns blocks of { line, lines: [{ line, text }] }, text stripped.

function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function lineOf(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

function isFullLine(text, starts, offset) {
  const line = lineOf(starts, offset)
  return /^\s*$/u.test(text.slice(starts[line - 1], offset))
}

function stripBlockLine(raw) {
  return raw
    .replace(/^\s*\/\*+/u, '')
    .replace(/\*+\/\s*$/u, '')
    .replace(/^\s*\*(?!\/)/u, '')
    .trim()
}

// Groups single-line comments on consecutive full lines into one block.
function groupLineComments(comments) {
  const blocks = []
  let current = null
  for (const c of comments) {
    if (c.block) {
      current = null
      blocks.push({ line: c.line, lines: c.lines, block: true })
      continue
    }
    if (
      current &&
      c.fullLine &&
      current.fullLine &&
      c.line === current.lastLine + 1
    ) {
      current.block.lines.push(...c.lines)
      current.lastLine = c.line
      continue
    }
    const block = { line: c.line, lines: [...c.lines] }
    blocks.push(block)
    current = { block, lastLine: c.line, fullLine: c.fullLine }
  }
  return blocks
}

function scriptKind(file) {
  if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX
  if (/\.(?:ts|mts|cts)$/u.test(file)) return ts.ScriptKind.TS
  return ts.ScriptKind.JSX
}

function extractJsComments(text, file = 'input.ts') {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file)
  )
  const ranges = new Map()
  const jsxText = []
  const add = (list) => {
    for (const r of list ?? []) ranges.set(r.pos, r)
  }
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      jsxText.push([node.pos, node.end])
    }
    const children = node.getChildren(source)
    if (children.length === 0) {
      add(ts.getLeadingCommentRanges(text, node.pos))
      add(ts.getTrailingCommentRanges(text, node.end))
      return
    }
    for (const child of children) visit(child)
  }
  visit(source)
  add(ts.getLeadingCommentRanges(text, source.endOfFileToken.pos))
  // Text such as `<p>// x</p>` is JSX content, not a comment.
  const inJsxText = (pos) => jsxText.some(([s, e]) => pos >= s && pos < e)
  const starts = lineStarts(text)
  const comments = [...ranges.values()]
    .filter((r) => !inJsxText(r.pos))
    .sort((a, b) => a.pos - b.pos)
    .map((r) => {
      const raw = text.slice(r.pos, r.end)
      const line = lineOf(starts, r.pos)
      if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) {
        const body = raw.replace(/^\/\/\/?/u, '').trim()
        return {
          line,
          fullLine: isFullLine(text, starts, r.pos),
          lines: [{ line, text: body }]
        }
      }
      return {
        line,
        block: true,
        lines: raw
          .split('\n')
          .map((l, i) => ({ line: line + i, text: stripBlockLine(l) }))
      }
    })
  return groupLineComments(comments)
}

const IDENT_CHAR = /[A-Za-z0-9_$]/u

function extractSqlComments(text, { skipDollarBodies = false } = {}) {
  const starts = lineStarts(text)
  const comments = []
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '-' && next === '-') {
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      const line = lineOf(starts, i)
      comments.push({
        line,
        fullLine: isFullLine(text, starts, i),
        lines: [{ line, text: text.slice(i + 2, end).trim() }]
      })
      i = end
      continue
    }
    if (c === '/' && next === '*') {
      let depth = 1
      let j = i + 2
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth += 1
          j += 2
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth -= 1
          j += 2
        } else j += 1
      }
      const line = lineOf(starts, i)
      comments.push({
        line,
        block: true,
        lines: text
          .slice(i, j)
          .split('\n')
          .map((l, k) => ({ line: line + k, text: stripBlockLine(l) }))
      })
      i = j
      continue
    }
    const prev = i > 0 ? text[i - 1] : ''
    if (c === "'") {
      const escapes = /[Ee]/u.test(prev) && !IDENT_CHAR.test(text[i - 2] ?? '')
      let j = i + 1
      while (j < text.length) {
        if (escapes && text[j] === '\\') j += 2
        else if (text[j] === "'" && text[j + 1] === "'") j += 2
        else if (text[j] === "'") break
        else j += 1
      }
      i = j + 1
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < text.length) {
        if (text[j] === '"' && text[j + 1] === '"') j += 2
        else if (text[j] === '"') break
        else j += 1
      }
      i = j + 1
      continue
    }
    if (c === '$' && !IDENT_CHAR.test(prev)) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(text.slice(i, i + 64))
      if (m) {
        // Migration function bodies are deployed source later migrations hash, so they are frozen.
        if (skipDollarBodies) {
          const close = text.indexOf(m[0], i + m[0].length)
          i = close === -1 ? text.length : close + m[0].length
        } else i += m[0].length
        continue
      }
    }
    i += 1
  }
  return groupLineComments(comments)
}

const HASH_DIRECTIVE =
  /^#\s*(?:shellcheck\b|yaml-language-server\b|zizmor\b|gitleaks:allow|trufflehog:ignore)/u

function extractHashComments(text, { shell = false } = {}) {
  const comments = []
  const lines = text.split('\n')
  let heredoc = null
  lines.forEach((raw, idx) => {
    const line = idx + 1
    if (heredoc) {
      const body = heredoc.strip ? raw.replace(/^\t+/u, '') : raw
      if (body === heredoc.word) heredoc = null
      return
    }
    if (shell) {
      // Heredoc bodies are data (often another language), not shell comments.
      const m = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/u.exec(
        raw.replace(/#.*$/u, '')
      )
      if (m && !/<<</u.test(raw)) heredoc = { word: m[3], strip: m[1] === '-' }
    }
    if (!/^\s*#/u.test(raw)) return
    if (line === 1 && raw.startsWith('#!')) return
    const trimmed = raw.trim()
    if (HASH_DIRECTIVE.test(trimmed)) return
    comments.push({
      line,
      fullLine: true,
      lines: [{ line, text: trimmed.replace(/^#+/u, '').trim() }]
    })
  })
  return groupLineComments(comments)
}

function extractComments(file, text) {
  if (/\.sql$/u.test(file))
    return extractSqlComments(text, {
      skipDollarBodies: file.startsWith('supabase/migrations/')
    })
  if (/\.sh$/u.test(file)) return extractHashComments(text, { shell: true })
  if (/\.ya?ml$/u.test(file)) return extractHashComments(text)
  return extractJsComments(text, file)
}

function isDirective(content) {
  return DIRECTIVE_PREFIX.test(content) || DIRECTIVE_ANYWHERE.test(content)
}

function shown(text) {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > MAX_SHOWN ? `${flat.slice(0, MAX_SHOWN - 3)}...` : flat
}

function checkText(file, text) {
  if (isGenerated(text)) return []
  const violations = []
  for (const block of extractComments(file, text)) {
    const all = block.lines.map((l) => l.text).join('\n')
    if (LICENCE.test(all)) continue
    // A /* */ comment that opens with a directive is wholly a directive.
    const first = block.lines.find((l) => l.text !== '')
    if (block.block && first && isDirective(first.text)) continue
    const content = block.lines.filter(
      (l) => l.text !== '' && !isDirective(l.text)
    )
    for (const l of content) {
      const r1 = R1_PATTERNS.map((p) => p.exec(l.text)).find(Boolean)
      if (r1) {
        violations.push(
          `${file}:${l.line}: R1: ticket/PR reference "${r1[0]}" in comment: ${shown(l.text)}`
        )
      }
      const r2 = R2_PATTERN.exec(l.text)
      if (r2) {
        violations.push(
          `${file}:${l.line}: R2: date "${r2[0]}" in comment: ${shown(l.text)}`
        )
      }
    }
    if (content.length > MAX_BLOCK_LINES) {
      violations.push(
        `${file}:${block.line}: R3: comment block of ${content.length} lines (max ${MAX_BLOCK_LINES}): ${shown(content[0].text)}`
      )
    }
  }
  return violations
}

function expectRules(label, file, text, expected) {
  const got = checkText(file, text).map((v) => v.split(': ')[1])
  const want = [...expected].sort()
  if (JSON.stringify([...got].sort()) !== JSON.stringify(want)) {
    throw new Error(
      `selftest '${label}' expected [${want}] got [${got}]:\n${checkText(file, text).join('\n')}`
    )
  }
}

function selfTest() {
  const lines = (n, prefix) =>
    Array.from({ length: n }, (_, i) => `${prefix}line ${i + 1}`).join('\n')

  expectRules('R1 ts line comment', 'a.ts', '// fixes PS-123\nconst a = 1\n', [
    'R1'
  ])
  expectRules('R1 PR ref', 'a.ts', 'const a = 1 // see PR #42\n', ['R1'])
  expectRules('R1 issue ref', 'a.js', '/* issue #7 */\n', ['R1'])
  expectRules('R1 codex ref', 'a.mjs', '// codex #3 follow-up\n', ['R1'])
  expectRules('R2 date', 'a.ts', '// added 2026-01-15\nlet x\n', ['R2'])
  expectRules('R3 line block', 'a.ts', `${lines(7, '// ')}\nlet x\n`, ['R3'])
  expectRules('R3 not at 6', 'a.ts', `${lines(6, '// ')}\nlet x\n`, [])
  expectRules(
    'R3 jsdoc delimiters ignored',
    'a.ts',
    `/**\n${lines(6, ' * ')}\n *\n */\nfunction f() {}\n`,
    []
  )
  expectRules(
    'R3 jsdoc block',
    'a.ts',
    `/**\n${lines(7, ' * ')}\n */\nfunction f() {}\n`,
    ['R3']
  )
  expectRules(
    'blank line splits blocks',
    'a.ts',
    `${lines(4, '// ')}\n\n${lines(4, '// ')}\n`,
    []
  )
  expectRules(
    'string is not a comment',
    'a.ts',
    'const s = "// PS-123 2026-01-01"\nconst t = `/* WI-9 */ ${s} // TA-1`\n',
    []
  )
  expectRules(
    'regex is not a comment',
    'a.js',
    'const r = /\\/\\/ PS-1/u\n',
    []
  )
  expectRules(
    'jsx text is not a comment',
    'a.tsx',
    'const e = <p>// PS-1 text</p>\n',
    []
  )
  expectRules(
    'jsx expression comment',
    'a.tsx',
    'const e = <p>{/* PS-1 */}</p>\n',
    ['R1']
  )
  expectRules(
    'directives never count or violate',
    'a.ts',
    [
      '// eslint-disable-next-line no-console -- PS-1',
      '// @ts-expect-error 2026-01-01',
      '// prettier-ignore',
      '/* istanbul ignore next */',
      '/* c8 ignore next */',
      '/// <reference types="vitest" />',
      '// deno-lint-ignore no-explicit-any',
      '// @deno-types="x"',
      '// trufflehog:ignore',
      '// gitleaks:allow',
      '// @vitest-environment jsdom',
      'const x = import(/* webpackChunkName: "a" */ "./a")'
    ].join('\n') + '\n',
    []
  )
  expectRules(
    'licence header exempt',
    'a.js',
    `/*\n * Copyright (c) Someone 2020-01-01\n${lines(8, ' * ')}\n */\n`,
    []
  )
  expectRules(
    'generated file exempt',
    'a.ts',
    `// GENERATED\n${lines(9, '// PS-1 ')}\n`,
    []
  )

  expectRules('R1 sql line', 'm.sql', '-- WI-12 fix\nselect 1;\n', ['R1'])
  expectRules(
    'sql string with -- is not a comment',
    'm.sql',
    "select '-- PS-123 2026-01-01';\n",
    []
  )
  expectRules('sql E string', 'm.sql', "select E'it\\'s -- PS-1';\n", [])
  expectRules('sql doubled quote', 'm.sql', "select 'it''s -- PS-1';\n", [])
  expectRules('sql identifier', 'm.sql', 'select "a--PS-1" from t;\n', [])
  expectRules(
    'sql dollar body comments count',
    'm.sql',
    'create function f() returns int as $fn$\nbegin\n  -- TMOS-4 note\n  return 1;\nend\n$fn$ language plpgsql;\n',
    ['R1']
  )
  expectRules(
    'migration dollar body comments are frozen',
    'supabase/migrations/m.sql',
    'create function f() returns int as $fn$\nbegin\n  -- TMOS-4 note\n  return 1;\nend\n$fn$ language plpgsql;\n-- WI-9 after\n',
    ['R1']
  )
  expectRules('sql positional param', 'm.sql', 'select $1, $2 -- ok\n', [])
  expectRules(
    'sql block comment',
    'm.sql',
    `/*\n${lines(7, '')}\n*/\nselect 1;\n`,
    ['R3']
  )
  expectRules(
    'sql directives',
    'm.sql',
    '-- target-db: general\n-- squawk-ignore x\n-- census_kept_policy: y\n',
    []
  )
  expectRules('sql line block', 'm.sql', `${lines(7, '-- ')}\nselect 1;\n`, [
    'R3'
  ])

  expectRules(
    'sh block',
    'a.sh',
    `#!/usr/bin/env bash\n${lines(7, '# ')}\necho hi\n`,
    ['R3']
  )
  expectRules(
    'sh shebang and shellcheck',
    'a.sh',
    '#!/bin/bash\n# shellcheck disable=SC2086\necho "# PS-1"\n',
    []
  )
  expectRules('sh trailing # ignored', 'a.sh', 'echo hi # PS-1\n', [])
  expectRules(
    'sh heredoc is data',
    'a.sh',
    `cat <<'EOF'\n${lines(8, '# PS-1 ')}\nEOF\n`,
    []
  )
  expectRules(
    'yml comment',
    'a.yml',
    'on: push\n# ADV-9 hardening\njobs: {}\n',
    ['R1']
  )
  expectRules(
    'yml directives',
    'a.yml',
    '# yaml-language-server: $schema=x\n# zizmor: ignore[foo]\nx: 1\n',
    []
  )

  const long = checkText('a.ts', `// PS-1 ${'x'.repeat(300)}\n`)
  if (long.length !== 1 || long[0].length > 200) {
    throw new Error('selftest: comment text must be truncated to 80 chars')
  }
  console.log('comment-hygiene positive and negative controls passed')
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
}

function readText(file) {
  const abs = path.resolve(ROOT, file)
  let fd
  try {
    fd = fs.openSync(abs, 'r')
  } catch {
    return null
  }
  try {
    // Stat and read the same descriptor so the file cannot change in between.
    if (!fs.fstatSync(fd).isFile()) return null
    const bytes = fs.readFileSync(fd)
    if (bytes.includes(0)) return null
    return bytes.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function run(files) {
  const violations = []
  let checked = 0
  for (const file of files) {
    const rel = path
      .relative(ROOT, path.resolve(ROOT, file))
      .split(path.sep)
      .join('/')
    if (!eligible(rel)) continue
    const text = readText(rel)
    if (text === null) continue
    checked += 1
    violations.push(...checkText(rel, text))
  }
  if (violations.length) {
    for (const v of violations) console.error(v)
    const counts = { R1: 0, R2: 0, R3: 0 }
    for (const v of violations) counts[v.split(': ')[1]] += 1
    console.error(
      `Comment hygiene FAILED: ${violations.length} violation(s) (R1 ${counts.R1}, R2 ${counts.R2}, R3 ${counts.R3}) in ${checked} file(s). Keep comments to rule + reason; history belongs in git.`
    )
    process.exit(1)
  }
  console.log(`Comment hygiene passed (${checked} files)`)
}

const [command, ...rest] = process.argv.slice(2)
if (command === '--selftest') selfTest()
else if (command === '--scan' || command === undefined) run(trackedFiles())
else if (command === '--files') run(rest)
else {
  console.error(
    'usage: check-comment-hygiene.mjs [--selftest|--scan|--files <paths...>]'
  )
  process.exit(2)
}
