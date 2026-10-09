import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const refusal = {
  code: 'ESCHEMA',
  message: 'Local schema state is incompatible; activation refused'
}
const schema = '8'.repeat(64)

// Copy the unchanged public journey into an isolated package. Only its native
// service boundary is replaced; no database or child process runs in this test.
async function fixture(t, incompatible = refusal) {
  const root = await mkdtemp(join(tmpdir(), 'synthetic Windows recovery '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = join(root, 'state')
  await mkdir(join(state, 'pgdata'), { recursive: true })
  await writeFile(join(state, 'schema-version'), schema)
  const rows = [
    { id: 1, userId: 'synthetic-player-a' },
    { id: 2, userId: 'synthetic-player-b' },
    { id: 3, userId: 'synthetic-player-c' },
    { id: 4, userId: 'synthetic-player-d' },
    { id: 5, userId: 'synthetic-player-a' },
    { id: 6, userId: 'synthetic-player-b' },
    { id: 7, userId: 'synthetic-player-c' },
    { id: 8, userId: 'synthetic-player-d' }
  ]
  await writeFile(join(state, 'pgdata', 'synthetic-rows'), JSON.stringify(rows))
  await writeFile(
    join(root, 'recovery.mjs'),
    await readFile(
      new URL(
        '../../../apps/desktop/platform/windows/recovery.mjs',
        import.meta.url
      )
    )
  )
  await writeFile(
    join(root, 'services.mjs'),
    `import { EventEmitter } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export async function nativeServices(config) {
  const marker = await readFile(join(config.state, 'schema-version'), 'utf8')
    .catch(error => { if (error.code === 'ENOENT') return null; throw error })
  config.calls.push(marker)
  if (marker === 'incompatible' && config.incompatible !== null)
    throw Object.assign(new Error(config.incompatible.message), { code: config.incompatible.code })
  if (marker === null)
    await writeFile(join(config.state, 'schema-version'), config.schema)
  const child = new EventEmitter()
  const service = {
    children: [new EventEmitter(), child],
    fault: undefined,
    async stop() { config.stops++ },
    async psql(sql) {
      if (sql.startsWith('BEGIN;')) throw new Error('synthetic SQL rollback')
      if (sql.startsWith('SELECT to_regclass(')) return 't'
      if (sql.startsWith('SELECT jsonb_agg('))
        return readFile(join(config.state, 'pgdata', 'synthetic-rows'), 'utf8')
      throw new Error('Unexpected synthetic SQL')
    }
  }
  child.kill = () => {
    service.fault = new Error('synthetic Auth stop')
    queueMicrotask(() => child.emit('exit'))
    return true
  }
  return service
}
`
  )
  const config = { state, schema, incompatible, calls: [], stops: 0 }
  const { nativeServices } = await import(
    pathToFileURL(join(root, 'services.mjs')).href
  )
  const { recoveryJourney } = await import(
    pathToFileURL(join(root, 'recovery.mjs')).href
  )
  const initial = await nativeServices(config)
  const evidencePath = join(root, 'evidence.json')
  return { state, rows, config, initial, recoveryJourney, evidencePath }
}

test('exact schema refusal permits all later recovery controls and restores the marker', async (t) => {
  const f = await fixture(t)
  await f.recoveryJourney(f.initial, f.config, f.evidencePath)
  assert.deepEqual(JSON.parse(await readFile(f.evidencePath, 'utf8')).checks, [
    'failed-sql-transaction-retains-canonical-data',
    'actual-auth-crash-stops-stack-and-restart-retains-rows',
    'incompatible-schema-refused-before-service-start',
    'lost-schema-marker-restored-without-rebootstrap',
    'stopped-database-checkpoint-and-same-workspace-restore'
  ])
  assert.deepEqual(f.config.calls, [
    schema,
    schema,
    'incompatible',
    null,
    schema
  ])
  assert.equal(await readFile(join(f.state, 'schema-version'), 'utf8'), schema)
  assert.deepEqual(
    JSON.parse(
      await readFile(join(f.state, 'pgdata', 'synthetic-rows'), 'utf8')
    ),
    f.rows
  )
  assert.ok(f.config.stops >= 4)
})

for (const [name, incompatible] of [
  ['wrong code', { ...refusal, code: 'EOTHER' }],
  ['wrong message', { ...refusal, message: 'A different refusal' }],
  [
    'message substring',
    { ...refusal, message: `prefix ${refusal.message} suffix` }
  ],
  ['legacy message', { ...refusal, message: 'Incompatible local schema' }],
  ['resolved call', null]
]) {
  test(`${name} cannot qualify recovery and still restores the marker`, async (t) => {
    const f = await fixture(t, incompatible)
    await assert.rejects(
      f.recoveryJourney(f.initial, f.config, f.evidencePath),
      { code: 'ERR_ASSERTION' }
    )
    assert.equal(
      await readFile(join(f.state, 'schema-version'), 'utf8'),
      schema
    )
    assert.deepEqual(f.config.calls, [schema, schema, 'incompatible'])
    await assert.rejects(readFile(f.evidencePath), { code: 'ENOENT' })
    await assert.rejects(
      readFile(
        join(
          f.state,
          '.checkpoints',
          'native-proof',
          'pgdata',
          'synthetic-rows'
        )
      ),
      {
        code: 'ENOENT'
      }
    )
    assert.ok(f.config.stops >= 3)
  })
}
