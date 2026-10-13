import { test, after } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialVault } from '../launcher/credential-vault.mjs'
import { OfficialRaidBroker } from '../launcher/official-raid-broker.mjs'
import { nativeSecretPrompt } from '../launcher/native-secret.mjs'
import { saveGameConnection } from '../launcher/saved-game-connection.mjs'
import { saveScopedConnections } from '../launcher/scoped-connections.mjs'
import { sealDirectory } from '../launcher/encrypted-backup.mjs'
import { validateBackup } from './workspace-transfer.mjs'
import { inventory } from './schema-lifecycle.mjs'
import { loopbackGateway } from './loopback-gateway.mjs'
import { workspaceGameConnection } from '../launcher/game-connection.mjs'
import { syntheticRosterUnit } from './synthetic-roster.mjs'

// A synthetic canary secret exercised end-to-end through the credential broker
// and connection paths. Every assertion proves this value never crosses a
// renderer-facing, on-disk or outbound boundary except the single intended
// upstream API-key header. All identifiers are synthetic: no ticket IDs,
// internal hosts, real players or guilds appear here.
const canary = randomUUID()
const encodedSecrets = (secret) => [
  secret,
  secret.toLowerCase(),
  secret.toUpperCase(),
  secret.replaceAll('-', ''),
  Buffer.from(secret).toString('base64'),
  Buffer.from(secret).toString('base64url'),
  Buffer.from(secret).toString('hex')
]

const roots = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

async function vaultFixture() {
  const root = await mkdtemp(join(tmpdir(), 'secret-egress-vault-'))
  roots.push(root)
  const key = randomBytes(32)
  const state = { consent: true, backend: 'gnome_libsecret', available: true }
  const storage = {
    isEncryptionAvailable() {
      return state.available
    },
    getSelectedStorageBackend() {
      return state.backend
    },
    encryptString(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final()
      ])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decryptString(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([
        cipher.update(value.subarray(28)),
        cipher.final()
      ]).toString('utf8')
    }
  }
  const directory = join(root, 'vault')
  const vault = new CredentialVault({
    safeStorage: storage,
    directory,
    consent: () => state.consent
  })
  return { root, directory, vault, state }
}

function brokerFixture() {
  const secret = canary,
    guildId = randomUUID()
  const state = {
    grant: {
      operation: 'official-guild-raids',
      installation: randomUUID(),
      guildCode: 'SYN001'
    },
    expiry: 2_000_000_000,
    now: 1_900_000_000_000,
    calls: [],
    records: new Map(),
    saves: 0,
    reads: 0,
    deleted: 0
  }
  const row = {
    userId: 'synthetic-player',
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
  const player = {
    details: { name: 'Synthetic Player', powerLevel: 1000 },
    units: [syntheticRosterUnit()]
  }
  const raid = { season: 9999, entries: [row] }
  const vault = {
    async save(value) {
      state.saves++
      const handle = randomBytes(16).toString('hex')
      state.records.set(handle, value)
      return handle
    },
    async withCredential(handle, operation) {
      state.reads++
      assert(state.records.has(handle))
      return operation(state.records.get(handle))
    },
    async forget(handle) {
      state.deleted++
      state.records.delete(handle)
    }
  }
  const transport = async (url, options) => {
    state.calls.push({ url, options })
    const body = url.endsWith('/player')
      ? {
          player,
          metaData: {
            scopes: ['Player', 'Guild', 'Guild Raid'],
            apiKeyExpiresOn: state.expiry
          }
        }
      : url.endsWith('/guild')
        ? { guild: { guildId, guildTag: 'SYN001' } }
        : raid
    return Response.json(body)
  }
  const broker = new OfficialRaidBroker({
    vault,
    consent: () => state.grant,
    fetch: transport,
    clock: () => state.now
  })
  return { state, broker, secret, row, guildId, player, raid }
}

function nativeSecretFixture() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  const calls = [],
    kills = []
  child.kill = (signal) => {
    kills.push(signal)
    queueMicrotask(() => child.emit('close', null))
    return true
  }
  const spawn = (...args) => {
    calls.push(args)
    return child
  }
  return { child, spawn, calls, kills }
}

