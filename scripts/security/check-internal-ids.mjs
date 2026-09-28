#!/usr/bin/env node

// Internal-ID gate: tracked files and paths carry no work-item keys, PR/issue
// references or ticket-derived slugs, because the tracker is private and the
// repository is public. Exceptions live in config/internal-id-allow.json.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ALLOW_FILE = 'config/internal-id-allow.json'
const MAX_SHOWN = 100

// Generated lockfiles hold base64 digests that can spell a key by chance.
const SKIPPED_FILES = new Set([ALLOW_FILE, 'package-lock.json'])

const PREFIXES = 'PS|WI|SEC|TMOS|TA|ADV|POS|EOT'
const PATTERNS = [
  {
    kind: 'key',
    // Suffixes and underscore prefixes must not hide a key; a letter or digit
    // just before the prefix means another word (HTTPS-443).
    re: new RegExp(
      `(?<![A-Za-z0-9])(?:${PREFIXES})-(?:[A-Z]{1,3}-)?\\d+(?!\\d)`,
      'giu'
    )
  },
  {
    kind: 'ref',
    re: /\b(?:PR|pull request|issue|codex)\s*#\d+/giu
  },
  {
    kind: 'slug',
    re: /(?<![A-Za-z0-9])(?:ps|wi|eot|tmos)[-_ ]?\d{2,}(?!\d)/gu
  },
  { kind: 'slug', re: /(?<![A-Za-z0-9])(?:PS|WI)[_ ]?\d{2,}(?!\d)/gu }
]
const TOKEN_CHAR = /[A-Za-z0-9_-]/u

/** The identifier a hit sits in, so allowlist entries name whole names. */
function tokenAt(line, start, end, kind) {
  if (kind === 'ref') return line.slice(start, end).replace(/\s+/gu, ' ')
  let s = start
  let e = end
  while (s > 0 && TOKEN_CHAR.test(line[s - 1])) s -= 1
  while (e < line.length && TOKEN_CHAR.test(line[e])) e += 1
  return line.slice(s, e).replace(/^-+|-+$/gu, '')
}

function findHits(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    const taken = []
    for (const { kind, re } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        const start = m.index
        const end = start + m[0].length
        if (taken.some(([s, e]) => start < e && end > s)) continue
        taken.push([start, end])
        hits.push({ line: i + 1, kind, token: tokenAt(line, start, end, kind) })
      }
    }
  })
  return hits.sort((a, b) => a.line - b.line)
}

function pathHits(file) {
  return findHits(file).map((h) => ({ ...h, line: 0, kind: 'path' }))
}

function migrationVersion(file) {
  const m = /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/u.exec(file)
  return m ? m[1] : null
}

function isFrozenMigration(file, through) {
  const version = migrationVersion(file)
  return version !== null && version <= through
}

/** A frozen migration's file stem and ledger name are stable identifiers. */
function frozenNames(files, through) {
  const names = new Set()
  for (const file of files) {
    if (!isFrozenMigration(file, through)) continue
    const stem = path.basename(file, '.sql')
    names.add(stem)
    names.add(stem.slice(15))
  }
  return names
}

const oneLine = (s) =>
  typeof s === 'string' && s.trim() !== '' && !s.includes('\n')

