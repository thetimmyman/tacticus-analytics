import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv
} from 'node:crypto'
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const menuFactory = createRequire(import.meta.url)('../launcher/game-menu.cjs')
const roots = []
test('native menus refuse foreign, credentialed or non-setup coordinator destinations', async () => {
  for (const url of [
    'https://127.0.0.1:54321/desktop/setup',
    'http://foreign.invalid:54321/desktop/setup',
    'http://127.0.0.1/desktop/setup',
    'http://synthetic-user@127.0.0.1:54321/desktop/setup',
    'http://127.0.0.1:54321/desktop/setup?destination=foreign.invalid',
    'http://127.0.0.1:54321/desktop/setup#changed',
    'http://127.0.0.1:54321/other'
  ])
    await assert.rejects(
      menuFactory(
        {},
        { url },
        {
          electron: {},
          nativeSecretPrompt: () => {
            throw new Error('Unexpected prompt')
          }
        }
      ),
      /Invalid local desktop destination/
    )
})
after(async () => {
  for (const path of roots) await rm(path, { recursive: true, force: true })
})
async function fixture(action) {
  const state = await mkdtemp(join(tmpdir(), 'desktop-game-menu-'))
  roots.push(state)
  const secret = randomUUID(),
    subject = randomUUID(),
    guildId = randomUUID(),
    password = randomBytes(16).toString('hex'),
    cipherKey = randomBytes(32)
  const f = {
    choice: 1,
    calls: [],
    messages: [],
    prompts: [],
    queries: 0,
    expired: false,
    cancelKey: false,
    state,
    secret,
    password
  }
  const storage = {
    isEncryptionAvailable() {
      f.queries++
      return true
    },
    getSelectedStorageBackend() {
      f.queries++
      return 'gnome_libsecret'
    },
    encryptString(value) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', cipherKey, iv)
      const body = Buffer.concat([c.update(value, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), body])
    },
    decryptString(value) {
      const c = createDecipheriv(
        'aes-256-gcm',
        cipherKey,
        value.subarray(0, 12)
      )
      c.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([c.update(value.subarray(28)), c.final()]).toString(
        'utf8'
      )
    }
  }
  const app = new EventEmitter(),
    items = new Map()
  const electron = {
    app,
    safeStorage: storage,
    session: {
      fromPartition(name) {
        assert.match(name, /^native-game-[a-f0-9]{32}$/)
        const hooks = {}
        f.coordinator = {
          webRequest: {
            onBeforeRequest(callback) {
              hooks.request = callback
            },
            onBeforeSendHeaders(callback) {
              hooks.headers = callback
            }
          },
          async fetch(url, options) {
            const before = await new Promise((resolve) =>
              hooks.request({ url }, resolve)
            )
            if (before.cancel) throw new Error('Request blocked')
            const headers = await new Promise((resolve) =>
              hooks.headers({ url, requestHeaders: options.headers }, resolve)
            )
            if (headers.cancel) throw new Error('Request blocked')
            assert.match(
              headers.requestHeaders['x-desktop-transport'],
              /^[a-f0-9]{64}$/
            )
            assert.match(
              headers.requestHeaders['x-desktop-broker'],
              /^[a-f0-9]{64}$/
            )
            return globalThis.fetch(url, {
              ...options,
              headers: headers.requestHeaders
            })
          }
        }
        return f.coordinator
      }
    },
    Menu: {
      getApplicationMenu: () => ({ getMenuItemById: (id) => items.get(id) })
    },
    dialog: {
      showMessageBox: async (_window, value) => {
        f.messages.push(value)
        return { response: value.type === 'question' ? f.choice : 0 }
      }
    }
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    f.calls.push({ url, options })
    if (url.startsWith('http://127.0.0.1:54321')) {
      assert(!JSON.stringify(options).includes(secret))
      const body = JSON.parse(options.body)
      if (url.endsWith('/broker-context')) {
        assert.equal(body.password, password)
        if (f.oversizedContext)
          return new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(16385))
              },
              cancel() {
                f.cancelledResponse = true
              }
            })
          )
        return Response.json({ installation: subject, guildCode: 'SYN001' })
      }
      if (url.endsWith('/broker-status'))
        return Response.json({ connected: body.connected })
      if (url.endsWith('/import')) {
        f.imported = JSON.parse(body.contents)
        return Response.json({ entries: 1, inserted: 1, repeated: false })
      }
      throw new Error('Unexpected local operation')
    }
    assert.equal(options.headers['X-API-KEY'], secret)
    if (f.expired) return Response.json({}, { status: 403 })
    if (url.endsWith('/player'))
      return Response.json({
        player: { details: { name: 'Synthetic Player' } },
        metaData: {
          scopes: ['Player', 'Guild', 'Guild Raid'],
          apiKeyExpiresOn: Math.floor(Date.now() / 1000) + 3600
        }
      })
    if (url.endsWith('/guild'))
      return Response.json({ guild: { guildId, guildTag: 'SYN001' } })
    assert.equal(url, 'https://api.tacticusgame.com/api/v1/guildRaid')
    return Response.json({
      season: 9999,
      entries: [
        {
          userId: 'synthetic-unmapped-player',
          type: 'SyntheticBoss',
          damageType: 'Battle',
          damageDealt: 250,
          remainingHp: 750,
          maxHp: 1000,
          tier: 5,
          set: 1,
          encounterIndex: 0,
          rarity: 'Legendary',
          startedOn: '2000-01-01T00:00:00Z',
          completedOn: '2000-01-01T00:00:10Z',
          heroDetails: [{ unitId: 'synthetic-hero', power: 5700 }]
        }
      ]
    })
  }
  try {
    const values = await menuFactory(
      {},
      {
        url: 'http://127.0.0.1:54321/desktop/setup',
        state,
        transportKey: randomBytes(32).toString('hex'),
        brokerToken: randomBytes(32).toString('hex')
      },
      {
        electron,
        nativeSecretPrompt: async (kind) => {
          f.prompts.push(kind)
          if (kind === 'workspace-password') return password
          if (f.cancelKey)
            throw Object.assign(new Error('Connection cancelled.'), {
              code: 'ECANCEL'
            })
          return secret
        }
      }
    )
    for (const item of values) items.set(item.id, item)
    f.connect = () => items.get('game-connect').click()
    f.sync = () => items.get('game-sync').click()
    f.disconnect = () => items.get('game-disconnect').click()
    f.app = app
    await action(f)
  } finally {
    globalThis.fetch = originalFetch
  }
}
test('refusing native permission leaves credentials, OS provider and upstream untouched', async () =>
  fixture(async (f) => {
    f.choice = 0
    await f.connect()
    assert.equal(f.queries, 0)
    assert.equal(f.prompts.length, 0)
    assert(f.calls.every((c) => c.url.endsWith('/broker-status')))
    assert.equal((await readdir(f.state)).length, 0)
  }))
