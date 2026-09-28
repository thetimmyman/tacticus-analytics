#!/usr/bin/env node
// One-way ratchet over the `tsc -p tsconfig.tests.json` error count; growth needs a
// hand edit to test-typecheck-baseline.json and `--update` only shrinks it.
// Usage: check-test-typecheck-ratchet.mjs [--check|--update|--selftest] [--from <file>]

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)
const BASELINE_PATH = path.join(
  ROOT,
  'scripts',
  'validation',
  'test-typecheck-baseline.json'
)
const TSCONFIG = 'tsconfig.tests.json'

const ERROR_LINE_RE = /^(.+?)\(\d+,\d+\): error (TS\d+):/
// Prefix-less diagnostics are invocation/config failures ERROR_LINE_RE cannot
// see; a run emitting only them would otherwise score zero and pass.
const UNPREFIXED_DIAGNOSTIC_RE = /^\s*error (TS\d+):/
// A tsconfig "file" is a project-configuration failure, not a baseline error.
const CONFIG_FILE_DIAGNOSTIC_RE =
  /^\s*([^(]*tsconfig[^(]*\.json)\(\d+,\d+\): error (TS\d+):/

function parseErrors(output) {
  const errors = []
  for (const line of output.split('\n')) {
    const match = ERROR_LINE_RE.exec(line)
    if (match) errors.push({ file: match[1], code: match[2] })
  }
  return errors
}

/** Files by error count; all listed every run because the baseline has no per-file record. */
function topFiles(errors, n = Infinity) {
  const counts = new Map()
  for (const { file } of errors) {
    counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([file, count]) => `  ${count}\t${file}`)
}

/**
 * Diagnostics proving tsc could not check the project at all (counting them
 * would fail open). Not a blanket TS5xxx/TS6xxx range: TS6133 must keep counting.
 */
function findFatalDiagnostics(output) {
  const fatal = []
  for (const line of output.split('\n')) {
    if (
      UNPREFIXED_DIAGNOSTIC_RE.test(line) ||
      CONFIG_FILE_DIAGNOSTIC_RE.test(line)
    ) {
      fatal.push(line.trim())
    }
  }
  return fatal
}

/** Reasons a tsc run is unusable (empty = valid); `status` is null for `--from`, skipping exit-status rules. */
function findUnusableRunReasons({ output, status, spawnError }) {
  const reasons = []
  if (spawnError) {
    reasons.push(`tsc could not be executed: ${spawnError}`)
    return reasons
  }
  for (const diagnostic of findFatalDiagnostics(output)) {
    reasons.push(`fatal tsc diagnostic: ${diagnostic}`)
  }
  if (status !== null && status !== 0 && parseErrors(output).length === 0) {
    reasons.push(
      `tsc exited ${status} but produced no parseable type errors; ` +
        'the run is not a valid diagnostic result.'
    )
  }
  return reasons
}

/**
 * Differences between package-lock.json and the install (both lockfile `packages` maps).
 * Only optional packages may be locked but absent: npm skips other platforms' builds.
 */
function findInstallDrift(lockPackages, installedPackages) {
  const drift = []
  for (const [key, installed] of Object.entries(installedPackages)) {
    const locked = lockPackages[key]
    if (!locked) {
      drift.push(`${key}: installed ${installed.version}, not in the lockfile`)
    } else if (locked.version !== installed.version) {
      drift.push(
        `${key}: installed ${installed.version}, locked ${locked.version}`
      )
    }
  }
  for (const [key, locked] of Object.entries(lockPackages)) {
    if (key === '' || installedPackages[key]) continue
    if (!locked.optional && !locked.devOptional) {
      drift.push(`${key}: locked ${locked.version}, not installed`)
    }
  }
  return drift
}

// A stale node_modules shifts the count against third-party types, so a local
// run over it must not be read as the repo's number (or copied into the baseline).
function readInstallDrift() {
  const hiddenLock = path.join(ROOT, 'node_modules', '.package-lock.json')
  if (!fs.existsSync(hiddenLock)) {
    return [
      'node_modules/.package-lock.json is missing, so the install cannot be verified'
    ]
  }
  const read = (file) =>
    JSON.parse(fs.readFileSync(file, 'utf8')).packages ?? {}
  return findInstallDrift(
    read(path.join(ROOT, 'package-lock.json')),
    read(hiddenLock)
  )
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`missing baseline: ${path.relative(ROOT, BASELINE_PATH)}`)
    console.error(
      'generate one with: node scripts/validation/check-test-typecheck-ratchet.mjs --update'
    )
    process.exit(1)
  }
  const parsed = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
  if (typeof parsed.maxErrors !== 'number') {
    console.error('baseline is malformed: expected a { maxErrors: N } object')
    process.exit(1)
  }
  return parsed.maxErrors
}

