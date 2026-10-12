#!/usr/bin/env node

// Parity check: every supabase/migrations file is either applied by the
// desktop local-schema bootstrap (its bytes hash to a sourceFileSha256 pinned
// in manifest.json) or recorded with a reason in
// unsupported-production-migrations.json.

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url))

export const DEFAULT_MIGRATIONS_DIRECTORY = resolve(
  scriptDirectory,
  '../../../supabase/migrations'
)
export const DEFAULT_MANIFEST_PATH = resolve(scriptDirectory, 'manifest.json')
export const DEFAULT_CLASSIFICATION_PATH = resolve(
  scriptDirectory,
  'unsupported-production-migrations.json'
)

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// The set of source file hashes the bootstrap selected, read from the manifest.
export const PINNED_SECTIONS = [
  'objects',
  'seasonPlanningAuthoritySources',
  'savedAssignmentsAuthoritySources'
]

export const UNSUPPORTED_REASONS = [
  'production-only-role',
  'production-app-schema',
  'hosted-service-integration',
  'schema-retirement',
  'data-backfill'
]

export function appliedSourceHashes(manifest) {
  const hashes = new Set()
  for (const section of PINNED_SECTIONS)
    for (const entry of manifest?.[section] ?? [])
      if (entry?.sourceFileSha256) hashes.add(entry.sourceFileSha256)
  return hashes
}

// Pure parity rule. `appliedHashes` is the set of sha256 digests of the source
// migrations the bootstrap applies; `migrationEntries` is [{ name, sha256 }]
// for every supabase/migrations file; `classifications` is [{ file, reason }]
// from unsupported-production-migrations.json. Returns one error string per
// violation: a migration that is neither applied nor classified, or a
// classification that names a file that does not exist.
export function parityErrors(appliedHashes, migrationEntries, classifications) {
  const appliedNames = new Set()
  for (const entry of migrationEntries)
    if (appliedHashes.has(entry.sha256)) appliedNames.add(entry.name)

  const classifiedNames = new Set(
    classifications.map((classification) => classification.file)
  )
  const errors = []

  for (const entry of migrationEntries) {
    if (!appliedNames.has(entry.name) && !classifiedNames.has(entry.name))
      errors.push(
        `${entry.name}: not applied by the local-schema bootstrap and not classified as unsupported`
      )
  }

  const knownFiles = new Set(migrationEntries.map((entry) => entry.name))
  for (const classification of classifications) {
    if (!UNSUPPORTED_REASONS.includes(classification.reason))
      errors.push(
        `${classification.file}: unsupported classification has unknown reason ${JSON.stringify(classification.reason)}`
      )
    if (appliedNames.has(classification.file))
      errors.push(
        `${classification.file}: classified as unsupported but applied by the local-schema bootstrap`
      )
    if (!knownFiles.has(classification.file))
      errors.push(
        `${classification.file}: unsupported classification names a missing migration file`
      )
  }

  return errors
}

export function listMigrations(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
}

export function migrationEntries(directory) {
  return listMigrations(directory).map((name) => ({
    name,
    sha256: sha256(readFileSync(join(directory, name)))
  }))
}

export function readClassifications(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'))
  return Array.isArray(document) ? document : (document.unsupported ?? [])
}

export function checkParity({
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY,
  manifestPath = DEFAULT_MANIFEST_PATH,
  classificationPath = DEFAULT_CLASSIFICATION_PATH
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entries = migrationEntries(migrationsDirectory)
  const classifications = readClassifications(classificationPath)
  const appliedHashes = appliedSourceHashes(manifest)
  const appliedFiles = entries
    .filter((entry) => appliedHashes.has(entry.sha256))
    .map((entry) => entry.name)

  return {
    errors: parityErrors(appliedHashes, entries, classifications),
    fileCount: entries.length,
    appliedCount: appliedFiles.length,
    appliedFiles,
    classifiedCount: classifications.length
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function main() {
  const check = process.argv.includes('--check')
  const report = checkParity({
    migrationsDirectory:
      optionValue('--migrations') ?? DEFAULT_MIGRATIONS_DIRECTORY,
    manifestPath: optionValue('--manifest') ?? DEFAULT_MANIFEST_PATH,
    classificationPath:
      optionValue('--classification') ?? DEFAULT_CLASSIFICATION_PATH
  })

  if (report.errors.length) {
    for (const error of report.errors)
      console.error(`migration-parity: ${error}`)
    process.exitCode = 1
    return
  }

  if (check) {
    console.log(
      `migration-parity: ${report.fileCount} supabase/migrations file(s) checked — ${report.appliedCount} applied by the local-schema bootstrap, ${report.classifiedCount} classified as deliberately unsupported.`
    )
    return
  }

  console.log(
    `migration-parity report: ${report.fileCount} supabase/migrations file(s); ${report.appliedCount} applied by the local-schema bootstrap, ${report.classifiedCount} classified as deliberately unsupported.`
  )
  console.log(
    'Applied by the local-schema bootstrap (manifest.json sourceFileSha256):'
  )
  for (const file of report.appliedFiles) console.log(`  ${file}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
