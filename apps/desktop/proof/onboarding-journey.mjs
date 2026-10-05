import assert from 'node:assert/strict'
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { syntheticRosterUnit } from './synthetic-roster.mjs'
import { loadScopedConnections } from '../launcher/scoped-connections.mjs'
import { setTimeout as delay } from 'node:timers/promises'
import { nativeServices } from './native-services.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceSetup } from '../launcher/workspace.mjs'

const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
assert(config.application, 'Compiled application required')
const state = join(
  config.stateRoot || config.state,
  'scoped-onboarding-probe-' + randomUUID()
)
const password = randomBytes(24).toString('hex')
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
let services, gateway, key, cron, broker
let starts = 0
const factory = createRequire(import.meta.url)(
  '../launcher/onboarding-menu.cjs'
)
async function start() {
  services = await nativeServices({
    ...config,
    state,
    schemaDirectory:
      starts++ === 0 && config.sourceSchemaDirectory
        ? config.sourceSchemaDirectory
        : config.schemaDirectory
  })
  key = randomBytes(32).toString('hex')
  cron = randomBytes(32).toString('hex')
  broker = randomBytes(32).toString('hex')
  const listener = createServer()
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  gateway = await loopbackGateway({
    services,
    transportKey: key,
    handleLocalRequest: workspaceSetup(
      services,
      new URL('../launcher', import.meta.url).pathname,
      {
        brokerToken: broker,
        normalizeRoster: async (contents, subject) => {
          const response = await fetch(
            `http://127.0.0.1:${port}/api/desktop/normalize-roster`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${cron}`,
                'x-desktop-transport': key
              },
              body: JSON.stringify({ contents, subject }),
              signal: AbortSignal.timeout(20000)
            }
          )
          assert.equal(response.status, 200)
          return response.json()
        }
      }
    )
  })
  gateway.setAppPort(port)
  services.launch(
    config.application.node,
    [join(config.application.directory, 'server.js')],
    {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_RUNTIME_PROFILE: 'desktop',
      NEXT_PUBLIC_SITE_URL: gateway.origin,
      SITE_URL: gateway.origin,
      NEXT_PUBLIC_SUPABASE_URL: gateway.origin + '/supabase',
      SUPABASE_URL: gateway.origin + '/supabase',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'desktop-public',
      SUPABASE_SERVICE_ROLE_KEY: services.serviceCredential,
      DESKTOP_TRANSPORT_KEY: key,
      CRON_SECRET: cron
    },
    config.application.directory
  )
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    assert(!services.fault, 'Native application stays alive')
    try {
      if ((await request('/api/health')).ok) return
    } catch {}
    await delay(100)
  }
  throw new Error('Native application readiness timeout')
}
const request = (path, body, extra = {}) =>
  fetch(gateway.origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-desktop-transport': key,
      origin: gateway.origin,
      'content-type': 'application/json',
      ...extra
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  })
async function login() {
  const response = await request(
    '/supabase/auth/v1/token?grant_type=password',
    { email: 'desktop@localhost.invalid', password }
  )
  assert.equal(response.status, 200)
  return response.json()
}
async function stop() {
  await gateway?.stop()
  gateway = undefined
  await services?.stop()
  services = undefined
}

const officialKey = randomUUID(),
  guildId = randomUUID(),
  cipher = randomBytes(32)
const checks = [],
  calls = []
const app = new EventEmitter(),
  webContents = new EventEmitter()
let currentToken,
  loads = 0,
  errors = 0
webContents.session = {
  cookies: {
    async get() {
      return [
        {
          name: 'tacticus-auth-token',
          value:
            'base64-' +
            Buffer.from(
              JSON.stringify({ access_token: currentToken })
            ).toString('base64url')
        }
      ]
    }
  }
}
webContents.getURL = () => gateway.origin + '/desktop/connect'
const window = {
  webContents,
  async loadURL() {
    loads++
  }
}
const safeStorage = {
  isEncryptionAvailable() {
    return true
  },
  getSelectedStorageBackend() {
    return 'gnome_libsecret'
  },
  encryptString(value) {
    const iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', cipher, iv),
      body = Buffer.concat([c.update(value), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), body])
  },
  decryptString(value) {
    const d = createDecipheriv('aes-256-gcm', cipher, value.subarray(0, 12))
    d.setAuthTag(value.subarray(12, 28))
    return Buffer.concat([d.update(value.subarray(28)), d.final()]).toString()
  }
}
const fixtureResponse = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  })
const official = async (url, options) => {
  if (!url.startsWith('https://api.tacticusgame.com/'))
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'x-desktop-broker': broker,
        'x-desktop-transport': key
      }
    })
  calls.push(url)
  assert.equal(options.headers['X-API-KEY'], officialKey)
  if (url.endsWith('/player'))
    return fixtureResponse({
      player: {
        details: { name: 'Synthetic Player', powerLevel: 12345 },
        units: [
          {
            ...syntheticRosterUnit(),
            progressionIndex: 19,
            rank: 23,
            xpLevel: 55,
            abilities: [
              ...syntheticRosterUnit().abilities,
              { id: 'syntheticThird', level: 55 }
            ]
          }
        ],
        progress: {
          guildRaid: {
            tokens: { current: 2, max: 3, regenDelayInSeconds: 43200 },
            bombTokens: { current: 1, max: 3, regenDelayInSeconds: 86400 }
          }
        }
      },
      metaData: { scopes: ['Player'], lastUpdatedOn: 1800000000 }
    })
  if (url.endsWith('/guild'))
    return fixtureResponse({ guild: { guildId, guildTag: 'SYN01' } })
  if (url.endsWith('/guildRaid'))
    return fixtureResponse({ season: 44, entries: [] })
  throw new Error('Unexpected upstream path')
}
async function action(path) {
  await delay(3100)
  const before = loads
  webContents.emit(
    'will-navigate',
    { preventDefault() {} },
    gateway.origin + path
  )
  const deadline = Date.now() + 35000
  while (loads === before && !errors && Date.now() < deadline) await delay(25)
  assert.equal(errors, 0, 'Native operation succeeds')
  assert.equal(loads, before + 1)
}
const status = async () => {
  const response = await request('/desktop/onboarding-status')
  assert.equal(response.status, 200)
  return response.json()
}
try {
  await start()
  assert.equal(
    (
      await request('/desktop/setup', {
        password,
        sample: false,
        identity: {
          guildCode: 'SYN01',
          playerId: 'synthetic-onboarding-player',
          displayName: 'Synthetic Player',
          guildName: 'Synthetic Guild'
        }
      })
    ).status,
    201
  )
  if (config.sourceSchemaDirectory) {
    const before = await services.psql(
      'SELECT md5((SELECT json_agg(t)::text FROM public.desktop_preview_setup t));'
    )
    await stop()
    await start()
    assert.equal(
      await services.psql(
        'SELECT md5((SELECT json_agg(t)::text FROM public.desktop_preview_setup t));'
      ),
      before
    )
    checks.push(
      'existing native workspace upgrades to the Mythic roster schema without changing setup records'
    )
  }
  await services.psql(
    "INSERT INTO public.hero_mappings(id,unit_id,display_name) VALUES(1000001,'syntheticHero','Synthetic Reference Hero');"
  )
  const session = await login()
  currentToken = session.access_token
  const subject = session.user.id
  const initial = await status()
  assert.equal(initial.playerReady, false)
  assert.equal(initial.guildReady, false)
  const setupPage = await (await request('/desktop/connect')).text()
  assert(setupPage.includes('Player · required'))
  assert(setupPage.includes('Guild Raid · optional'))
  await factory(
    window,
    {
      url: gateway.origin + '/desktop/setup',
      state,
      transportKey: key,
      brokerToken: broker
    },
    {
      electron: {
        app,
        safeStorage,
        dialog: {
          async showMessageBox(_window, value) {
            if (value.type === 'error') errors++
            return { response: 1 }
          }
        }
      },
      nativeSecretPrompt: async (kind) => {
        assert.notEqual(kind, 'workspace-password')
        return officialKey
      },
      fetch: official
    }
  )
  assert.equal(
    (await request('/desktop/import-player', { password, contents: '{}' }))
      .status,
    403
  )
  assert.equal(
    (
      await request(
        '/desktop/broker-context',
        {},
        {
          'x-desktop-broker': broker,
          authorization: 'Bearer invalid.invalid.invalid'
        }
      )
    ).status,
    401,
    'Auth rejects an invalid session before credential access'
  )
  await action('/desktop/connect-player')
  const personal = await status()
  assert.equal(
    (
      await services.psql('SELECT progression_index FROM public.player_roster;')
    ).trim(),
    '19'
  )
  assert.equal(
    (await services.psql('SELECT xp_level FROM public.player_roster;')).trim(),
    '55'
  )
  assert.equal(personal.playerReady, true)
  assert.equal(personal.guildReady, false)
  assert.equal(personal.tokens, 2)
  assert.equal(personal.bombs, 1)
  assert.equal(new Date(personal.updatedAt).getTime(), 1800000000000)
  assert.deepEqual(calls, ['https://api.tacticusgame.com/api/v1/player'])
  const cached = (
    await services.psql(
      `SELECT jsonb_build_object('roster',(SELECT payload FROM public.desktop_roster_snapshots WHERE subject_user_id=player_mapping.user_id),'tokens',last_sync_tokens,'bombs',last_sync_bombs) FROM public.player_mapping WHERE user_id=${quote(subject)} AND is_current;`
    )
  ).trim()
  assert(!cached.includes(officialKey))
  assert(!JSON.stringify(personal).includes(officialKey))
  checks.push(
    'fresh native workspace holds personal and guild content until verified Player import; Player-only validation imports the roster and counters without guild requests'
  )
  await action('/desktop/connect-guild')
  assert.equal((await status()).guildReady, false)
  await action('/desktop/connect-guild-raid')
  assert.equal((await status()).guildReady, true)
  assert.deepEqual(
    Object.keys((await loadScopedConnections(state)).roles).sort(),
    ['Guild', 'Guild Raid', 'Player']
  )
  checks.push(
    'Guild alone stays in holding state; independently matched Guild and Guild Raid scopes activate guild content'
  )
  await stop()
  await start()
  currentToken = (await login()).access_token
  const restarted = await status()
  assert.equal(restarted.playerReady, true)
  assert.equal(restarted.guildReady, true)
  assert.equal(restarted.tokens, 2)
  assert.equal(restarted.bombs, 1)
  assert.equal(
    (
      await services.psql(
        `SELECT jsonb_build_object('roster',(SELECT payload FROM public.desktop_roster_snapshots WHERE subject_user_id=player_mapping.user_id),'tokens',last_sync_tokens,'bombs',last_sync_bombs) FROM public.player_mapping WHERE user_id=${quote(subject)} AND is_current;`
      )
    ).trim(),
    cached
  )
  const requestCount = calls.length
  await status()
  assert.equal(calls.length, requestCount)
  checks.push(
    'native services restart preserves roster, counters and scope bindings; cached access status makes no upstream request'
  )
  const evidence = {
    status: 'passed',
    checks,
    scope:
      'Real PostgreSQL/Auth/PostgREST and compiled roster normalization with the actual native onboarding controller. Upstream and native dialog/OS encryption use synthetic controlled adapters; this is not a live-key or native input-dialog acceptance claim.'
  }
  await writeFile(
    config.evidence.replace(/\.json$/, '-scoped-onboarding.json'),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  await stop()
}
