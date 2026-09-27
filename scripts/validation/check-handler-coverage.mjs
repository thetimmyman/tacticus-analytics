#!/usr/bin/env node
// Fails when a produced job_type (static producers + handler-coverage.baseline.json)
// has no handler reachable from the worker routes. Dependency-free and fail-closed.
// Usage: check-handler-coverage.mjs [--root <dir>] [--baseline <file>] [--out-dir <dir>] [--json]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_BASELINE_RELPATH = path.join(
  'scripts',
  'validation',
  'handler-coverage.baseline.json'
)

const WORKER_ROUTE_DIR = path.join('app', 'api', 'worker')
const JOBS_DIR = path.join('app', 'lib', 'jobs')

// Roots scanned for TypeScript producers of work_queue rows.
const TS_PRODUCER_ROOTS = [
  'app',
  path.join('supabase', 'functions'),
  'packages'
]
const SQL_PRODUCER_ROOTS = [path.join('supabase', 'migrations')]

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts'])

/** Blanks comments, preserving offsets; strings stay because the job_types sought are string literals. */
function stripComments(source) {
  const out = source.split('')
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (c === '/' && next === '/') {
      let end = source.indexOf('\n', i)
      if (end === -1) end = source.length
      blank(i, end)
      i = end
      continue
    }
    if (c === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2)
      end = end === -1 ? source.length : end + 2
      blank(i, end)
      i = end
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i += 1
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    i += 1
  }
  return out.join('')
}

function stripSqlComments(sql) {
  const out = sql.split('')
  let i = 0
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }
  while (i < sql.length) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      let end = sql.indexOf('\n', i)
      if (end === -1) end = sql.length
      blank(i, end)
      i = end
      continue
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      let end = sql.indexOf('*/', i + 2)
      end = end === -1 ? sql.length : end + 2
      blank(i, end)
      i = end
      continue
    }
    if (sql[i] === "'") {
      i += 1
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2
          continue
        }
        if (sql[i] === "'") {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    i += 1
  }
  return out.join('')
}

function matchParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function matchBrace(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') depth -= 1
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim())
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function listFiles(dir, predicate, acc = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, predicate, acc)
    else if (predicate(full)) acc.push(full)
  }
  return acc
}

function readFile(file) {
  return fs.readFileSync(file, 'utf8')
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/')
}

function resolveModule(root, fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = path.join(root, spec.slice(2))
  else if (spec.startsWith('.'))
    base = path.resolve(path.dirname(fromFile), spec)
  else return null
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts')
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

function namedImports(source) {
  const map = new Map()
  const re = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(source)) !== null) {
    if (m[1]) continue // `import type` binds no value
    for (const raw of m[2].split(',')) {
      const name = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
      if (name) map.set(name.trim(), m[3])
    }
  }
  return map
}

