import { test, after } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  prepareSchema,
  completeSchema,
  checkpoint
} from './schema-lifecycle.mjs'
const temporaryRoots = []
after(async () => {
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))
  )
})
const target = 'a'.repeat(64),
  source = 'b'.repeat(64)
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-schema-control-'))
  temporaryRoots.push(root)
  const state = join(root, 'state'),
    schemaDirectory = join(root, 'schema')
  await mkdir(state, { mode: 0o700 })
  await mkdir(schemaDirectory, { mode: 0o700 })
  return { root, state, schemaDirectory, target }
}
async function legacy(f) {
  await mkdir(join(f.state, 'pgdata'), { mode: 0o700 })
  await writeFile(join(f.state, 'pgdata', 'PG_VERSION'), '18', { mode: 0o600 })
  await writeFile(join(f.state, 'pgdata', 'synthetic-data'), 'committed-row', {
    mode: 0o600
  })
  await writeFile(
    join(f.state, 'credentials.json'),
    'synthetic-private-test-credential',
    { mode: 0o600 }
  )
  await writeFile(join(f.state, 'schema-version'), source, { mode: 0o600 })
  await mkdir(join(f.schemaDirectory, 'migrations'))
  const sql = 'GRANT SELECT ON public.feature_releases TO desktop_rpc_reader;'
  await writeFile(
    join(f.schemaDirectory, 'migrations', '001-feature-catalog.sql'),
    sql
  )
  await writeFile(
    join(f.schemaDirectory, 'migrations.json'),
    JSON.stringify([
      {
        from: source,
        to: target,
        file: '001-feature-catalog.sql',
        sha256: createHash('sha256').update(sql).digest('hex')
      }
    ])
  )
}
test('checkpoint rejects a linked database root before copying external data', async () => {
  const f = await fixture()
  const outside = join(f.root, 'outside')
  await mkdir(outside, { mode: 0o700 })
  await writeFile(join(outside, 'foreign-data'), 'private', { mode: 0o600 })
  await symlink(outside, join(f.state, 'pgdata'))
  await assert.rejects(checkpoint(f.state, source), /linked|real directory/i)
  assert.equal(await readFile(join(outside, 'foreign-data'), 'utf8'), 'private')
})
test('unknown legacy state stays unchanged and produces no checkpoint', async () => {
  const f = await fixture()
  await legacy(f)
  await writeFile(join(f.state, 'schema-version'), 'unknown')
  await assert.rejects(prepareSchema(f), /Incompatible/)
  assert.equal(
    await readFile(join(f.state, 'schema-version'), 'utf8'),
    'unknown'
  )
  assert.ok(!(await readdir(f.state)).includes('backups'))
})
test('missing version on an existing database is never treated as a fresh bootstrap', async () => {
  const f = await fixture()
  await mkdir(join(f.state, 'pgdata'))
  await writeFile(join(f.state, 'pgdata', 'PG_VERSION'), '18')
  await assert.rejects(prepareSchema(f), /Incompatible/)
  await assert.rejects(readFile(join(f.state, 'schema-version')), {
    code: 'ENOENT'
  })
})
test('checkpoint excludes runtime lease/journal and precedes the incompatible transition marker', async () => {
  const f = await fixture()
  await legacy(f)
  await writeFile(join(f.state, 'running.lock'), 'synthetic-owned-lease')
  await writeFile(join(f.state, 'runtime.lease'), 'synthetic-lease')
  const plan = await prepareSchema(f)
  const backup = join(f.state, 'backups', plan.transition.backup)
  assert.ok(!(await readdir(backup)).includes('running.lock'))
  assert.ok(!(await readdir(backup)).includes('runtime.lease'))
  assert.equal(await readFile(join(backup, 'schema-version'), 'utf8'), source)
  assert.equal(
    await readFile(join(backup, 'pgdata', 'synthetic-data'), 'utf8'),
    'committed-row'
  )
  const next = await prepareSchema(f)
  assert.equal(next.transition.backup, plan.transition.backup)
})
test('corrupted checkpoint blocks transition resumption without altering original data', async () => {
  const f = await fixture()
  await legacy(f)
  const plan = await prepareSchema(f)
  await writeFile(
    join(
      f.state,
      'backups',
      plan.transition.backup,
      'pgdata',
      'synthetic-data'
    ),
    'corrupted'
  )
  await assert.rejects(prepareSchema(f), /checkpoint is incomplete/)
  assert.equal(
    await readFile(join(f.state, 'pgdata', 'synthetic-data'), 'utf8'),
    'committed-row'
  )
})
test('a committed target receipt completes an interrupted marker without applying SQL twice', async () => {
  const f = await fixture()
  await legacy(f)
  const plan = await prepareSchema(f)
  const queries = []
  const psql = async (sql) => {
    queries.push(sql)
    return sql.includes('to_regclass') ? 't' : target
  }
  assert.deepEqual(await completeSchema({ ...f, plan, psql }), {
    recovered: true
  })
  assert.equal(queries.length, 2)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), target)
})
test('SQL failure preserves the checkpoint and pending marker so an old app cannot activate', async () => {
  const f = await fixture()
  await legacy(f)
  const plan = await prepareSchema(f)
  const marker = await readFile(join(f.state, 'schema-version'), 'utf8')
  const psql = async (sql) => {
    if (sql.startsWith('SELECT')) return 'f'
    throw Error('Synthetic migration failure')
  }
  await assert.rejects(
    completeSchema({ ...f, plan, psql }),
    /Synthetic migration failure/
  )
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), marker)
  assert.notEqual(marker, source)
  assert.equal(
    await readFile(
      join(
        f.state,
        'backups',
        plan.transition.backup,
        'pgdata',
        'synthetic-data'
      ),
      'utf8'
    ),
    'committed-row'
  )
})
test('database major mismatch refuses activation before checkpoint or marker changes', async () => {
  const f = await fixture()
  await legacy(f)
  await writeFile(join(f.state, 'pgdata', 'PG_VERSION'), '17')
  await assert.rejects(prepareSchema(f), /Incompatible/)
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), source)
  assert.ok(!(await readdir(f.state)).includes('backups'))
})
test('a changed migration cannot resume a pending workspace even with a newly valid manifest', async () => {
  const f = await fixture()
  await legacy(f)
  await prepareSchema(f)
  const sql = 'SELECT 1;'
  await writeFile(
    join(f.schemaDirectory, 'migrations', '001-feature-catalog.sql'),
    sql
  )
  await writeFile(
    join(f.schemaDirectory, 'migrations.json'),
    JSON.stringify([
      {
        from: source,
        to: target,
        file: '001-feature-catalog.sql',
        sha256: createHash('sha256').update(sql).digest('hex')
      }
    ])
  )
  await assert.rejects(prepareSchema(f), /Incompatible/)
  assert.equal(
    await readFile(join(f.state, 'pgdata', 'synthetic-data'), 'utf8'),
    'committed-row'
  )
})
