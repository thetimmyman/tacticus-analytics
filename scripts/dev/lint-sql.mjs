#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'

const DEFAULT_ALLOWLIST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'rls-no-policy.allowlist.txt'
)

function loadAllowlist(allowlistPath = DEFAULT_ALLOWLIST_PATH) {
  const allowlist = new Set()
  if (!existsSync(allowlistPath)) return allowlist
  for (const rawLine of readFileSync(allowlistPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (line) allowlist.add(line)
  }
  return allowlist
}

// Hard gate: an RLS table with no policy must be listed in rls-no-policy.allowlist.txt.
export async function lintSql(
  patterns,
  { allowlistPath = DEFAULT_ALLOWLIST_PATH } = {}
) {
  const errors = []
  const warnings = []

  const files = new Set()
  for (const pattern of patterns) {
    if (/[*?[\]{}]/.test(pattern)) {
      for (const match of await glob(pattern, { nodir: true })) files.add(match)
    } else {
      files.add(pattern)
    }
  }

  const policies = new Set()
  for (const file of files) {
    if (!existsSync(file) || path.extname(file) !== '.sql') continue
    const sql = readFileSync(file, 'utf8')
    for (const match of sql.matchAll(
      /CREATE\s+POLICY\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|[\w-]+)\s+ON\s+(?:public\.)?"?(\w+)"?/gi
    )) {
      policies.add(match[1])
    }
  }

  const allowlist = loadAllowlist(allowlistPath)
  const rlsNoPolicyTables = new Set()

  for (const file of [...files].sort()) {
    if (!existsSync(file)) {
      errors.push(`${file}: missing file`)
      continue
    }

    const sql = readFileSync(file, 'utf8')
    // TODO: near-vacuous; matches literal misspellings like "CREAT TABLE" only.
    sql.split(/\r?\n/).forEach((line, index) => {
      const statement = line.replace(/--.*$/, '')
      if (
        /\b(CREAT\s+TABLE|CREAT\s+FUNCTION|SELET)\b/i.test(statement) ||
        /\bSELECT\b.*\bFORM\b/i.test(statement)
      ) {
        errors.push(`${file}:${index + 1}: possible SQL typo: ${line.trim()}`)
      }
    })

    for (const match of sql.matchAll(
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?"?(\w+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
    )) {
      if (!policies.has(match[1])) {
        rlsNoPolicyTables.add(`public.${match[1]}`)
      }
    }

    // A drop-index migration's DROP list and verify list must match: a miss raises after CONCURRENTLY
    // drops that cannot roll back, and SQL cannot share one list.
    const code = sql.replace(/--.*$/gm, '')
    const dropped = new Set(
      [
        ...code.matchAll(
          /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi
        )
      ].map((match) => match[1])
    )
    const verified = new Set()
    for (const match of code.matchAll(/relname\s+IN\s*\(([^)]*)\)/gi)) {
      for (const name of match[1].matchAll(/'([^']+)'/g)) verified.add(name[1])
    }

    if (dropped.size > 0 && verified.size > 0) {
      const missingFromVerify = [...dropped]
        .filter((n) => !verified.has(n))
        .sort()
      const missingFromDrop = [...verified]
        .filter((n) => !dropped.has(n))
        .sort()
      for (const name of missingFromVerify) {
        errors.push(
          `${file}: index ${name} is dropped but absent from the verify relname IN (...) list`
        )
      }
      for (const name of missingFromDrop) {
        errors.push(
          `${file}: index ${name} is in the verify relname IN (...) list but never dropped; the verify block will raise after the drops commit`
        )
      }
    }
  }

  for (const table of [...rlsNoPolicyTables].sort()) {
    if (!allowlist.has(table)) {
      errors.push(
        `${table}: RLS enabled with no CREATE POLICY and not in ${allowlistPath}; either add a policy or add it to the allowlist if this is intentionally fail-closed`
      )
    }
  }

  for (const table of [...allowlist].sort()) {
    if (!rlsNoPolicyTables.has(table)) {
      warnings.push(
        `${table} is in ${allowlistPath} but no longer matches an RLS-enabled table with no policy (policy added, or table dropped/renamed) -- prune it from the allowlist`
      )
    }
  }

  return {
    fileCount: files.size,
    rlsNoPolicyCount: rlsNoPolicyTables.size,
    errors,
    warnings
  }
}

async function main() {
  const patterns = process.argv.slice(2)
  if (patterns.length === 0) {
    console.error('lint-sql: expected at least one SQL file or glob.')
    process.exit(2)
  }

  const result = await lintSql(patterns)

  for (const warning of result.warnings) {
    console.error(`lint-sql: warning: ${warning}`)
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error)
    console.error(`lint-sql: ${result.errors.length} error(s).`)
    process.exit(1)
  }

  console.log(
    `lint-sql: checked ${result.fileCount} file(s); ${result.rlsNoPolicyCount} RLS table(s) without a policy (all allowlisted).`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
