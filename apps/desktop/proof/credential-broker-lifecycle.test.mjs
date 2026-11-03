import { test, describe } from 'node:test'
import { strict as assert } from 'node:assert'
import { randomBytes, randomUUID } from 'node:crypto'
import { CredentialVault } from '../launcher/credential-vault.mjs'
import { OfficialRaidBroker } from '../launcher/official-raid-broker.mjs'
import { syntheticRosterUnit } from './synthetic-roster.mjs'

/**
 * Consent-Based Local Account Connection and Credential Broker Test Suite.
 * Verifies consent gating, opaque handles, canary non-leakage, and revocation.
 */

describe('Credential Broker and Local Account Connection Lifecycle', () => {
  const CANARY_SECRET = randomUUID()
  const MOCK_GUILD = 'SYN001'
  const MOCK_INSTALLATION = randomUUID()

  // Mock safe storage providing encryption primitives
  class MockSafeStorage {
    constructor(backend = 'gnome_libsecret', available = true) {
      this.backend = backend
      this.available = available
    }
    isEncryptionAvailable() {
      return this.available
    }
    getSelectedStorageBackend() {
      return this.backend
    }
    encryptString(plain) {
      if (!this.available || this.backend === 'basic_text') {
        throw new Error('Encryption unavailable')
      }
      return Buffer.from('ENC:' + plain, 'utf8')
    }
    decryptString(cipherBuffer) {
      const str = cipherBuffer.toString('utf8')
      if (!str.startsWith('ENC:')) throw new Error('Decryption failure')
      return str.slice(4)
    }
  }

  function createBrokerFixture({
    initialConsent = true,
    guildCode = MOCK_GUILD
  } = {}) {
    const records = new Map()
    const state = {
      grant: initialConsent
        ? {
            operation: 'official-guild-raids',
            installation: MOCK_INSTALLATION,
            guildCode
          }
        : null,
      expiry: 2_500_000_000,
      guildId: randomUUID(),
      guildTag: guildCode,
      now: 1_900_000_000_000,
      calls: [],
      records
    }

    const vault = {
      async save(val) {
        const h = randomBytes(16).toString('hex')
        records.set(h, val)
        return h
      },
      async withCredential(h, op) {
        assert.ok(records.has(h))
        return await op(records.get(h))
      },
      async forget(h) {
        records.delete(h)
      }
    }

    const transport = async (url, options) => {
      state.calls.push({ url, options })
      assert.equal(options.headers['X-API-KEY'], CANARY_SECRET)

      if (url.endsWith('/player')) {
        return Response.json({
          player: {
            details: { name: 'Commander Alpha', powerLevel: 1000 },
            units: [syntheticRosterUnit()]
          },
          metaData: {
            scopes: ['Player', 'Guild', 'Guild Raid'],
            apiKeyExpiresOn: state.expiry
          }
        })
      }
      if (url.endsWith('/guild')) {
        return Response.json({
          guild: { guildId: state.guildId, guildTag: state.guildTag }
        })
      }
      return Response.json({
        season: 9999,
        seasonConfigId: 'season-alpha',
        entries: []
      })
    }

    const broker = new OfficialRaidBroker({
      vault,
      consent: () => state.grant,
      fetch: transport,
      clock: () => state.now
    })

    return { state, broker, vault }
  }

  test('refuses access when consent is absent or withdrawn', async () => {
    let consentGranted = false
    const safeStorage = new MockSafeStorage('gnome_libsecret', true)
    const vault = new CredentialVault({
      safeStorage,
      directory: '/tmp/unused-vault',
      consent: () => consentGranted,
      platform: 'linux'
    })

    // Before consent, ensureReady throws EVAULT
    assert.throws(
      () => vault.ensureReady(),
      (err) => err.code === 'EVAULT'
    )

    // Grant consent -> now ready
    consentGranted = true
    assert.doesNotThrow(() => vault.ensureReady())

    // Revoke consent -> throws again
    consentGranted = false
    assert.throws(
      () => vault.ensureReady(),
      (err) => err.code === 'EVAULT'
    )
  })

  test('fails closed on insecure storage providers (basic_text fallback rejected)', async () => {
    // Basic text is insecure unencrypted fallback on Linux
    const insecureStorage = new MockSafeStorage('basic_text', true)
    const vault = new CredentialVault({
      safeStorage: insecureStorage,
      directory: '/tmp/insecure-vault',
      consent: () => true,
      platform: 'linux'
    })

    assert.throws(
      () => vault.ensureReady(),
      (err) => {
        assert.equal(err.code, 'EVAULT')
        assert.match(err.message, /Secure credential storage is unavailable/)
        return true
      }
    )
  })

  test('broker projects roster and raids without exposing raw canary secrets', async () => {
    const { broker, state } = createBrokerFixture()

    // Connect using canary secret
    await broker.connect(CANARY_SECRET)

    // Fetch projected roster
    const roster = await broker.currentRoster()
    assert.ok(roster)
    assert.equal(roster.guildCode, MOCK_GUILD)

    // Assert raw canary secret NEVER leaks into projected roster
    assert.equal(JSON.stringify(roster).includes(CANARY_SECRET), false)

    // Assert raw secret is NOT present in saved connection metadata
    const saved = broker.savedConnection()
    assert.ok(saved.handle)
    assert.equal(JSON.stringify(saved).includes(CANARY_SECRET), false)
  })

  test('disconnect immediately revokes broker access and deletes session handle', async () => {
    const { broker, state } = createBrokerFixture()

    await broker.connect(CANARY_SECRET)
    assert.ok(broker.savedConnection().handle)

    // Disconnect
    await broker.disconnect()

    // Saved connection should be cleared
    assert.equal(broker.savedConnection(), null)

    // Subsequent operation must fail immediately with revoked status
    await assert.rejects(
      async () => {
        await broker.currentRoster()
      },
      (err) => {
        assert.equal(err.code, 'EBROKER')
        return true
      }
    )
  })

  test('account switching across different guild codes immediately revokes session binding', async () => {
    const { broker, state } = createBrokerFixture({ guildCode: 'GUILD_ALPHA' })

    await broker.connect(CANARY_SECRET)
    const roster1 = await broker.currentRoster()
    assert.equal(roster1.guildCode, 'GUILD_ALPHA')

    // User switches to GUILD_BETA
    state.grant = {
      operation: 'official-guild-raids',
      installation: MOCK_INSTALLATION,
      guildCode: 'GUILD_BETA'
    }

    // Attempting to query with established binding after guild switch must reject and disconnect
    await assert.rejects(
      async () => {
        await broker.currentRoster()
      },
      (err) => {
        assert.equal(err.code, 'EBROKER')
        return true
      }
    )

    // Binding must be wiped
    assert.equal(broker.savedConnection(), null)
  })
})