function sideEffectImports(source) {
  const specs = []
  const re = /^\s*import\s+['"]([^'"]+)['"]/gm
  let m
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

const STRING_LITERAL = /^(['"])((?:[^'"\\]|\\.)*)\1$/

/** Resolve a compile-time string (literal or imported const binding) to {value} or {error}. */
function resolveStringExpression(root, file, source, expr, seen = new Set()) {
  const trimmed = expr.trim()
  const literal = STRING_LITERAL.exec(trimmed)
  if (literal) return { value: literal[2] }
  if (!/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
    return { error: `not a statically resolvable string: \`${trimmed}\`` }
  }
  const key = `${file}::${trimmed}`
  if (seen.has(key)) return { error: `circular constant \`${trimmed}\`` }
  seen.add(key)

  const localRe = new RegExp(
    `(?:^|\\n)\\s*(?:export\\s+)?const\\s+${trimmed}\\s*(?::[^=]+)?=\\s*([^\\n]+)`
  )
  const local = localRe.exec(source)
  if (local) {
    const value = local[1].replace(/\s*(?:as\s+const)?\s*;?\s*$/, '')
    const asLiteral = STRING_LITERAL.exec(value.trim())
    if (asLiteral) return { value: asLiteral[2] }
    return {
      error: `constant \`${trimmed}\` in ${rel(root, file)} is not a string literal`
    }
  }

  const imported = namedImports(source).get(trimmed)
  if (imported) {
    const target = resolveModule(root, file, imported)
    if (!target) {
      return {
        error: `cannot resolve module '${imported}' imported by ${rel(root, file)}`
      }
    }
    return resolveStringExpression(
      root,
      target,
      stripComments(readFile(target)),
      trimmed,
      seen
    )
  }
  return {
    error: `\`${trimmed}\` is neither a local const nor an import in ${rel(root, file)}`
  }
}

function collectRegisteredHandlers(root) {
  const errors = []
  const handlers = []

  const routeFiles = listFiles(
    path.join(root, WORKER_ROUTE_DIR),
    (f) => path.basename(f) === 'route.ts'
  ).sort()
  if (routeFiles.length === 0) {
    errors.push(
      `no worker routes found under ${WORKER_ROUTE_DIR}/ — the gate cannot tell what the image registers`
    )
    return { handlers, errors, entrypoints: [] }
  }

  const entrypoints = []
  for (const routeFile of routeFiles) {
    const source = stripComments(readFile(routeFile))
    for (const spec of sideEffectImports(source)) {
      const resolved = resolveModule(root, routeFile, spec)
      if (!resolved) continue
      if (!rel(root, resolved).startsWith(JOBS_DIR.split(path.sep).join('/'))) {
        continue
      }
      if (!entrypoints.some((e) => e.file === resolved)) {
        entrypoints.push({ file: resolved, route: rel(root, routeFile) })
      }
    }
  }
  if (entrypoints.length === 0) {
    errors.push(
      `no handler-registration module is imported by any worker route under ${WORKER_ROUTE_DIR}/`
    )
    return { handlers, errors, entrypoints }
  }

  for (const entry of entrypoints) {
    const source = stripComments(readFile(entry.file))
    const imports = namedImports(source)
    const called = new Set()
    const callRe = /(?:^|\n)\s*([A-Za-z_$][\w$]*)\s*\(\s*\)/g
    let m
    while ((m = callRe.exec(source)) !== null) called.add(m[1])
    if (called.size === 0) {
      errors.push(
        `${rel(root, entry.file)} calls no registration function — nothing would be registered at pod start`
      )
    }
    for (const name of [...called].sort()) {
      const spec = imports.get(name)
      if (!spec) continue // locally defined helper, not a handler module
      const target = resolveModule(root, entry.file, spec)
      if (!target) {
        errors.push(
          `${rel(root, entry.file)} imports '${spec}' for ${name}(), which does not resolve to a file`
        )
        continue
      }
      const found = extractRegistrations(root, target, name)
      errors.push(...found.errors)
      for (const jobType of found.jobTypes) {
        handlers.push({
          jobType,
          module: rel(root, target),
          registrar: name,
          entrypoint: rel(root, entry.file)
        })
      }
      if (found.jobTypes.length === 0 && found.errors.length === 0) {
        errors.push(
          `${rel(root, target)}: ${name}() registers no job_type (expected at least one registerJobHandler call)`
        )
      }
    }
  }

  const seen = new Map()
  for (const handler of handlers) {
    if (seen.has(handler.jobType)) {
      errors.push(
        `duplicate handler registration for job_type=${handler.jobType} (${seen.get(handler.jobType)} and ${handler.module})`
      )
    } else seen.set(handler.jobType, handler.module)
  }

  handlers.sort((a, b) => a.jobType.localeCompare(b.jobType))
  return { handlers, errors, entrypoints }
}

function extractRegistrations(root, file, fnName) {
  const errors = []
  const jobTypes = []
  const source = stripComments(readFile(file))
  const fnRe = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${fnName}\\s*\\(`
  )
  const fnMatch = fnRe.exec(source)
  if (!fnMatch) {
    errors.push(
      `${rel(root, file)} does not export function ${fnName} (imported as a registrar)`
    )
    return { jobTypes, errors }
  }
  const bodyStart = source.indexOf('{', fnMatch.index + fnMatch[0].length)
  const bodyEnd = bodyStart === -1 ? -1 : matchBrace(source, bodyStart)
  if (bodyEnd === -1) {
    errors.push(`${rel(root, file)}: cannot delimit the body of ${fnName}()`)
    return { jobTypes, errors }
  }
  const body = source.slice(bodyStart, bodyEnd + 1)
  const callRe = /registerJobHandler\s*\(/g
  let m
  while ((m = callRe.exec(body)) !== null) {
    const open = body.indexOf('(', m.index)
    const close = matchParen(body, open)
    if (close === -1) {
      errors.push(
        `${rel(root, file)}: unbalanced registerJobHandler( call in ${fnName}()`
      )
      continue
    }
    const args = splitTopLevel(body.slice(open + 1, close))
    const resolved = resolveStringExpression(root, file, source, args[0] ?? '')
    if (resolved.error) {
      errors.push(
        `${rel(root, file)}:${lineOf(source, bodyStart + m.index)}: registerJobHandler job_type is not statically resolvable — ${resolved.error}`
      )
      continue
    }
    jobTypes.push(resolved.value)
  }
  return { jobTypes, errors }
}

function collectStaticProducers(root) {
  const producers = []
  const errors = []

  for (const sqlRoot of SQL_PRODUCER_ROOTS) {
    for (const file of listFiles(path.join(root, sqlRoot), (f) =>
      f.endsWith('.sql')
    ).sort()) {
      const sql = stripSqlComments(readFile(file))
      const re = /insert\s+into\s+(?:public\s*\.\s*)?work_queue\s*\(/gi
      let m
      while ((m = re.exec(sql)) !== null) {
        const colsOpen = sql.indexOf('(', m.index)
        const colsClose = matchParen(sql, colsOpen)
        if (colsClose === -1) continue
        const columns = splitTopLevel(sql.slice(colsOpen + 1, colsClose)).map(
          (c) => c.replace(/"/g, '').trim().toLowerCase()
        )
        const idx = columns.indexOf('job_type')
        const line = lineOf(sql, m.index)
        const where = `${rel(root, file)}:${line}`
        if (idx === -1) {
          errors.push(
            `${where}: INSERT INTO work_queue has no job_type column — cannot tell what it produces`
          )
          continue
        }
        const valuesMatch = /values\s*\(/i.exec(sql.slice(colsClose))
        if (!valuesMatch) {
          errors.push(
            `${where}: INSERT INTO work_queue is not a literal VALUES insert — record its job_type in the baseline instead`
          )
          continue
        }
        const valsOpen =
          colsClose + valuesMatch.index + valuesMatch[0].length - 1
        const valsClose = matchParen(sql, valsOpen)
        if (valsClose === -1) continue
        const values = splitTopLevel(sql.slice(valsOpen + 1, valsClose))
        const raw = (values[idx] ?? '').trim()
        const literal = /^'((?:[^']|'')*)'(?:\s*::\s*\w+)?$/.exec(raw)
        if (!literal) {
          errors.push(
            `${where}: job_type value \`${raw}\` is not a string literal — record it in the baseline instead`
          )
          continue
        }
        producers.push({
          jobType: literal[1].replace(/''/g, "'"),
          source: where,
          kind: 'sql'
        })
      }
    }
  }

  for (const tsRoot of TS_PRODUCER_ROOTS) {
    for (const file of listFiles(path.join(root, tsRoot), (f) =>
      TS_EXTENSIONS.has(path.extname(f))
    ).sort()) {
      const source = readFile(file)
      if (!source.includes('work_queue')) continue
      if (/\.(test|spec)\.tsx?$/.test(file)) continue
      const stripped = stripComments(source)
      const tableRe = /['"]work_queue['"]/g
      let m
      const seenSlices = new Set()
      while ((m = tableRe.exec(stripped)) !== null) {
        const slice = enclosingSlice(stripped, m.index)
        if (!slice || seenSlices.has(slice.start)) continue
        seenSlices.add(slice.start)
        const propRe = /(?<![\w$.])job_type\s*:\s*(['"])([^'"]+)\1/g
        let p
        while ((p = propRe.exec(slice.text)) !== null) {
          producers.push({
            jobType: p[2],
            source: `${rel(root, file)}:${lineOf(stripped, slice.start + p.index)}`,
            kind: 'typescript'
          })
        }
      }
    }
  }

  producers.sort(
    (a, b) =>
      a.jobType.localeCompare(b.jobType) || a.source.localeCompare(b.source)
  )
  return { producers, errors }
}

/** The innermost call (else statement) around `index`, keeping `job_type:` with its own work_queue. */
function enclosingSlice(text, index) {
  const stack = []
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '(') stack.push(i)
    else if (text[i] === ')') stack.pop()
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1]
    const close = matchParen(text, open)
    if (close !== -1) return { start: open, text: text.slice(open, close + 1) }
  }
  const start = text.lastIndexOf(';', index) + 1
  let end = text.indexOf(';', index)
  if (end === -1) end = text.length
  return { start, text: text.slice(start, end) }
}

