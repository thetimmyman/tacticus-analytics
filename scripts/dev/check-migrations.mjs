#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FILENAME_PATTERN = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/

// Another tree shares this version clock; from the cutoff this repo's versions
// end in :00 seconds (theirs in :30), so only newer versions are checked.
export const VERSION_SUFFIX_CUTOFF = '20260920000000'

const CHECKS_PERFORMED = [
  'filename shape (YYYYMMDDHHMMSS_snake_case.sql)',
  'version uniqueness and ordering',
  'non-empty contents',
  'no nested migration directories',
  `version suffix (":00" seconds) for versions newer than ${VERSION_SUFFIX_CUTOFF}`
]

// Lints source files only; never connects to a database.
export function checkMigrations({ directory } = {}) {
  const resolvedDirectory = path.resolve(directory ?? 'supabase/migrations')
  const entries = readdirSync(resolvedDirectory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const versions = new Map()
  const errors = []

  if (directories.length > 0)
    errors.push(
      `nested migration directories are not allowed: ${directories.join(', ')}`
    )
  if (files.length === 0) errors.push('no migrations found')

  for (const file of files) {
    const match = file.match(FILENAME_PATTERN)
    if (!match) {
      errors.push(`${file}: expected YYYYMMDDHHMMSS_snake_case.sql`)
      continue
    }

    const duplicates = versions.get(match[1]) ?? []
    duplicates.push(file)
    versions.set(match[1], duplicates)

    if (match[1] > VERSION_SUFFIX_CUTOFF && !match[1].endsWith('00')) {
      errors.push(
        `${file}: version ${match[1]} must end in "00" (this repository's allocation for migrations newer than ${VERSION_SUFFIX_CUTOFF} — see supabase/README.md)`
      )
    }

    if (
      readFileSync(path.join(resolvedDirectory, file), 'utf8').trim().length ===
      0
    ) {
      errors.push(`${file}: migration is empty`)
    }
  }

  for (const [version, matches] of versions) {
    if (matches.length > 1)
      errors.push(
        `${version}: duplicate migration version (${matches.join(', ')})`
      )
  }

  return { errors, fileCount: files.length, directory: resolvedDirectory }
}

function main() {
  const { errors, fileCount } = checkMigrations()

  if (errors.length > 0) {
    errors.forEach((error) => console.error(`migration-lint: ${error}`))
    process.exit(1)
  }

  console.log(
    `migration-lint: ${fileCount} migration source file(s) checked — ${CHECKS_PERFORMED.join(', ')}. Database applied state NOT checked; verifying which migrations are actually applied requires a separate, environment-specific reconciliation check against a live database.`
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
