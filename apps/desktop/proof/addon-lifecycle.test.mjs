import { test, describe, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  AddonHostManager,
  AddonVerificationError
} from '../launcher/addon-lifecycle.mjs'

describe('Signed Add-on Host and Module Lifecycle Suite', () => {
  let tempDir
  let db
  let keyPair
  let hostManager

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'addon-host-test-'))
    const dbPath = path.join(tempDir, 'addons_test.db')
    db = new DatabaseSync(dbPath)

    // Set up core tables to verify isolation
    db.exec(`
      CREATE TABLE guild_config (id INTEGER PRIMARY KEY, guild_code TEXT);
      INSERT INTO guild_config (id, guild_code) VALUES (1, 'GUILD_CORE_IMMUTABLE');
      CREATE TABLE work_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT, status TEXT, error TEXT, updated_at TEXT);
    `)

    // Generate real Ed25519 signing keypair for tests
    keyPair = generateKeyPairSync('ed25519')

    const trustedKeys = new Map([
      ['publisher-official-key-1', keyPair.publicKey]
    ])

    hostManager = new AddonHostManager({
      rootDir: tempDir,
      db,
      trustedPublicKeys: trustedKeys,
      currentPlatform: 'linux',
      currentArch: 'x64'
    })
    hostManager.initRegistry()
  })

  afterEach(async () => {
    if (db) db.close()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  function createSignedBundle({
    addonId = 'guild-war',
    version = '1.0.0',
    keyId = 'publisher-official-key-1',
    privateKey = keyPair.privateKey,
    platforms = ['linux', 'windows', 'macos'],
    architectures = ['x64', 'arm64'],
    fileContent = 'console.log("Guild War Module Ready");'
  } = {}) {
    const fileSha256 = createHash('sha256').update(fileContent).digest('hex')

    const manifest = {
      schemaVersion: 1,
      addonId,
      version,
      publisher: 'tacticus-analytics',
      compatibility: {
        platforms,
        architectures,
        hostApiVersion: 1
      },
      capabilities: ['offline.import', 'offline.read'],
      files: [{ path: 'index.js', sha256: fileSha256 }]
    }

    const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8')
    const signature = sign(null, manifestBuffer, privateKey).toString('hex')

    return {
      manifest,
      signature,
      keyId,
      files: [{ path: 'index.js', content: fileContent }]
    }
  }

  test('empty-trust baseline: unverified publisher key is rejected before file extraction', async () => {
    // Generate an untrusted rogue keypair
    const rogueKeys = generateKeyPairSync('ed25519')
    const rogueBundle = createSignedBundle({
      keyId: 'untrusted-rogue-publisher',
      privateKey: rogueKeys.privateKey
    })

    assert.throws(
      () => hostManager.verifyBundle(rogueBundle),
      (err) => {
        assert.ok(err instanceof AddonVerificationError)
        assert.equal(err.code, 'EUNTRUSTED_KEY')
        return true
      }
    )
  })

  test('cryptographic verification detects tampered manifest content', async () => {
    const bundle = createSignedBundle()

    // Tamper with manifest version after signing
    bundle.manifest.version = '2.0.0-hacked'

    assert.throws(
      () => hostManager.verifyBundle(bundle),
      (err) => {
        assert.ok(err instanceof AddonVerificationError)
        assert.equal(err.code, 'ESIGNATURE_MISMATCH')
        return true
      }
    )
  })

  test('rejects wrong-platform and wrong-architecture module bundles', async () => {
    // Current test host platform is linux / x64
    const macOnlyBundle = createSignedBundle({
      platforms: ['macos'],
      architectures: ['arm64']
    })

    assert.throws(
      () => hostManager.verifyBundle(macOnlyBundle),
      (err) => {
        assert.ok(err instanceof AddonVerificationError)
        assert.equal(err.code, 'EPLATFORM_INCOMPATIBLE')
        return true
      }
    )
  })

  test('installs verified module and enforces separate permission consent', async () => {
    const bundle = createSignedBundle({ addonId: 'guild-war' })

    const installResult = await hostManager.install(bundle)
    assert.equal(installResult.success, true)
    assert.equal(installResult.addonId, 'guild-war')

    // 1. Verify files exist on disk in sandboxed directory
    const installedFile = path.join(tempDir, 'addons', 'guild-war', 'index.js')
    const content = await fs.readFile(installedFile, 'utf8')
    assert.ok(content.includes('Guild War Module Ready'))

    // 2. Verify installation did NOT automatically grant capabilities
    assert.equal(
      hostManager.hasConsent('guild-war', 'broker.guild-war.read'),
      false
    )
    assert.equal(hostManager.hasConsent('guild-war', 'offline.read'), false)

    // 3. Explicit user consent grant
    hostManager.grantConsent('guild-war', 'offline.read')
    assert.equal(hostManager.hasConsent('guild-war', 'offline.read'), true)
    assert.equal(
      hostManager.hasConsent('guild-war', 'broker.guild-war.read'),
      false
    )
  })

  test('disabling add-on stops and cancels pending module background jobs', async () => {
    const bundle = createSignedBundle({ addonId: 'replays' })
    await hostManager.install(bundle)

    // Enqueue jobs: one belonging to replays, one belonging to core system
    db.prepare(
      "INSERT INTO work_queue (job_type, status) VALUES ('addon:replays:capture', 'pending')"
    ).run()
    db.prepare(
      "INSERT INTO work_queue (job_type, status) VALUES ('core:roster:refresh', 'pending')"
    ).run()

    // Disable replays module
    hostManager.disable('replays')

    // Replay job must be cancelled ('dead')
    const replayJob = db
      .prepare(
        "SELECT status, error FROM work_queue WHERE job_type = 'addon:replays:capture'"
      )
      .get()
    assert.equal(replayJob.status, 'dead')
    assert.match(replayJob.error, /disabled by user/)

    // Core system job must remain unaffected ('pending')
    const coreJob = db
      .prepare(
        "SELECT status FROM work_queue WHERE job_type = 'core:roster:refresh'"
      )
      .get()
    assert.equal(coreJob.status, 'pending')
  })

  test('uninstall purges module data while strictly preserving core application data', async () => {
    const bundle = createSignedBundle({ addonId: 'guild-war' })
    await hostManager.install(bundle)

    // Create module-specific data table
    db.exec(`
      CREATE TABLE addon_guild_war_data (battle_id TEXT, score INT);
      INSERT INTO addon_guild_war_data VALUES ('b1', 999);
    `)

    // Uninstall with purgeData = true
    const uninstallResult = await hostManager.uninstall('guild-war', {
      purgeData: true
    })
    assert.equal(uninstallResult.uninstalled, true)
    assert.equal(uninstallResult.dataPurged, true)

    // Module directory must be removed
    const exists = await fs
      .stat(path.join(tempDir, 'addons', 'guild-war'))
      .then(() => true)
      .catch(() => false)
    assert.equal(exists, false)

    // Module table should be dropped
    const moduleTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'addon_guild_war_data'"
      )
      .get()
    assert.equal(moduleTable, undefined)

    // Core table MUST remain completely intact
    const coreGuild = db
      .prepare('SELECT guild_code FROM guild_config WHERE id = 1')
      .get()
    assert.equal(coreGuild.guild_code, 'GUILD_CORE_IMMUTABLE')
  })
})