function writeBaseline(maxErrors) {
  const payload = {
    $comment:
      'Ceiling on tsc -p tsconfig.tests.json errors. ' +
      'check-test-typecheck-ratchet.mjs fails CI if the count rises above this; ' +
      '--update lowers it (never raises it — that is a hand edit reviewed in the PR that makes it).',
    maxErrors
  }
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`)
}

function runTsc(fromFile) {
  if (fromFile) {
    return { output: fs.readFileSync(fromFile, 'utf8'), status: null }
  }
  try {
    const output = execFileSync('npx', ['tsc', '--noEmit', '-p', TSCONFIG], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    })
    return { output, status: 0 }
  } catch (err) {
    // Non-zero is expected with type errors, but not with no usable diagnostics.
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`
    const spawnError =
      err.status === undefined || err.status === null
        ? (err.code ?? err.message ?? 'unknown spawn failure')
        : undefined
    return { output, status: err.status ?? null, spawnError }
  }
}

function selfTest() {
  const output = [
    'app/a.ts(10,3): error TS2322: bad',
    'app/a.ts(20,3): error TS2345: bad',
    'app/b.ts(5,1): error TS2304: Cannot find name x.',
    'Found 3 errors in 2 files.',
    ''
  ].join('\n')

  const errors = parseErrors(output)
  if (errors.length !== 3) {
    throw new Error(`selftest: expected 3 errors, got ${errors.length}`)
  }
  if (errors[0].file !== 'app/a.ts' || errors[0].code !== 'TS2322') {
    throw new Error('selftest: first error parsed incorrectly')
  }

  const top = topFiles(errors)
  if (top[0] !== '  2\tapp/a.ts' || top[1] !== '  1\tapp/b.ts') {
    throw new Error(`selftest: topFiles ordering wrong: ${top.join(' | ')}`)
  }

  const noisy = parseErrors(
    'Found 3 errors in 2 files.\n\n  Related information\n'
  )
  if (noisy.length !== 0) {
    throw new Error('selftest: non-error lines were miscounted as errors')
  }

  const unresolvedTypeLib =
    "error TS2688: Cannot find type definition file for 'node'.\n"
  if (parseErrors(unresolvedTypeLib).length !== 0) {
    throw new Error(
      'selftest: unprefixed diagnostic should not parse as an error'
    )
  }
  if (findFatalDiagnostics(unresolvedTypeLib).length !== 1) {
    throw new Error('selftest: TS2688 was not detected as a fatal diagnostic')
  }
  if (
    findUnusableRunReasons({ output: unresolvedTypeLib, status: 2 }).length ===
    0
  ) {
    throw new Error('selftest: unresolved type library did not fail closed')
  }
  if (
    findUnusableRunReasons({
      output:
        'tsconfig.tests.json(5,7): error TS5023: Unknown compiler option.',
      status: 1
    }).length === 0
  ) {
    throw new Error('selftest: tsconfig diagnostic did not fail closed')
  }
  if (findUnusableRunReasons({ output: '', status: 1 }).length === 0) {
    throw new Error(
      'selftest: nonzero exit with no diagnostics did not fail closed'
    )
  }
  if (
    findUnusableRunReasons({ output: '', status: null, spawnError: 'ENOENT' })
      .length === 0
  ) {
    throw new Error('selftest: spawn failure did not fail closed')
  }
  if (
    findUnusableRunReasons({
      output:
        "tests/unit/a.test.ts(3,7): error TS6133: 'x' is declared but its value is never read.\nFound 1 error.",
      status: 2
    }).length !== 0
  ) {
    throw new Error('selftest: ordinary TS6133 error was misread as fatal')
  }
  if (findUnusableRunReasons({ output, status: 2 }).length !== 0) {
    throw new Error('selftest: ordinary diagnostic run was misread as unusable')
  }

  const locked = {
    '': { name: 'app' },
    'node_modules/lib-a': { version: '2.0.0' },
    'node_modules/lib-b': { version: '1.0.0' },
    'node_modules/lib-optional-os': { version: '1.0.0', optional: true }
  }
  const matching = {
    'node_modules/lib-a': { version: '2.0.0' },
    'node_modules/lib-b': { version: '1.0.0' }
  }
  if (findInstallDrift(locked, matching).length !== 0) {
    throw new Error('selftest: a matching install was reported as drifted')
  }
  const stale = findInstallDrift(locked, {
    'node_modules/lib-a': { version: '1.9.0' },
    'node_modules/lib-extraneous': { version: '0.1.0' }
  })
  const expected = [
    'node_modules/lib-a: installed 1.9.0, locked 2.0.0',
    'node_modules/lib-extraneous: installed 0.1.0, not in the lockfile',
    'node_modules/lib-b: locked 1.0.0, not installed'
  ]
  if (stale.join('\n') !== expected.join('\n')) {
    throw new Error(
      `selftest: stale install not detected: ${stale.join(' | ')}`
    )
  }

  console.log('test-typecheck ratchet selftest OK')
}

