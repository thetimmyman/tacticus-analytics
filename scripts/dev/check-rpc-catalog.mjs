#!/usr/bin/env node
// Every literal `.rpc('name')` must be created by a migration or allowlisted:
// a missing function returns PGRST202, which an error-ignoring caller reports as success.
// Usage: node scripts/dev/check-rpc-catalog.mjs [--selftest]

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

// Missing names have lived in supabase/functions/.
const CALLER_ROOTS = ['app', 'packages', 'scripts', 'supabase/functions']
const MIGRATIONS_DIR = 'supabase/migrations'
const ALLOWLIST_PATH = 'scripts/dev/rpc-catalog.allowlist.json'

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git'])

// This gate quotes the call shape in its own prose and tests; nothing else is exempt.
const SELF_PATH = 'scripts/dev/check-rpc-catalog.mjs'

// Literal first argument only; a computed name cannot be checked statically.
const RPC_CALL = /\.rpc\(\s*(['"`])([A-Za-z0-9_]+)\1/g

const CREATE_FUNCTION =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:[A-Za-z0-9_]+|"[^"]+")\s*\.\s*)?("?)([A-Za-z0-9_]+)\1\s*\(/gi

function walkSourceFiles(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkSourceFiles(full, out)
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** @returns {Map<string, string[]>} rpc name -> sorted unique caller paths */
export function collectRpcCallers(root, callerRoots = CALLER_ROOTS) {
  const callers = new Map()
  for (const rel of callerRoots) {
    for (const file of walkSourceFiles(path.join(root, rel), [])) {
      const relPath = path.relative(root, file).split(path.sep).join('/')
      if (relPath === SELF_PATH) continue
      const source = fs.readFileSync(file, 'utf8')
      for (const match of source.matchAll(RPC_CALL)) {
        const name = match[2]
        const seen = callers.get(name)
        if (seen) seen.add(relPath)
        else callers.set(name, new Set([relPath]))
      }
    }
  }
  return new Map(
    [...callers].map(([name, set]) => [name, [...set].sort()]).sort()
  )
}

export function collectCreatedFunctions(root, migrationsDir = MIGRATIONS_DIR) {
  const created = new Set()
  const dir = path.join(root, migrationsDir)
  let files
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
  } catch {
    return created
  }
  for (const file of files.sort()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const match of sql.matchAll(CREATE_FUNCTION)) created.add(match[2])
  }
  return created
}

function readAllowlist(root, allowlistPath = ALLOWLIST_PATH) {
  const raw = fs.readFileSync(path.join(root, allowlistPath), 'utf8')
  const parsed = JSON.parse(raw)
  const entries = Array.isArray(parsed.entries) ? parsed.entries : []
  return entries
}

/** Pure, so the selftest can drive it. @returns {{problems: string[], stats: object}} */
export function evaluate({ callers, created, allowlist }) {
  const problems = []
  const allowByName = new Map(allowlist.map((e) => [e.name, e]))

  for (const entry of allowlist) {
    if (typeof entry.name !== 'string' || !entry.name) {
      problems.push(`allowlist entry has no "name": ${JSON.stringify(entry)}`)
      continue
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 40) {
      problems.push(
        `allowlist entry "${entry.name}" has no substantive "reason". ` +
          `Every exception is justified in writing or it is not an exception.`
      )
    }
    if (created.has(entry.name)) {
      problems.push(
        `allowlist entry "${entry.name}" is STALE: a migration now creates it. ` +
          `Remove the entry.`
      )
    }
    if (!callers.has(entry.name)) {
      problems.push(
        `allowlist entry "${entry.name}" is STALE: nothing calls it any more. ` +
          `Remove the entry.`
      )
    }
  }

  const missing = []
  for (const [name, files] of callers) {
    if (created.has(name)) continue
    if (allowByName.has(name)) continue
    missing.push({ name, files })
  }
  for (const { name, files } of missing) {
    problems.push(
      `RPC "${name}" is called but no migration creates it.\n` +
        files.map((f) => `      caller: ${f}`).join('\n') +
        `\n      Decide it: add the CREATE FUNCTION migration, delete the caller, ` +
        `or record the decision in ${ALLOWLIST_PATH}. Do not add four stubs to satisfy a grep.`
    )
  }

  return {
    problems,
    stats: {
      distinctCalledNames: callers.size,
      createdInMigrations: created.size,
      allowlisted: allowlist.length,
      undecided: missing.length
    }
  }
}

function runGate(root) {
  const callers = collectRpcCallers(root)
  const created = collectCreatedFunctions(root)
  const allowlist = readAllowlist(root)
  const { problems, stats } = evaluate({ callers, created, allowlist })

  // Positive control: if the extractor stops matching, these numbers collapse.
  console.log(
    `rpc-catalog: ${stats.distinctCalledNames} distinct .rpc() names across ` +
      `${CALLER_ROOTS.join(', ')}; ${stats.createdInMigrations} functions created in ` +
      `${MIGRATIONS_DIR}; ${stats.allowlisted} allowlisted.`
  )
  if (stats.distinctCalledNames === 0 || stats.createdInMigrations === 0) {
    console.error(
      '::error::rpc-catalog: extractor found nothing. That is a broken scan, not a clean repo.'
    )
    return 1
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`::error::rpc-catalog: ${p}`)
    return 1
  }
  console.log(
    'rpc-catalog: every called RPC has a definition or a tracked decision — OK'
  )
  return 0
}