function loadBaseline(root, baselinePath) {
  const file = baselinePath ?? path.join(root, DEFAULT_BASELINE_RELPATH)
  if (!fs.existsSync(file)) {
    return {
      entries: [],
      errors: [
        `baseline ${rel(root, file)} is missing — the gate would only see static producers and could not fail on a cron-produced job_type`
      ],
      file
    }
  }
  let parsed
  try {
    parsed = JSON.parse(readFile(file))
  } catch (error) {
    return {
      entries: [],
      errors: [
        `baseline ${rel(root, file)} is not valid JSON: ${error.message}`
      ],
      file
    }
  }
  const errors = []
  const raw = parsed.job_types
  if (!Array.isArray(raw)) {
    return {
      entries: [],
      errors: [`baseline ${rel(root, file)} has no \`job_types\` array`],
      file
    }
  }
  const entries = []
  for (const entry of raw) {
    if (typeof entry?.job_type !== 'string' || entry.job_type.length === 0) {
      errors.push(
        `baseline ${rel(root, file)} has an entry without a string \`job_type\`: ${JSON.stringify(entry)}`
      )
      continue
    }
    entries.push(entry)
  }
  return { entries, errors, file, meta: parsed }
}

function checkHandlerCoverage({ root = process.cwd(), baseline } = {}) {
  const registered = collectRegisteredHandlers(root)
  const staticProducers = collectStaticProducers(root)
  const baselineResult = loadBaseline(root, baseline)

  const errors = [
    ...registered.errors,
    ...staticProducers.errors,
    ...baselineResult.errors
  ]

  const handlerTypes = new Set(registered.handlers.map((h) => h.jobType))

  const produced = new Map()
  const add = (jobType, description) => {
    if (!produced.has(jobType)) produced.set(jobType, [])
    produced.get(jobType).push(description)
  }
  for (const p of staticProducers.producers) add(p.jobType, p.source)
  for (const entry of baselineResult.entries) {
    add(
      entry.job_type,
      `baseline${entry.count === undefined ? '' : ` (${entry.count} rows)`}`
    )
  }

  const missing = []
  for (const [jobType, sources] of [...produced.entries()].sort()) {
    if (!handlerTypes.has(jobType)) missing.push({ jobType, sources })
  }
  const orphans = registered.handlers
    .filter((h) => !produced.has(h.jobType))
    .map((h) => ({ jobType: h.jobType, module: h.module }))

  const ok = missing.length === 0 && errors.length === 0
  return {
    ok,
    root,
    handlers: registered.handlers,
    entrypoints: registered.entrypoints.map((e) => ({
      module: rel(root, e.file),
      route: e.route
    })),
    staticProducers: staticProducers.producers,
    baselineFile: rel(root, baselineResult.file),
    baselineMeta: baselineResult.meta ?? null,
    produced: [...produced.entries()]
      .sort()
      .map(([jobType, sources]) => ({ jobType, sources })),
    missing,
    orphans,
    errors
  }
}

