#!/usr/bin/env node
// Reporting-only: checks retirement-registry.json signatures against the retiring
// product's live database (read-only analytics_ro) and edge functions via kubectl exec.
// Unreachable live state is reported, never passed.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

const REGISTRY_PATH = path.join(__dirname, 'retirement-registry.json')
const APP_IDENTITY_PATH = path.join(repoRoot, '.app-identity.json')
const NAMESPACE = 'tacticus'

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function sh(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function findPodsByPrefix(prefix) {
  const out = sh('kubectl', [
    'get',
    'pods',
    '-n',
    NAMESPACE,
    '-o',
    'jsonpath={range .items[*]}{.metadata.name} {.status.phase}\n{end}'
  ])
  return out
    .split('\n')
    .filter((l) => l.startsWith(prefix) && l.includes('Running'))
    .map((l) => l.split(' ')[0])
}

// A leaked session can pin one pod's analytics_ro at its connection limit, so try every pod.
function queryGeneralDb(sql) {
  const pods = findPodsByPrefix('patroni-')
  if (pods.length === 0) {
    throw new Error(
      `could not find a Running patroni-* pod in namespace ${NAMESPACE}; cannot reach the shared General database`
    )
  }
  const errors = []
  for (const pod of pods) {
    try {
      return sh('kubectl', [
        'exec',
        '-n',
        NAMESPACE,
        pod,
        '--',
        'psql',
        '-U',
        'analytics_ro',
        '-h',
        '127.0.0.1',
        '-d',
        'postgres',
        '-tAc',
        sql
      ]).trim()
    } catch (err) {
      errors.push(`${pod}: ${err.message}`)
    }
  }
  throw new Error(
    `every patroni-* pod refused the analytics_ro query: ${errors.join(' | ')}`
  )
}

function listDeployedEdgeFunctions() {
  const pods = findPodsByPrefix('supabase-edge-functions-')
  if (pods.length === 0) {
    throw new Error(
      `could not find a Running supabase-edge-functions-* pod in namespace ${NAMESPACE}; cannot reach the deployed edge-function set`
    )
  }
  const errors = []
  for (const pod of pods) {
    try {
      const out = sh('kubectl', [
        'exec',
        '-n',
        NAMESPACE,
        pod,
        '--',
        'ls',
        '/home/deno/functions'
      ])
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    } catch (err) {
      errors.push(`${pod}: ${err.message}`)
    }
  }
  throw new Error(
    `every supabase-edge-functions-* pod refused the ls: ${errors.join(' | ')}`
  )
}

function checkDbColumnValue(sig) {
  const count = Number(queryGeneralDb(sig.detect))
  if (Number.isNaN(count)) {
    return {
      ok: false,
      live: true,
      detail: `query did not return a number: ${sig.detect}`
    }
  }
  const ok = count === sig.expected
  return {
    ok,
    live: true,
    detail: ok
      ? `${sig.table}.${sig.column}: ${count} rows match, expected ${sig.expected}`
      : `migration on shared General database reinstated ${sig.table}.${sig.column}` +
        ` on ${count} guilds (expected ${sig.expected})`
  }
}

function checkDbTableExists(sig) {
  const tableList = sig.tables.map((t) => `'${t.split('.').pop()}'`).join(',')
  const sql = `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${tableList})`
  const out = queryGeneralDb(sql)
  const found = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const ok = found.length === 0
  return {
    ok,
    live: true,
    detail: ok
      ? `none of [${sig.tables.join(', ')}] exist on the shared General database`
      : `migration on shared General database reinstated retired table(s): ${found.join(', ')}`
  }
}

function checkClusterEdgeFunction(sig) {
  const deployed = listDeployedEdgeFunctions()
  const found = sig.functionNames.filter((name) => deployed.includes(name))
  const ok = found.length === 0
  return {
    ok,
    live: true,
    detail: ok
      ? `none of [${sig.functionNames.join(', ')}] are deployed in namespace ${sig.target}`
      : `shared image redeployed edge function(s) [${found.join(', ')}] into this product's ` +
        `namespace (${sig.target}, deployment supabase-edge-functions)`
  }
}

function checkSignature(sig) {
  switch (sig.type) {
    case 'db-column-value':
      return checkDbColumnValue(sig)
    case 'db-table-exists':
      return checkDbTableExists(sig)
    case 'cluster-edge-function':
      return checkClusterEdgeFunction(sig)
    default:
      return {
        ok: false,
        live: false,
        detail: `unknown signature type: ${sig.type}`
      }
  }
}

function main() {
  const registry = loadJson(REGISTRY_PATH)
  const identity = loadJson(APP_IDENTITY_PATH)
  const thisProduct = identity.appId

  let anyFailure = false
  const lines = []
  lines.push(`Retirement registry gate -- product=${thisProduct}`)
  lines.push(`Registry: ${REGISTRY_PATH}`)
  lines.push(
    'This gate reads LIVE state (database + cluster), never the repository.'
  )
  lines.push('')

  for (const entry of registry.entries) {
    if (entry.product !== thisProduct) {
      lines.push(
        `[skip] ${entry.capability}: registered against product '${entry.product}', not '${thisProduct}'`
      )
      continue
    }
    lines.push(
      `[${entry.capability}] ruling: ${entry.ruling} (${entry.rulingDate})`
    )
    for (const sig of entry.signatures) {
      let result
      try {
        result = checkSignature(sig)
      } catch (err) {
        result = {
          ok: false,
          live: false,
          detail: `could not reach live state: ${err.message}`
        }
      }
      const status = result.ok ? 'PASS' : 'FAIL'
      if (!result.ok) anyFailure = true
      lines.push(
        `  [${status}] (${sig.type}, target=${sig.target}) ${result.detail}`
      )
    }
    lines.push('')
  }

  if (registry.openQuestions?.length) {
    lines.push('Open questions (not gated, see PR description):')
    for (const q of registry.openQuestions) lines.push(`  - ${q}`)
    lines.push('')
  }

  lines.push(
    anyFailure
      ? 'RESULT: FAIL (reporting-only; this does not block CI)'
      : 'RESULT: PASS'
  )

  console.log(lines.join('\n'))
  // Reporting-only, but a real exit code lets a caller enforce it later.
  process.exitCode = anyFailure ? 1 : 0
}

main()