function main() {
  const argv = process.argv.slice(2)
  const mode = argv.includes('--update')
    ? 'update'
    : argv.includes('--selftest')
      ? 'selftest'
      : 'check'
  const fromIndex = argv.indexOf('--from')
  const fromFile = fromIndex === -1 ? undefined : argv[fromIndex + 1]

  if (mode === 'selftest') {
    selfTest()
    return
  }

  if (!fromFile) {
    const drift = readInstallDrift()
    if (drift.length > 0) {
      console.error(
        'test typecheck ratchet FAILED: node_modules does not match package-lock.json, ' +
          'so the error count is not trustworthy. Run `npm ci`.'
      )
      for (const line of drift.slice(0, 10)) console.error(`  - ${line}`)
      if (drift.length > 10)
        console.error(`  ... and ${drift.length - 10} more`)
      process.exit(1)
    }
  }

  const run = runTsc(fromFile)
  const unusable = findUnusableRunReasons(run)
  if (unusable.length > 0) {
    console.error(
      'test typecheck ratchet FAILED: tsc could not type-check the project, ' +
        'so the error count is not trustworthy. Failing closed.'
    )
    for (const reason of unusable) console.error(`  - ${reason}`)
    process.exit(1)
  }

  const errors = parseErrors(run.output)
  const count = errors.length

  if (mode === 'update') {
    if (fs.existsSync(BASELINE_PATH)) {
      const baseline = readBaseline()
      if (count > baseline) {
        console.error(
          `--update refuses to raise the baseline (${baseline} -> ${count}); ` +
            'fix the new error(s), or raise it by hand with rationale in the PR.'
        )
        for (const line of topFiles(errors)) console.error(line)
        process.exit(1)
      }
    }
    writeBaseline(count)
    console.log(
      `baseline written: ${path.relative(ROOT, BASELINE_PATH)} (maxErrors: ${count})`
    )
    return
  }

  const baseline = readBaseline()
  console.log(`tsc -p ${TSCONFIG}: ${count} error(s), baseline ${baseline}`)
  if (count > 0) {
    console.log('files by error count (most errors first):')
    for (const line of topFiles(errors)) console.log(line)
  }

  if (count > baseline) {
    console.error(
      `\ntest typecheck ratchet FAILED: ${count} error(s) exceeds the committed baseline of ${baseline}.`
    )
    console.error(
      'Fix the new error(s) above, or — for a deliberate, reviewed exception — ' +
        'raise scripts/validation/test-typecheck-baseline.json by hand in this PR with a rationale.'
    )
    process.exit(1)
  }

  if (count < baseline) {
    console.log(
      `\n${baseline - count} error(s) resolved since the baseline was set. Ratchet it down with:\n` +
        '  node scripts/validation/check-test-typecheck-ratchet.mjs --update'
    )
  }

  console.log(`\ntest typecheck ratchet OK (${count} <= baseline ${baseline})`)
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) main()
