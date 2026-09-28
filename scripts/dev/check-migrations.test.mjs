import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkMigrations, VERSION_SUFFIX_CUTOFF } from './check-migrations.mjs'

const scriptPath = fileURLToPath(
  new URL('./check-migrations.mjs', import.meta.url)
)

function fixtureDir() {
  return mkdtempSync(join(tmpdir(), 'ta-migrations-lint-'))
}

function writeMigration(directory, name, contents = 'select 1;\n') {
  writeFileSync(join(directory, name), contents)
}

function runCli(directory) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      cwd: directory,
      encoding: 'utf8'
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

test('valid fixture passes and reports what it checked', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, '20260101000000_create_widgets.sql')
    writeMigration(migrationsDir, '20260102000000_add_widget_index.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.deepEqual(result.errors, [])
    assert.equal(result.fileCount, 2)

    const cli = runCli(root)
    assert.equal(cli.status, 0)
    assert.match(cli.stdout, /2 migration source file\(s\) checked/)
    assert.match(cli.stdout, /filename shape/)
    assert.match(cli.stdout, /version uniqueness and ordering/)
    assert.match(cli.stdout, /non-empty contents/)
    assert.match(cli.stdout, /nested migration directories/)
    assert.match(cli.stdout, /database applied state NOT checked/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects an empty migration file', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, '20260101000000_create_widgets.sql', '')

    const result = checkMigrations({ directory: migrationsDir })
    assert.ok(result.errors.some((error) => error.includes('is empty')))

    const cli = runCli(root)
    assert.notEqual(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a duplicate migration version', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, '20260101000000_create_widgets.sql')
    writeMigration(migrationsDir, '20260101000000_create_gadgets.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.ok(
      result.errors.some((error) =>
        error.includes('duplicate migration version')
      )
    )

    const cli = runCli(root)
    assert.notEqual(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a malformed filename', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, 'not-a-valid-migration-name.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.ok(
      result.errors.some((error) =>
        error.includes('expected YYYYMMDDHHMMSS_snake_case.sql')
      )
    )

    const cli = runCli(root)
    assert.notEqual(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a nested migration directory', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(join(migrationsDir, 'nested'), { recursive: true })
    writeMigration(migrationsDir, '20260101000000_create_widgets.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.ok(
      result.errors.some((error) =>
        error.includes('nested migration directories are not allowed')
      )
    )

    const cli = runCli(root)
    assert.notEqual(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects an empty migrations directory', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })

    const result = checkMigrations({ directory: migrationsDir })
    assert.ok(
      result.errors.some((error) => error.includes('no migrations found'))
    )

    const cli = runCli(root)
    assert.notEqual(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a post-cutoff version ending in "00" passes', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, '20260921000000_create_widgets.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.deepEqual(result.errors, [])

    const cli = runCli(root)
    assert.equal(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a post-cutoff version ending in "30" fails', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, '20260921000030_scratch.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.ok(
      result.errors.some(
        (error) =>
          error.includes('20260921000030_scratch.sql') &&
          error.includes('must end in "00"')
      )
    )

    const cli = runCli(root)
    assert.notEqual(cli.status, 0)
    assert.match(cli.stderr, /must end in "00"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a pre-cutoff version ending in "30" is ignored (existing files untouched)', () => {
  const root = fixtureDir()
  try {
    const migrationsDir = join(root, 'supabase/migrations')
    mkdirSync(migrationsDir, { recursive: true })
    writeMigration(migrationsDir, '20260904000030_pre_existing.sql')

    const result = checkMigrations({ directory: migrationsDir })
    assert.deepEqual(result.errors, [])

    const cli = runCli(root)
    assert.equal(cli.status, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the cutoff constant matches the migration authoring doc', () => {
  assert.equal(VERSION_SUFFIX_CUTOFF, '20260920000000')
})

test('the rename is complete: no reconcile alias remains and tooling:check calls the lint script', () => {
  const packageJsonPath = fileURLToPath(
    new URL('../../package.json', import.meta.url)
  )
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  assert.equal('migrations:reconcile:check' in packageJson.scripts, false)
  assert.ok('migrations:lint' in packageJson.scripts)
  assert.match(packageJson.scripts['tooling:check'], /migrations:lint\b/)
  assert.doesNotMatch(
    packageJson.scripts['tooling:check'],
    /migrations:reconcile:check/
  )
})