async function sealFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'secret-egress-seal-'))
  roots.push(root)
  const source = join(root, 'checkpoint'),
    destination = join(root, 'export.tabackup'),
    schema = 'a'.repeat(64)
  await mkdir(source, { mode: 0o700 })
  await mkdir(join(source, 'pgdata'), { mode: 0o700 })
  await writeFile(join(source, 'pgdata', 'PG_VERSION'), '18\n', { mode: 0o600 })
  // The canary is planted as plaintext inside a canonical workspace input so
  // that sealing it must hide the value on the exported file.
  await writeFile(
    join(source, 'credentials.json'),
    JSON.stringify({ marker: canary }),
    { mode: 0o600 }
  )
  await writeFile(join(source, 'schema-version'), schema, { mode: 0o600 })
  const files = await inventory(source)
  await writeFile(
    join(source, 'checkpoint.json'),
    JSON.stringify({
      format: 'desktop-stopped-checkpoint-v1',
      source: schema,
      files
    }),
    { mode: 0o600 }
  )
  await validateBackup(source)
  return run({ root, source, destination })
}

function stringify(arg) {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

async function withCapturedConsole(run) {
  const lines = []
  const original = {}
  for (const method of ['log', 'error', 'warn', 'info', 'debug']) {
    original[method] = console[method]
    console[method] = (...args) => lines.push(args.map(stringify).join(' '))
  }
  try {
    await run()
  } finally {
    Object.assign(console, original)
  }
  return lines.join('\n')
}

async function assertQuiet(run) {
  const output = await withCapturedConsole(run)
  for (const variant of encodedSecrets(canary))
    assert(!output.includes(variant), `canary leaked to console: ${output}`)
}

function assertOutboundClean(calls, secret) {
  assert.ok(calls.length > 0, 'recording fetch captured no outbound requests')
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET')
    assert.equal(options.body, undefined)
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    assert(
      url.startsWith('https://api.tacticusgame.com/api/v1/'),
      `unexpected outbound destination: ${url}`
    )
    for (const variant of encodedSecrets(secret))
      assert(!url.includes(variant), `secret leaked into outbound URL: ${url}`)
    // The single intended credential header is the only place the key may leave.
    assert.equal(options.headers['X-API-KEY'], secret)
    for (const [name, value] of Object.entries(options.headers)) {
      if (name.toLowerCase() === 'x-api-key') continue
      for (const variant of encodedSecrets(secret))
        assert(
          !String(value).includes(variant),
          `secret leaked into outbound ${name} header`
        )
    }
  }
}

test('console and logger output never exposes the canary secret', async () => {
  const vaultF = await vaultFixture(),
    brokerF = brokerFixture()
  let matched, status, raids, roster, saved
  const output = await withCapturedConsole(async () => {
    const handle = await vaultF.vault.save(canary)
    matched = await vaultF.vault.withCredential(
      handle,
      (secret) => secret === canary
    )
    status = await brokerF.broker.connect(canary)
    raids = await brokerF.broker.currentRaids()
    roster = await brokerF.broker.currentRoster()
    saved = brokerF.broker.savedConnection()
    await brokerF.broker.disconnect()
  })
  assert.equal(matched, true)
  assert.equal(status.connected, true)
  assert.ok(raids.contents)
  assert.ok(Array.isArray(roster.units))
  assert.match(saved.handle, /^[a-f0-9]{32}$/)
  for (const variant of encodedSecrets(canary))
    assert(
      !output.includes(variant),
      `canary leaked to console/logger: ${output}`
    )
})

test('spawned native prompts never place the canary in process argv or environment', async () => {
  const f = nativeSecretFixture(),
    pending = nativeSecretPrompt('official-key', { spawn: f.spawn })
  assert.equal(f.calls[0][0], '/usr/bin/zenity')
  assert.equal(f.calls[0][1][0], '--entry')
  assert.deepEqual(f.calls[0][2], { stdio: ['ignore', 'pipe', 'ignore'] })
  f.child.stdout.write(canary + '\n')
  f.child.emit('close', 0)
  await assertQuiet(async () => {
    assert.equal(await pending, canary)
  })
  for (const variant of encodedSecrets(canary))
    assert(
      !JSON.stringify(f.calls).includes(variant),
      'canary leaked into spawned process argv'
    )
})

