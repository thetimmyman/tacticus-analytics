import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv
} from 'node:crypto'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { syntheticRosterUnit } from './synthetic-roster.mjs'
import { loadScopedConnections } from '../launcher/scoped-connections.mjs'
const factory = createRequire(import.meta.url)(
  '../launcher/onboarding-menu.cjs'
)
async function fixture(run) {
  const state = await mkdtemp(join(tmpdir(), 'native-onboard-')),
    key = randomUUID(),
    password = randomBytes(16).toString('hex'),
    installation = randomUUID(),
    cipher = randomBytes(32)
  const calls = [],
    prompts = [],
    messages = [],
    webContents = new EventEmitter(),
    app = new EventEmitter()
  let loads = 0,
    queries = 0,
    choice = 1
  webContents.getURL = () => 'http://127.0.0.1:54321/desktop/connect'
  const window = {
    webContents,
    async loadURL() {
      loads++
    }
  }
  const safeStorage = {
    isEncryptionAvailable() {
      queries++
      return true
    },
    getSelectedStorageBackend() {
      return 'gnome_libsecret'
    },
    encryptString(value) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', cipher, iv)
      const body = Buffer.concat([c.update(value), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), body])
    },
    decryptString(value) {
      const d = createDecipheriv('aes-256-gcm', cipher, value.subarray(0, 12))
      d.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([d.update(value.subarray(28)), d.final()]).toString()
    }
  }
  const config = {
    url: 'http://127.0.0.1:54321/desktop/setup',
    state,
    transportKey: randomBytes(32).toString('hex'),
    brokerToken: randomBytes(32).toString('hex')
  }
  const response = (value) =>
    new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json' }
    })
  const fetch = async (url, options) => {
    calls.push(url)
    if (url.endsWith('/broker-context'))
      return response({ installation, guildCode: 'SYN01' })
    if (url === 'https://api.tacticusgame.com/api/v1/player')
      return response({
        player: {
          details: { name: 'Synthetic Player', powerLevel: 12345 },
          units: [syntheticRosterUnit()],
          progress: {
            guildRaid: {
              bombTokens: { current: 2, max: 3, regenDelayInSeconds: 43200 }
            }
          }
        },
        metaData: { scopes: ['Player'], lastUpdatedOn: 1800000000 }
      })
    if (url.endsWith('/import-player')) {
      const body = JSON.parse(options.body)
      assert.equal(body.password, password)
      assert.equal(body.resources.bombs.current, 2)
      assert(!options.body.includes(key))
      return response({ units: 1, mapped: 1, unmapped: 0 })
    }
    throw new Error('Unexpected request')
  }
  try {
    await factory(window, config, {
      electron: {
        app,
        safeStorage,
        dialog: {
          async showMessageBox(_window, value) {
            messages.push(value)
            return { response: choice }
          }
        }
      },
      nativeSecretPrompt: async (kind) => {
        prompts.push(kind)
        return kind === 'workspace-password' ? password : key
      },
      fetch
    })
    await run({
      calls,
      prompts,
      messages,
      state,
      webContents,
      get loads() {
        return loads
      },
      get queries() {
        return queries
      },
      set choice(value) {
        choice = value
      }
    })
  } finally {
    await rm(state, { recursive: true, force: true })
  }
}
test('actual native Player setup uses secure prompts, fetches only Player and saves an opaque vault handle', async () =>
  fixture(async (f) => {
    let prevented = false
    f.webContents.emit(
      'will-navigate',
      {
        preventDefault() {
          prevented = true
        }
      },
      'http://127.0.0.1:54321/desktop/connect-player'
    )
    for (let i = 0; i < 200 && f.loads === 0; i++) await delay(5)
    assert.equal(prevented, true)
    assert.equal(f.loads, 1)
    assert.deepEqual(f.prompts, ['workspace-password', 'player-api-key'])
    assert.deepEqual(f.calls, [
      'http://127.0.0.1:54321/desktop/broker-context',
      'https://api.tacticusgame.com/api/v1/player',
      'http://127.0.0.1:54321/desktop/import-player'
    ])
    const saved = await loadScopedConnections(f.state)
    assert.deepEqual(Object.keys(saved.roles), ['Player'])
    assert.match(saved.roles.Player.handle, /^[a-f0-9]{32}$/)
  }))
test('refusing native connection consent causes no credential prompt, vault access or network request', async () =>
  fixture(async (f) => {
    f.choice = 0
    f.webContents.emit(
      'will-navigate',
      { preventDefault() {} },
      'http://127.0.0.1:54321/desktop/connect-player'
    )
    await delay(20)
    assert.deepEqual(f.prompts, [])
    assert.deepEqual(f.calls, [])
    assert.equal(f.queries, 0)
    assert.equal(await loadScopedConnections(f.state), null)
  }))
test('foreign and parameterized navigation cannot initiate a key operation', async () =>
  fixture(async (f) => {
    for (const address of [
      'https://foreign.invalid/desktop/connect-player',
      'http://127.0.0.1:54321/desktop/connect-player?scope=arbitrary',
      'http://127.0.0.1:54321/desktop/connect-player#changed'
    ])
      f.webContents.emit('will-navigate', { preventDefault() {} }, address)
    await delay(20)
    assert.deepEqual(f.prompts, [])
    assert.deepEqual(f.calls, [])
  }))

test('removing saved API keys authenticates the workspace, revokes the vault handle and keeps cached data untouched', async () =>
  fixture(async (f) => {
    f.webContents.emit(
      'will-navigate',
      { preventDefault() {} },
      'http://127.0.0.1:54321/desktop/connect-player'
    )
    for (let i = 0; i < 200 && f.loads === 0; i++) await delay(5)
    assert.equal(f.loads, 1)
    const before = await loadScopedConnections(f.state)
    assert(before.roles.Player)
    const imports = f.calls.filter((url) =>
      url.endsWith('/import-player')
    ).length
    f.webContents.emit(
      'will-navigate',
      { preventDefault() {} },
      'http://127.0.0.1:54321/desktop/disconnect-api-access'
    )
    for (let i = 0; i < 200 && f.loads === 1; i++) await delay(5)
    assert.equal(f.loads, 2)
    assert.deepEqual((await loadScopedConnections(f.state)).roles, {})
    assert(
      !(await readdir(join(f.state, 'game-vault'))).some((name) =>
        name.endsWith('.secret')
      )
    )
    assert.equal(
      f.calls.filter((url) => url.endsWith('/import-player')).length,
      imports
    )
    assert.deepEqual(f.prompts, [
      'workspace-password',
      'player-api-key',
      'workspace-password'
    ])
  }))
