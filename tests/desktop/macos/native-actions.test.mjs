import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { createNativeActions, exportCachedPersonal } = createRequire(
  import.meta.url
)('../../../apps/desktop/platform/macos/native-actions.cjs')
const expired = () =>
  Object.assign(new Error('Unlock required'), { code: 'ESESSION' })
const personal = {
  displayName: 'Synthetic Offline Player',
  upstreamUpdatedAt: 1
}

function fixture({
  requestSession,
  writeDestination,
  unlock = async () => {}
}) {
  const failures = []
  const actions = createNativeActions({
    perform: (operation, scope, path) => {
      assert.equal(operation, 'export')
      assert.equal(scope, 'Player')
      return exportCachedPersonal({ path, requestSession, writeDestination })
    },
    unlock,
    failed: async (error, operation) => failures.push({ error, operation })
  })
  return { actions, failures }
}

test('expired export resumes the chosen native destination with a fresh session and no credentials', async () => {
  let session = 'expired',
    reads = 0,
    unlocks = 0
  const writes = [],
    destination = '/synthetic destination ü/personal.json'
  const f = fixture({
    requestSession: async () => {
      reads++
      if (session === 'expired') throw expired()
      assert.equal(session, 'new-session')
      return {
        personal,
        token: 'SYNTHETIC-TOKEN-CANARY',
        vaultReferences: { Player: 'SYNTHETIC-HANDLE-CANARY' }
      }
    },
    writeDestination: async (...args) => writes.push(args),
    unlock: async () => unlocks++
  })
  await f.actions.run('export', 'Player', destination)
  assert.equal(reads, 1)
  assert.equal(unlocks, 1)
  assert.deepEqual(writes, [])
  session = 'new-session'
  assert.equal(await f.actions.resume(), true)
  assert.equal(reads, 2)
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], destination)
  assert.deepEqual(writes[0][2], { mode: 0o600, flag: 'wx' })
  assert.deepEqual(JSON.parse(writes[0][1]), {
    schemaVersion: 'macos-personal-export/v1',
    personal,
    freshness: { syncedAt: 1, offlineReadable: true }
  })
  assert.equal(writes[0][1].includes('CANARY'), false)
  assert.equal(await f.actions.resume(), false)
  assert.deepEqual(f.failures, [])
})

test('unlock navigation can resume before its loadURL promise resolves without losing the export', async () => {
  let reads = 0,
    writes = 0,
    actions
  const f = fixture({
    requestSession: async () => {
      if (++reads === 1) throw expired()
      return { personal }
    },
    writeDestination: async () => writes++,
    unlock: async () => assert.equal(await actions.resume(), true)
  })
  actions = f.actions
  await actions.run('export', 'Player', '/synthetic/export.json')
  assert.equal(reads, 2)
  assert.equal(writes, 1)
  assert.equal(await actions.resume(), false)
})

test('repeated expiry never writes early and retains the same destination for another unlock', async () => {
  let reads = 0,
    unlocks = 0
  const writes = []
  const f = fixture({
    requestSession: async () => {
      if (++reads < 3) throw expired()
      return { personal }
    },
    writeDestination: async (path) => writes.push(path),
    unlock: async () => unlocks++
  })
  await f.actions.run('export', 'Player', '/synthetic/retry.json')
  assert.equal(await f.actions.resume(), true)
  assert.deepEqual(writes, [])
  assert.equal(await f.actions.resume(), true)
  assert.deepEqual(writes, ['/synthetic/retry.json'])
  assert.equal(unlocks, 2)
})

test('destination refusal preserves existing data and clears the continuation', async () => {
  const files = new Map([['/synthetic/existing.json', 'existing bytes']])
  let unlocks = 0
  const f = fixture({
    requestSession: async () => ({ personal }),
    writeDestination: async (path, bytes, options) => {
      assert.equal(options.flag, 'wx')
      if (files.has(path))
        throw Object.assign(new Error('Already exists'), { code: 'EEXIST' })
      files.set(path, bytes)
    },
    unlock: async () => unlocks++
  })
  await f.actions.run('export', 'Player', '/synthetic/existing.json')
  assert.equal(files.get('/synthetic/existing.json'), 'existing bytes')
  assert.equal(f.failures.length, 1)
  assert.equal(f.failures[0].error.code, 'EEXIST')
  assert.equal(unlocks, 0)
  assert.equal(await f.actions.resume(), false)
})

test('import retries retain only operation, scope and native path', async () => {
  const calls = []
  const actions = createNativeActions({
    perform: async (...args) => {
      calls.push(args)
      if (calls.length === 1) throw expired()
    },
    unlock: async () => {},
    failed: async () => assert.fail('Unexpected failure')
  })
  await actions.run('import', 'Player', '/synthetic/import.json')
  assert.equal(await actions.resume(), true)
  assert.deepEqual(calls, [
    ['import', 'Player', '/synthetic/import.json'],
    ['import', 'Player', '/synthetic/import.json']
  ])
})

test('an in-flight operation cannot start a duplicate destination write', async () => {
  let finish,
    reads = 0
  const gate = new Promise((accept) => {
      finish = accept
    }),
    writes = []
  const f = fixture({
    requestSession: async () => {
      reads++
      await gate
      return { personal }
    },
    writeDestination: async (path) => writes.push(path)
  })
  const first = f.actions.run('export', 'Player', '/synthetic/first.json')
  await f.actions.run('export', 'Player', '/synthetic/second.json')
  assert.equal(reads, 1)
  finish()
  await first
  assert.deepEqual(writes, ['/synthetic/first.json'])
})