test('broker responses returned toward the renderer-facing gateway never contain the canary', async (t) => {
  const f = brokerFixture()
  await f.broker.connect(f.secret)
  const status = f.broker.status(),
    saved = f.broker.savedConnection(),
    raids = await f.broker.currentRaids(),
    roster = await f.broker.currentRoster()
  for (const value of [status, saved, raids, roster])
    for (const variant of encodedSecrets(f.secret))
      assert(
        !JSON.stringify(value).includes(variant),
        'canary leaked into a broker response'
      )

  // Round-trip the renderer-facing values through the loopback gateway to prove
  // the transport adds nothing and the response body stays canary-free.
  const transportKey = randomBytes(32).toString('hex'),
    brokerToken = randomBytes(32).toString('hex')
  const owner = {
    installation: f.state.grant.installation,
    guildCode: f.state.grant.guildCode,
    mode: 'local-file'
  }
  const handleLocalRequest = workspaceGameConnection(
    { psql: async () => JSON.stringify(owner) },
    { brokerToken, clock: () => f.state.now }
  )
  const gateway = await loopbackGateway({
    services: { ports: {}, token: { anon: 'anon-token' } },
    transportKey,
    appPort: 1,
    handleLocalRequest
  })
  t.after(() => gateway.stop())
  // The main process reports the broker status to the production game
  // connection route; the renderer then reads it back through the gateway.
  const reported = await fetch(gateway.origin + '/desktop/broker-status', {
    method: 'POST',
    headers: {
      'x-desktop-transport': transportKey,
      'x-desktop-broker': brokerToken
    },
    body: JSON.stringify({
      connected: true,
      installation: owner.installation,
      guildCode: owner.guildCode,
      expiresAt: status.expiresAt ?? null
    })
  })
  const reportedBody = await reported.text()
  assert.equal(reported.status, 200, reportedBody)
  const response = await fetch(gateway.origin + '/desktop/connection-status', {
    headers: { 'x-desktop-transport': transportKey }
  })
  assert.equal(response.status, 200)
  const body = await response.text()
  assert.equal(JSON.parse(body).connected, true)
  for (const text of [reportedBody, body])
    for (const variant of encodedSecrets(f.secret))
      assert(
        !text.includes(variant),
        'canary leaked through the loopback gateway'
      )
})

test('persisted records and encrypted exports never contain the canary', async () => {
  await assertQuiet(async () => {
    // The OS-vault record holds only ciphertext.
    const vaultF = await vaultFixture(),
      handle = await vaultF.vault.save(canary)
    const vaultRecord = await readFile(
      join(vaultF.directory, `${handle}.secret`)
    )
    for (const variant of encodedSecrets(canary))
      assert.equal(vaultRecord.includes(Buffer.from(variant)), false)

    // The saved game connection persists opaque metadata, never the key.
    const brokerF = brokerFixture()
    await brokerF.broker.connect(canary)
    const connectionState = await mkdtemp(
      join(tmpdir(), 'secret-egress-connection-')
    )
    roots.push(connectionState)
    await saveGameConnection(connectionState, brokerF.broker.savedConnection())
    const connectionRecord = await readFile(
      join(connectionState, 'official-raid-connection.json'),
      'utf8'
    )
    for (const variant of encodedSecrets(canary))
      assert.equal(connectionRecord.includes(variant), false)

    // Scoped access records persist handles, never the key.
    const scopeHandle = await vaultF.vault.save(canary)
    const scopeState = await mkdtemp(join(tmpdir(), 'secret-egress-scope-'))
    roots.push(scopeState)
    await saveScopedConnections(scopeState, {
      format: 'ta-scoped-official-access-v1',
      installation: randomUUID(),
      guildCode: 'SYN001',
      roles: {
        Player: {
          handle: scopeHandle,
          verifiedAt: Date.now(),
          expiresAt: null
        }
      }
    })
    const scopeRecord = await readFile(
      join(scopeState, 'scoped-official-access.json'),
      'utf8'
    )
    for (const variant of encodedSecrets(canary))
      assert.equal(scopeRecord.includes(variant), false)

    // The encrypted workspace export never carries the plaintext canary.
    await sealFixture(async ({ source, destination }) => {
      await sealDirectory(
        source,
        destination,
        Buffer.from('synthetic secret egress passphrase')
      )
      const sealed = await readFile(destination)
      assert.equal(sealed.subarray(0, 8).toString(), 'TABKENC2')
      for (const variant of encodedSecrets(canary))
        assert.equal(sealed.includes(Buffer.from(variant)), false)
    })
  })
})

test('outbound requests never carry the canary except the single fixed API-key header', async () => {
  const f = brokerFixture()
  await f.broker.connect(f.secret)
  await f.broker.currentRaids()
  await f.broker.currentRoster()
  // connect: player + guild; currentRaids: player + guild + guildRaid;
  // currentRoster: player + guild.
  assert.equal(f.state.calls.length, 7)
  assertOutboundClean(f.state.calls, f.secret)
})