function parseAllow(text) {
  const raw = JSON.parse(text)
  const fail = (msg) => {
    throw new Error(`${ALLOW_FILE}: ${msg}`)
  }
  const frozen = raw?.frozenMigrations
  if (
    !frozen ||
    !/^\d{14}$/u.test(frozen.through ?? '') ||
    !oneLine(frozen.why)
  ) {
    fail(
      'frozenMigrations needs a 14-digit "through" version and a one-line "why"'
    )
  }
  if (!Array.isArray(raw.entries)) fail('"entries" must be an array')
  const entries = raw.entries.map((entry, index) => {
    const where = `entries[${index}]`
    if (!entry || !oneLine(entry.why)) fail(`${where} needs a one-line "why"`)
    const hasToken = typeof entry.token === 'string' && entry.token !== ''
    const hasFile = typeof entry.file === 'string' && entry.file !== ''
    if (hasToken === hasFile)
      fail(`${where} needs exactly one of "token" or "file"`)
    if (entry.files !== undefined) {
      if (!hasToken) fail(`${where}: "files" narrows a "token" entry only`)
      if (
        !Array.isArray(entry.files) ||
        entry.files.length === 0 ||
        !entry.files.every((f) => typeof f === 'string' && f !== '')
      ) {
        fail(`${where}: "files" must be a non-empty array of paths`)
      }
    }
    const extra = Object.keys(entry).filter(
      (k) => !['token', 'file', 'files', 'why'].includes(k)
    )
    if (extra.length) fail(`${where}: unknown field(s) ${extra.join(', ')}`)
    return { ...entry, index }
  })
  return { through: frozen.through, entries }
}

// A "files" item ending in "/" covers that directory.
const inScope = (file, files) =>
  !files ||
  files.some((f) => (f.endsWith('/') ? file.startsWith(f) : file === f))

/**
 * Scans the given texts and paths. `texts` maps repo-relative path -> text or
 * null (unreadable/binary). Returns violations plus the allowlist entries no
 * hit used, which only a full scan may treat as stale.
 */
function scan(texts, allow, frozen) {
  const used = new Set()
  const violations = []
  const tokenEntries = allow.entries.filter((e) => e.token)
  const fileEntries = new Map(
    allow.entries.filter((e) => e.file).map((e) => [e.file, e])
  )
  const allowed = (file, hit) => {
    if (hit.kind !== 'path' && frozen.has(hit.token)) return true
    const entry = tokenEntries.find(
      (e) => e.token === hit.token && inScope(file, e.files)
    )
    if (entry) used.add(entry.index)
    return Boolean(entry)
  }
  for (const [file, text] of Object.entries(texts)) {
    if (SKIPPED_FILES.has(file) || isFrozenMigration(file, allow.through)) {
      continue
    }
    const hits = [...pathHits(file), ...(text === null ? [] : findHits(text))]
    if (hits.length === 0) continue
    const exempt = fileEntries.get(file)
    if (exempt) {
      used.add(exempt.index)
      continue
    }
    for (const hit of hits) {
      if (!allowed(file, hit)) violations.push({ file, ...hit })
    }
  }
  const unused = allow.entries.filter((e) => !used.has(e.index))
  return { violations, unused }
}

function formatViolation(v, texts) {
  if (v.kind === 'path') return `${v.file}: path: "${v.token}" in file path`
  const line = (texts[v.file] ?? '').split('\n')[v.line - 1] ?? ''
  const flat = line.trim().replace(/\s+/gu, ' ')
  const shown =
    flat.length > MAX_SHOWN ? `${flat.slice(0, MAX_SHOWN - 3)}...` : flat
  return `${v.file}:${v.line}: ${v.kind}: "${v.token}": ${shown}`
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

function loadAllow() {
  const text = readText(ALLOW_FILE)
  if (text === null) {
    console.error(`${ALLOW_FILE} not found`)
    process.exit(2)
  }
  try {
    return parseAllow(text)
  } catch (err) {
    console.error(err.message)
    process.exit(2)
  }
}

function run(files, { full }) {
  const allow = loadAllow()
  const frozen = frozenNames(trackedFiles(), allow.through)
  const texts = {}
  for (const file of files) {
    const rel = path
      .relative(ROOT, path.resolve(ROOT, file))
      .split(path.sep)
      .join('/')
    if (rel.startsWith('../') || rel.split('/').includes('node_modules')) {
      continue
    }
    texts[rel] = readText(rel)
  }
  const { violations, unused } = scan(texts, allow, frozen)
  const stale = full ? unused : []
  for (const v of violations) console.error(formatViolation(v, texts))
  for (const e of stale) {
    console.error(
      `${ALLOW_FILE}: entries[${e.index}] (${e.token ?? e.file}) matches nothing; remove it`
    )
  }
  if (violations.length || stale.length) {
    console.error(
      `Internal-ID scan FAILED: ${violations.length} hit(s), ${stale.length} stale allowlist entr(y/ies). ` +
        'Describe the behaviour instead of citing the ticket; give fixtures neutral names.'
    )
    process.exit(1)
  }
  console.log(`Internal-ID scan passed (${Object.keys(texts).length} files)`)
}

// Fixtures are assembled at runtime so this file holds no literal key.
const key = (prefix, n) => `${prefix}-${n}`

function expectKinds(label, text, expected) {
  const got = findHits(text).map((h) => `${h.kind}:${h.token}`)
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error(`selftest '${label}': expected [${expected}] got [${got}]`)
  }
}

