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

// Statistics counters are cumulative, per node, and restart at the last reset
// or server start. A migration that cites a zero counter as evidence must say
// which window it read.
const STATS_HEADER =
  '-- stats-window: start=2026-01-01T00:00:00Z age=21d nodes=3 minimum=14d'

function statsWindowErrors(contents) {
  const root = fixtureDir()
  try {
    writeMigration(root, '20260101000000_drop_unused_index.sql', contents)
    return checkMigrations({ directory: root }).errors
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a migration citing a zero counter without a stats-window header fails', () => {
  for (const citation of [
    'idx_scan = 0',
    'idx_scan<=0',
    'n_tup_ins = 0',
    'n_live_tup < 0',
    'never scanned',
    'Never-Scanned'
  ]) {
    const errors = statsWindowErrors(
      `-- ${citation}\nDROP INDEX public.ix_widget;\n`
    )
    assert.equal(errors.length, 1, citation)
    assert.match(errors[0], /no '-- stats-window:' header/, citation)
  }
})

test('a migration citing a zero counter with a valid stats-window header passes', () => {
  assert.deepEqual(
    statsWindowErrors(
      `${STATS_HEADER}\n-- idx_scan = 0 over the window\nDROP INDEX public.ix_widget;\n`
    ),
    []
  )
  assert.deepEqual(
    statsWindowErrors(
      '-- stats-window: start=2026-01-01T00:00:00+00:00 age=20d4h nodes=1 minimum=14d\n-- n_tup_ins = 0\nselect 1;\n'
    ),
    []
  )
})

test('a migration that cites no counter needs no stats-window header', () => {
  assert.deepEqual(statsWindowErrors('DROP INDEX public.ix_widget;\n'), [])
})

test('an invalid stats-window header fails with the reason', () => {
  const cases = [
    ['start=unknown age=21d nodes=3 minimum=14d', /not an ISO-8601 timestamp/],
    [
      'start=2026-01-01T00:00:00 age=21d nodes=3 minimum=14d',
      /not an ISO-8601 timestamp/
    ],
    [
      'start=2026-01-01T00:00:00Z age=soon nodes=3 minimum=14d',
      /age='soon' is not a duration/
    ],
    ['start=2026-01-01T00:00:00Z age=21d nodes=0 minimum=14d', /nodes='0'/],
    [
      'start=2026-01-01T00:00:00Z age=21d nodes=3 minimum=2d',
      /below the 14d floor/
    ],
    [
      'start=2026-01-01T00:00:00Z age=5d nodes=3 minimum=14d',
      /shorter than the stated minimum/
    ],
    ['start=2026-01-01T00:00:00Z age=21d nodes=3', /expected exactly/],
    [
      'start=2026-01-01T00:00:00Z age=21d nodes=3 minimum=14d trailing',
      /expected exactly/
    ]
  ]
  for (const [fields, reason] of cases) {
    const errors = statsWindowErrors(
      `-- stats-window: ${fields}\n-- idx_scan = 0\nselect 1;\n`
    )
    assert.equal(errors.length, 1, fields)
    assert.match(errors[0], reason, fields)
  }
})

test('the stats-window header must appear once, in the first 40 lines', () => {
  const twice = statsWindowErrors(
    `${STATS_HEADER}\n${STATS_HEADER}\n-- idx_scan = 0\nselect 1;\n`
  )
  assert.equal(twice.length, 1)
  assert.match(twice[0], /exactly one is required/)

  const late = statsWindowErrors(
    `${'select 1;\n'.repeat(40)}${STATS_HEADER}\n-- idx_scan = 0\n`
  )
  assert.equal(late.length, 1)
  assert.match(late[0], /must be in the first 40 lines/)
})

test('zero-counter citations written as prose or pasted output are detected', () => {
  for (const citation of [
    'idx_scan: 0',
    'observed idx_scan was 0',
    'n_live_tup is 0',
    'idx_scan | 0'
  ]) {
    const errors = statsWindowErrors(`-- ${citation}\nselect 1;\n`)
    assert.equal(errors.length, 1, citation)
    assert.match(errors[0], /no '-- stats-window:' header/, citation)
  }
  assert.deepEqual(statsWindowErrors('-- idx_scan was 10\nselect 1;\n'), [])
})

test('a live counter predicate in SQL is not evidence and needs no header', () => {
  assert.deepEqual(
    statsWindowErrors(
      'CREATE VIEW ops.unused_indexes AS\n  SELECT indexrelid FROM pg_stat_user_indexes WHERE idx_scan = 0;\n'
    ),
    []
  )
  const blockComment = statsWindowErrors(
    '/* idx_scan = 0 on the primary */\nDROP INDEX public.ix_widget;\n'
  )
  assert.equal(blockComment.length, 1)
})

test('an impossible stats-window start is rejected', () => {
  for (const start of [
    '2026-99-99T99:99:99+24:99',
    '2026-02-30T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00+15:00'
  ]) {
    const errors = statsWindowErrors(
      `-- stats-window: start=${start} age=21d nodes=3 minimum=14d\n-- idx_scan = 0\nselect 1;\n`
    )
    assert.equal(errors.length, 1, start)
    assert.match(errors[0], /not an ISO-8601 timestamp/, start)
  }
})

test('a table drop justified by row counters must cite count(*)', () => {
  const noCount = statsWindowErrors(
    `${STATS_HEADER}\n-- n_live_tup = 0 and n_tup_ins = 0\nDROP TABLE public.widgets;\n`
  )
  assert.equal(noCount.length, 1)
  assert.match(noCount[0], /count\(\*\)/)

  assert.deepEqual(
    statsWindowErrors(
      `${STATS_HEADER}\n-- n_tup_ins = 0; SELECT count(*) FROM public.widgets returned 0\nDROP TABLE IF EXISTS public.widgets;\n`
    ),
    []
  )
  assert.deepEqual(
    statsWindowErrors(
      `${STATS_HEADER}\n-- idx_scan = 0\nDROP INDEX public.ix_widget;\n`
    ),
    []
  )
})
