import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { createNativeActions, exportCachedPersonal } = createRequire(
  import.meta.url
)('../../../apps/desktop/platform/macos/native-actions.cjs')
const expired = () =>
  Object.assign(new Error('Session expired'), { code: 'ESESSION' })
const personal = {
  displayName: 'Synthetic Offline Player',
  upstreamUpdatedAt: 1
}

test('expired export automatically recovers once and keeps its native destination and secret-free bytes', async () => {
  let reads = 0,
    recoveries = 0
  const writes = []
  const actions = createNativeActions({
    perform: (_operation, _scope, path) =>
      exportCachedPersonal({
        path,
        requestSession: async () => {
          if (++reads === 1) throw expired()
          return {
            personal,
            token: 'SYNTHETIC-TOKEN-CANARY',
            vaultReferences: { Player: 'SYNTHETIC-HANDLE-CANARY' }
          }
        },
        writeDestination: async (...args) => writes.push(args)
      }),
    recover: async () => {
      recoveries++
      return true
    },
    failed: async () => assert.fail('Unexpected failure')
  })
  await actions.run(
    'export',
    'Player',
    '/synthetic destination ü/personal.json'
  )
  assert.equal(reads, 2)
  assert.equal(recoveries, 1)
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], '/synthetic destination ü/personal.json')
  assert.deepEqual(writes[0][2], { mode: 0o600, flag: 'wx' })
  assert.deepEqual(JSON.parse(writes[0][1]), {
    schemaVersion: 'macos-personal-export/v1',
    personal,
    freshness: { syncedAt: 1, offlineReadable: true }
  })
  assert.equal(writes[0][1].includes('CANARY'), false)
})

test('recovery navigation cannot duplicate an in-flight native write', async () => {
  let reads = 0,
    actions
  const writes = []
  actions = createNativeActions({
    perform: async (_operation, _scope, path) => {
      if (++reads === 1) throw expired()
      writes.push(path)
    },
    recover: async () => {
      await actions.run('export', 'Player', '/synthetic/duplicate.json')
      return true
    },
    failed: async () => assert.fail('Unexpected failure')
  })
  await actions.run('export', 'Player', '/synthetic/original.json')
  assert.equal(reads, 2)
  assert.deepEqual(writes, ['/synthetic/original.json'])
})

test('persistent expiry stops after one recovery, without an unbounded reopen loop', async () => {
  let attempts = 0,
    recoveries = 0,
    failures = 0
  const actions = createNativeActions({
    perform: async () => {
      attempts++
      throw expired()
    },
    recover: async () => {
      recoveries++
      return true
    },
    failed: async (error) => {
      assert.equal(error.code, 'ESESSION')
      failures++
    }
  })
  await actions.run('import', 'Player', '/synthetic/source.json')
  assert.equal(attempts, 2)
  assert.equal(recoveries, 1)
  assert.equal(failures, 1)
})

test('failed recovery and destination refusal preserve existing data', async () => {
  const files = new Map([['/synthetic/existing.json', 'existing bytes']])
  const errors = []
  let ready = false
  const actions = createNativeActions({
    perform: (operation, scope, path) =>
      exportCachedPersonal({
        path,
        requestSession: async () => {
          if (!ready) throw expired()
          return { personal }
        },
        writeDestination: async (path, bytes, options) => {
          assert.equal(options.flag, 'wx')
          if (files.has(path))
            throw Object.assign(new Error('Already exists'), { code: 'EEXIST' })
          files.set(path, bytes)
        }
      }),
    recover: async () => false,
    failed: async (error) => errors.push(error.code)
  })
  await actions.run('export', 'Player', '/synthetic/existing.json')
  ready = true
  await actions.run('export', 'Player', '/synthetic/existing.json')
  assert.deepEqual(errors, ['ESESSION', 'EEXIST'])
  assert.equal(files.get('/synthetic/existing.json'), 'existing bytes')
})