function selftest() {
  let failures = 0
  const check = (label, actual, expected) => {
    const ok = actual === expected
    if (!ok) failures++
    console.log(`  ${ok ? 'ok' : 'FAIL'} — ${label}`)
    if (!ok) console.log(`      expected ${expected}, got ${actual}`)
  }

  const callers = new Map([
    ['good_fn', ['app/x.ts']],
    ['undecided_fn', ['supabase/functions/y/index.ts']],
    ['tracked_fn', ['supabase/functions/z/index.ts']]
  ])
  const created = new Set(['good_fn'])
  const reason = 'x'.repeat(60)

  let r = evaluate({ callers, created, allowlist: [] })
  check('undefined name is reported', r.stats.undecided, 2)

  r = evaluate({
    callers,
    created,
    allowlist: [{ name: 'tracked_fn', reason }]
  })
  check('allowlisted name is tolerated', r.stats.undecided, 1)
  check(
    'remaining undefined name still reported',
    r.problems.filter((p) => p.includes('undecided_fn')).length,
    1
  )

  r = evaluate({
    callers: new Map([['good_fn', ['app/x.ts']]]),
    created,
    allowlist: []
  })
  check('fully defined repo passes', r.problems.length, 0)

  r = evaluate({
    callers: new Map([['good_fn', ['app/x.ts']]]),
    created,
    allowlist: [{ name: 'good_fn', reason }]
  })
  check(
    'allowlist entry superseded by a migration is reported',
    r.problems.filter((p) => p.includes('STALE')).length,
    1
  )

  r = evaluate({
    callers: new Map([['good_fn', ['app/x.ts']]]),
    created,
    allowlist: [{ name: 'gone_fn', reason }]
  })
  check(
    'allowlist entry with no caller left is reported',
    r.problems.filter((p) => p.includes('STALE')).length,
    1
  )

  r = evaluate({
    callers,
    created,
    allowlist: [{ name: 'tracked_fn', reason: 'because' }]
  })
  check(
    'allowlist entry without a substantive reason is reported',
    r.problems.filter((p) => p.includes('substantive')).length,
    1
  )

  // A known-good migration-created RPC must be visible to the real extractors.
  const realCallers = collectRpcCallers(REPO_ROOT)
  const realCreated = collectCreatedFunctions(REPO_ROOT)
  check(
    'positive control: extractor finds many real .rpc() callers',
    realCallers.size > 50,
    true
  )
  check(
    'positive control: known RPC get_guild_member_stats is seen as created',
    realCreated.has('get_guild_member_stats'),
    true
  )
  check(
    'positive control: get_all_boss_hp is found in the clean baseline',
    realCreated.has('get_all_boss_hp'),
    true
  )

  console.log(
    failures === 0 ? 'selftest: OK' : `selftest: ${failures} FAILURE(S)`
  )
  return failures === 0 ? 0 : 1
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  process.exit(
    process.argv.includes('--selftest') ? selftest() : runGate(REPO_ROOT)
  )
}