test('the main-only coordinator partition refuses foreign origins, query input and unlisted local operations', async () =>
  fixture(async (f) => {
    for (const url of [
      'https://foreign.invalid/desktop/import',
      'http://127.0.0.1:54322/desktop/import',
      'http://127.0.0.1:54321/desktop/import?changed=1',
      'http://127.0.0.1:54321/api/player-api-key'
    ])
      await assert.rejects(
        f.coordinator.fetch(url, { headers: {} }),
        /Request blocked/
      )
    assert.deepEqual(f.calls, [])
    assert.equal(f.queries, 0)
  }))
test('cancelled key entry quietly preserves offline use and creates no encrypted credential', async () =>
  fixture(async (f) => {
    f.cancelKey = true
    await f.connect()
    assert.deepEqual(f.prompts, ['workspace-password', 'official-key'])
    assert(f.calls.every((c) => c.url.startsWith('http://127.0.0.1:54321')))
    assert.equal(f.messages.filter((m) => m.type === 'error').length, 0)
    await assert.rejects(stat(join(f.state, 'game-vault')), { code: 'ENOENT' })
  }))
test('an oversized local response is cancelled before credentials or upstream access', async () =>
  fixture(async (f) => {
    f.oversizedContext = true
    await f.connect()
    assert.equal(f.cancelledResponse, true)
    assert.equal(f.queries, 0)
    assert.deepEqual(f.prompts, ['workspace-password'])
    assert(f.calls.every((c) => c.url.startsWith('http:')))
    assert.deepEqual(await readdir(f.state), [])
  }))
test('native actions keep root keys outside local requests, preserve hero power and assign explicit unmapped labels', async () =>
  fixture(async (f) => {
    await f.connect()
    const record = await readFile(
      join(f.state, 'official-raid-connection.json'),
      'utf8'
    )
    assert(!record.includes(f.secret))
    const files = await readdir(join(f.state, 'game-vault'))
    assert.equal(files.length, 1)
    assert.equal(
      (await readFile(join(f.state, 'game-vault', files[0]))).includes(
        Buffer.from(f.secret)
      ),
      false
    )
    await f.sync()
    assert.match(
      f.imported.entries[0].username,
      /^Unmapped player [a-f0-9]{16}$/
    )
    assert.equal(f.imported.entries[0].heroDetails[0].power, 5700)
    assert(!JSON.stringify(f.messages).includes(f.secret))
    assert(
      !JSON.stringify(
        f.calls.filter((c) => c.url.startsWith('http:'))
      ).includes(f.secret)
    )
    await f.disconnect()
    assert.deepEqual(await readdir(join(f.state, 'game-vault')), [])
    await assert.rejects(stat(join(f.state, 'official-raid-connection.json')), {
      code: 'ENOENT'
    })
  }))
test('upstream invalidation removes the saved key and cannot forward another import', async () =>
  fixture(async (f) => {
    await f.connect()
    f.expired = true
    await f.sync()
    assert.equal(f.imported, undefined)
    assert.deepEqual(await readdir(join(f.state, 'game-vault')), [])
    await assert.rejects(stat(join(f.state, 'official-raid-connection.json')), {
      code: 'ENOENT'
    })
  }))