function selfTest() {
  const ps = key('PS', 12)
  const wi = key('WI', 2570)
  expectKinds('key in string', `logger.warn('${ps}: failed')`, [`key:${ps}`])
  expectKinds('key in comment', `// see ${wi}\n`, [`key:${wi}`])
  expectKinds(
    'every prefix',
    ['SEC', 'TMOS', 'TA', 'ADV', 'POS', 'EOT'].map((p) => key(p, 7)).join(' '),
    ['SEC', 'TMOS', 'TA', 'ADV', 'POS', 'EOT'].map((p) => `key:${key(p, 7)}`)
  )
  expectKinds('lettered finding id', key('TA-A', '023'), [
    `key:${key('TA-A', '023')}`
  ])
  expectKinds('key inside a word', `pre-${wi} engine`, [`key:pre-${wi}`])
  expectKinds('lettered suffix', `${ps}a`, [`key:${ps}a`])
  expectKinds('underscore suffix', `${ps}_fix`, [`key:${ps}_fix`])
  expectKinds('env suffix', `${wi}_BACKEND`, [`key:${wi}_BACKEND`])
  expectKinds('underscore prefix', `FIX_${ps}`, [`key:FIX_${ps}`])
  expectKinds(
    'mixed and lower case',
    ['Ps', 'sec', 'ta', 'adv', 'pos'].map((p) => key(p, 12)).join(' '),
    ['Ps', 'sec', 'ta', 'adv', 'pos'].map((p) => `key:${key(p, 12)}`)
  )
  expectKinds('lower slug', `CREATE TEMP TABLE ${'ps'}12_probe (id int);`, [
    `slug:${'ps'}12_probe`
  ])
  expectKinds('hyphen slug', `'${'wi'}4450-hero'`, [`slug:${'wi'}4450-hero`])
  expectKinds('camel slug', `import { ${'wi'}825Allowed } from 'x'`, [
    `slug:${'wi'}825Allowed`
  ])
  expectKinds('upper slug', `const code = '${'WI'}2570A'`, [
    `slug:${'WI'}2570A`
  ])
  expectKinds('env slug', `process.env.${'WI'}6060_BACKEND`, [
    `slug:${'WI'}6060_BACKEND`
  ])
  expectKinds('space-separated slug', `'${'WI'} 2670 Control Guild'`, [
    `slug:${'WI'} 2670`
  ])
  expectKinds('lower space slug', `-- see ${'wi'} 2670 notes`, [
    `slug:${'wi'} 2670`
  ])
  expectKinds('pr ref', `see ${'PR'} #42 and ${'issue'} #7, ${'codex'} #3`, [
    `ref:${'PR'} #42`,
    `ref:${'issue'} #7`,
    `ref:${'codex'} #3`
  ])
  expectKinds(
    'look-alikes are not hits',
    'ISO-8601 SHA-256 HTTPS-443 DATA-12 ps1 ups123 #42 PR# sec30 pos10 ta12 eot_gr_data PS 5 APS 12',
    []
  )

  const allowText = (entries, through = '20260101000000') =>
    JSON.stringify({ frozenMigrations: { through, why: 'frozen' }, entries })
  const bad = [
    [{ token: 'x' }, 'one-line "why"'],
    [{ token: 'x', why: 'a\nb' }, 'one-line "why"'],
    [{ token: 'x', file: 'y', why: 'w' }, 'exactly one'],
    [{ why: 'w' }, 'exactly one'],
    [{ file: 'y', files: ['z'], why: 'w' }, 'narrows'],
    [{ token: 'x', files: [], why: 'w' }, 'non-empty'],
    [{ token: 'x', why: 'w', note: 'n' }, 'unknown field']
  ]
  for (const [entry, message] of bad) {
    try {
      parseAllow(allowText([entry]))
      throw new Error(
        `selftest: malformed entry accepted: ${JSON.stringify(entry)}`
      )
    } catch (err) {
      if (!err.message.includes(message)) throw err
    }
  }
  try {
    parseAllow(JSON.stringify({ entries: [] }))
    throw new Error('selftest: missing frozenMigrations accepted')
  } catch (err) {
    if (!err.message.includes('frozenMigrations')) throw err
  }

  const live = `${'wi'}6560_notes_backup`
  const allow = parseAllow(
    allowText([
      { token: live, why: 'live table' },
      { token: key('PS', 9), files: ['a/only.ts'], why: 'scoped' },
      { token: key('PS', 8), files: ['dir/'], why: 'directory' },
      { file: 'fixtures/guard.mjs', why: 'detection fixtures' },
      { token: 'never-seen', why: 'stale' }
    ])
  )
  const frozenMig = `supabase/migrations/20250101000000_${'ps'}40_fix.sql`
  const openMig = `supabase/migrations/20270101000000_${'ps'}41_fix.sql`
  const pgtapLikeMig = `tests/${'ps'}40_fix.sql`
  const frozen = frozenNames([frozenMig, openMig], allow.through)
  const texts = {
    'a/live.ts': `from('${live}')\n`,
    'a/only.ts': `'${key('PS', 9)}'\n`,
    'a/other.ts': `'${key('PS', 9)}'\n`,
    'dir/sub/x.ts': `'${key('PS', 8)}'\n`,
    'fixtures/guard.mjs': `'${key('PS', 1)}'\n`,
    [frozenMig]: `-- ${key('PS', 40)}\n`,
    [openMig]: `-- ${key('PS', 41)}\n`,
    'a/ref.ts': `read('${path.basename(frozenMig)}'); name = '${'ps'}40_fix'\n`,
    [pgtapLikeMig]: 'select 1;\n',
    'package-lock.json': `"integrity": "sha512-ab/${'WI'}928Gj"\n`,
    [ALLOW_FILE]: `"${key('PS', 1)}"\n`,
    'bin/blob.png': null
  }
  const { violations, unused } = scan(texts, allow, frozen)
  const got = violations.map((v) => `${v.file}:${v.kind}`).sort()
  const want = [
    `${openMig}:key`,
    `${openMig}:path`,
    'a/other.ts:key',
    `${pgtapLikeMig}:path`
  ].sort()
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`selftest: scan expected [${want}] got [${got}]`)
  }
  if (unused.length !== 1 || unused[0].token !== 'never-seen') {
    throw new Error(
      `selftest: expected only the stale entry unused, got ${JSON.stringify(unused)}`
    )
  }
  const shown = formatViolation(
    { file: 'a/other.ts', line: 1, kind: 'key', token: key('PS', 9) },
    { 'a/other.ts': `  const s = '${'x'.repeat(300)}'` }
  )
  if (shown.length > 200)
    throw new Error('selftest: line text must be truncated')
  console.log('internal-id positive and negative controls passed')
}

const [command, ...rest] = process.argv.slice(2)
if (command === '--selftest') selfTest()
else if (command === '--scan' || command === undefined) {
  run(trackedFiles(), { full: true })
} else if (command === '--files') run(rest, { full: false })
else {
  console.error(
    'usage: check-internal-ids.mjs [--selftest|--scan|--files <paths...>]'
  )
  process.exit(2)
}