function formatReport(report) {
  const lines = []
  lines.push('PS-79 worker handler-coverage gate')
  lines.push('')
  lines.push(
    `registration entrypoints: ${report.entrypoints.map((e) => e.module).join(', ') || '(none)'}`
  )
  lines.push(`registered handlers (${report.handlers.length}):`)
  for (const handler of report.handlers) {
    lines.push(`  ${handler.jobType}  <- ${handler.module}`)
  }
  lines.push('')
  lines.push(`produced job_types (${report.produced.length}):`)
  for (const entry of report.produced) {
    lines.push(`  ${entry.jobType}  <- ${entry.sources.join(', ')}`)
  }
  if (report.orphans.length > 0) {
    lines.push('')
    lines.push(
      `WARNING: ${report.orphans.length} registered handler(s) no known producer enqueues:`
    )
    for (const orphan of report.orphans) {
      lines.push(`  ${orphan.jobType}  (${orphan.module})`)
    }
    lines.push(
      '  Not a failure. Either a producer is missing from the baseline (refresh it)'
    )
    lines.push('  or the handler is dead weight.')
  }
  if (report.errors.length > 0) {
    lines.push('')
    lines.push(`FAIL: ${report.errors.length} problem(s) reading the wiring:`)
    for (const error of report.errors) lines.push(`  ${error}`)
  }
  if (report.missing.length > 0) {
    lines.push('')
    lines.push(
      `FAIL: ${report.missing.length} produced job_type(s) have NO registered handler.`
    )
    lines.push(
      'This image would dead-letter every one of their rows (worker-tick: "no handler registered").'
    )
    for (const entry of report.missing) {
      lines.push(`  ${entry.jobType}  produced by: ${entry.sources.join(', ')}`)
    }
  }
  lines.push('')
  lines.push(
    report.ok
      ? 'OK: every produced job_type has a registered handler.'
      : 'FAILED: do not roll this image.'
  )
  return lines.join('\n')
}

