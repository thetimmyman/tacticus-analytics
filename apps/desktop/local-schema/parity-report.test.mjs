import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appliedSourceHashes,
  parityErrors,
  checkParity
} from './parity-report.mjs'

const scriptPath = fileURLToPath(
  new URL('./parity-report.mjs', import.meta.url)
)
const digest = (value) => createHash('sha256').update(value).digest('hex')

function fixtureDir() {
  return mkdtempSync(join(tmpdir(), 'ta-migration-parity-'))
}

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? ''
    }
  }
}

function writeFixture(
  root,
  { appliedSql, extraMigrations = [], unsupported = [] }
) {
  const migrationsDirectory = join(root, 'migrations')
  mkdirSync(migrationsDirectory, { recursive: true })
  if (appliedSql !== undefined) {
    writeFileSync(
      join(migrationsDirectory, '20260101000000_applied.sql'),
      appliedSql
    )
  }
  for (const { name, sql } of extraMigrations)
    writeFileSync(join(migrationsDirectory, name), sql)

  const manifestPath = join(root, 'manifest.json')
  writeFileSync(
    manifestPath,
    JSON.stringify({
      objects:
        appliedSql === undefined
          ? []
          : [{ sourceFileSha256: digest(appliedSql) }]
    })
  )
  const classificationPath = join(
    root,
    'unsupported-production-migrations.json'
  )
  writeFileSync(classificationPath, JSON.stringify({ unsupported }))
  return { migrationsDirectory, manifestPath, classificationPath }
}

test('appliedSourceHashes collects the pinned source file hashes', () => {
  const manifest = {
    objects: [
      { sourceFileSha256: 'a'.repeat(64) },
      { sourceFileSha256: 'b'.repeat(64) },
      { sourceFileSha256: 'a'.repeat(64) }
    ]
  }
  assert.deepEqual([...appliedSourceHashes(manifest)].sort(), [
    'a'.repeat(64),
    'b'.repeat(64)
  ])
})

test('appliedSourceHashes includes every manifest section that pins SQL', () => {
  const manifest = {
    objects: [{ sourceFileSha256: 'a'.repeat(64) }],
    seasonPlanningAuthoritySources: [{ sourceFileSha256: 'b'.repeat(64) }],
    savedAssignmentsAuthoritySources: [{ sourceFileSha256: 'c'.repeat(64) }]
  }
  assert.equal(appliedSourceHashes(manifest).size, 3)
})

test('parityErrors rejects an unknown classification reason', () => {
  const errors = parityErrors(
    new Set(),
    [{ name: '20260102000000_x.sql', sha256: digest('select 1;') }],
    [{ file: '20260102000000_x.sql', reason: 'because' }]
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /unknown reason/)
})

test('parityErrors rejects a migration that is both applied and classified', () => {
  const sql = 'create table both_ways (id int);'
  const errors = parityErrors(
    new Set([digest(sql)]),
    [{ name: '20260102000000_both.sql', sha256: digest(sql) }],
    [{ file: '20260102000000_both.sql', reason: 'data-backfill' }]
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /applied by the local-schema bootstrap/)
})

test('parityErrors accepts a set where every migration is applied or classified', () => {
  const applied = 'create table applied (id int);'
  const classified = 'create table classified (id int);'
  const errors = parityErrors(
    new Set([digest(applied)]),
    [
      { name: '20260101000000_applied.sql', sha256: digest(applied) },
      { name: '20260102000000_classified.sql', sha256: digest(classified) }
    ],
    [{ file: '20260102000000_classified.sql', reason: 'production-only-role' }]
  )
  assert.deepEqual(errors, [])
})

test('parityErrors flags a migration that is neither applied nor classified', () => {
  const errors = parityErrors(
    new Set(),
    [{ name: '20260102000000_orphan.sql', sha256: digest('select 1;') }],
    []
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /20260102000000_orphan\.sql/)
  assert.match(errors[0], /not applied/)
})

test('parityErrors flags a classification that names a missing file', () => {
  const errors = parityErrors(
    new Set(),
    [],
    [{ file: '20260103000000_missing.sql', reason: 'data-backfill' }]
  )
  assert.equal(errors.length, 1)
  assert.match(errors[0], /20260103000000_missing\.sql/)
  assert.match(errors[0], /missing migration file/)
})

test('checkParity is green on the current tree', () => {
  const report = checkParity()
  assert.deepEqual(report.errors, [])
  assert.equal(report.appliedCount, 7)
  assert.equal(report.classifiedCount, report.fileCount - report.appliedCount)
})

test('CLI --check is green on the current tree', () => {
  const cli = runCli(['--check'])
  assert.equal(cli.status, 0)
  assert.match(cli.stdout, /supabase\/migrations file\(s\) checked/)
})

test('CLI --check fails on a fixture with an unclassified migration', () => {
  const root = fixtureDir()
  try {
    const f = writeFixture(root, {
      appliedSql: 'create table applied_widgets (id int);\n',
      extraMigrations: [
        {
          name: '20260102000000_orphan.sql',
          sql: 'create table orphan_widgets (id int);\n'
        }
      ]
    })

    const report = checkParity(f)
    assert.equal(report.errors.length, 1)
    assert.match(report.errors[0], /20260102000000_orphan\.sql/)

    const cli = runCli([
      '--check',
      '--migrations',
      f.migrationsDirectory,
      '--manifest',
      f.manifestPath,
      '--classification',
      f.classificationPath
    ])
    assert.notEqual(cli.status, 0)
    assert.match(cli.stderr, /20260102000000_orphan\.sql/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CLI --check fails when a classification names a missing file', () => {
  const root = fixtureDir()
  try {
    const f = writeFixture(root, {
      appliedSql: 'create table applied_widgets (id int);\n',
      unsupported: [
        { file: '20260103000000_missing.sql', reason: 'data-backfill' }
      ]
    })

    const report = checkParity(f)
    assert.equal(report.errors.length, 1)
    assert.match(report.errors[0], /20260103000000_missing\.sql/)

    const cli = runCli([
      '--check',
      '--migrations',
      f.migrationsDirectory,
      '--manifest',
      f.manifestPath,
      '--classification',
      f.classificationPath
    ])
    assert.notEqual(cli.status, 0)
    assert.match(cli.stderr, /20260103000000_missing\.sql/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