function handlersArtifact(report) {
  return `${report.handlers.map((h) => h.jobType).join('\n')}\n`
}

function parseArgs(argv) {
  const options = { root: process.cwd() }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') options.root = path.resolve(argv[++i])
    else if (arg === '--baseline') options.baseline = path.resolve(argv[++i])
    else if (arg === '--out-dir') options.outDir = path.resolve(argv[++i])
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(
      'Usage: check-handler-coverage.mjs [--root <dir>] [--baseline <file>] [--out-dir <dir>] [--json]\n'
    )
    return 0
  }
  const report = checkHandlerCoverage(options)

  // A fixed path in the shared temp dir could be pre-created or symlinked, so mint a private 0700 dir.
  const explicitOutDir =
    options.outDir ??
    (process.env.RUNNER_TEMP ? path.resolve(process.env.RUNNER_TEMP) : null)
  let outDir = explicitOutDir
  let artifactPath = null
  try {
    if (explicitOutDir) {
      fs.mkdirSync(explicitOutDir, { recursive: true })
    } else {
      outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handler-coverage-'))
    }
    artifactPath = path.join(outDir, 'handlers.txt')
    fs.writeFileSync(artifactPath, handlersArtifact(report))
  } catch (error) {
    process.stderr.write(
      `warning: could not write handlers.txt to ${outDir ?? 'a private temp dir'}: ${error.message}\n`
    )
    artifactPath = null
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ ...report, artifactPath }, null, 2)}\n`
    )
  } else {
    process.stdout.write(`${formatReport(report)}\n`)
    if (artifactPath) {
      process.stdout.write(`\nhandlers.txt written to ${artifactPath}\n`)
      process.stdout.write(
        'Diff it against the live queue with:\n  psql -d postgres -Atc "SELECT DISTINCT job_type FROM work_queue WHERE created_at > now()-interval \'14 days\' ORDER BY 1"\n'
      )
    }
  }
  return report.ok ? 0 : 1
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname)
if (invokedDirectly) {
  process.exit(main())
}
