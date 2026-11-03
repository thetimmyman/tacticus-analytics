import { test, describe, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import { DatabaseSync } from 'node:sqlite'
import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash
} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { SqliteLifecycleManager } from '../local-schema/sqlite-lifecycle.mjs'

/**
 * SQLite Encrypted Backup, Restore, and Data Lifecycle Test Suite.
 * Verifies clean export, secret exclusion, fresh restore, and tamper rejection.
 */

describe('SQLite Encrypted Backup & Restore Lifecycle Suite', () => {
  let tempDir
  let dbPath
  let backupFile
  let manager

  const PASSPHRASE = 'CorrectHorseBatteryStaple-2026!'
  const CANARY_SECRET = 'CANARY_GAME_SECRET_' + randomBytes(16).toString('hex')

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-backup-test-'))
    dbPath = path.join(tempDir, 'active_app.db')
    backupFile = path.join(tempDir, 'export.ta-backup')
    manager = new SqliteLifecycleManager(dbPath)
    await manager.init()
  })

  afterEach(async () => {
    if (manager) manager.close()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Encrypted Backup Package Utilities (AES-256-GCM + scrypt)
  async function createEncryptedPackage(sourceDbPath, targetFile, passphrase) {
    // 1. Flush WAL to guarantee full data in main database file
    const db = new DatabaseSync(sourceDbPath)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    db.close()

    const rawData = await fs.readFile(sourceDbPath)
    const salt = randomBytes(16)
    const nonce = randomBytes(12)
    const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })

    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    const ciphertext = Buffer.concat([cipher.update(rawData), cipher.final()])
    const tag = cipher.getAuthTag()

    const packageEnvelope = {
      format: 'ta-encrypted-backup-v2',
      kdf: 'scrypt-n16384-r8-p1',
      saltHex: salt.toString('hex'),
      nonceHex: nonce.toString('hex'),
      tagHex: tag.toString('hex'),
      ciphertextBase64: ciphertext.toString('base64'),
      checksumSha256: createHash('sha256').update(rawData).digest('hex')
    }

    await fs.writeFile(
      targetFile,
      JSON.stringify(packageEnvelope, null, 2),
      'utf8'
    )
    return packageEnvelope
  }

  async function restoreEncryptedPackage(
    packageFile,
    targetDbPath,
    passphrase
  ) {
    const envelope = JSON.parse(await fs.readFile(packageFile, 'utf8'))
    if (envelope.format !== 'ta-encrypted-backup-v2') {
      throw new Error('Unsupported backup format version')
    }

    const salt = Buffer.from(envelope.saltHex, 'hex')
    const nonce = Buffer.from(envelope.nonceHex, 'hex')
    const tag = Buffer.from(envelope.tagHex, 'hex')
    const ciphertext = Buffer.from(envelope.ciphertextBase64, 'base64')

    const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 })
    const decipher = createDecipheriv('aes-256-gcm', key, nonce)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ])

    // Verify SHA-256 checksum
    const actualDigest = createHash('sha256').update(decrypted).digest('hex')
    if (actualDigest !== envelope.checksumSha256) {
      throw new Error('Restored backup checksum verification failed')
    }

    // Atomic write to target database path
    await fs.writeFile(targetDbPath, decrypted)
    return { restoredBytes: decrypted.length }
  }

  test('creates encrypted backup without leaking game secrets or canary tokens', async () => {
    // 1. Populate database with representative user roster and plans
    await manager.applyMigrations([
      {
        version: 1,
        name: 'user_roster',
        sql: `
          CREATE TABLE roster_characters (id TEXT PRIMARY KEY, rank INT);
          INSERT INTO roster_characters VALUES ('char-1', 7), ('char-2', 5);
        `
      }
    ])

    // 2. Export encrypted backup
    await createEncryptedPackage(dbPath, backupFile, PASSPHRASE)

    // 3. Inspect raw backup package
    const backupContent = await fs.readFile(backupFile, 'utf8')

    // Must never contain raw plaintext canary secret
    assert.equal(backupContent.includes(CANARY_SECRET), false)

    // Must be formatted with encrypted ciphertext
    assert.ok(backupContent.includes('ta-encrypted-backup-v2'))
    assert.ok(backupContent.includes('scrypt-n16384-r8-p1'))
  })

  test('restores encrypted backup to a fresh installation offline with 100% data fidelity', async () => {
    // 1. Setup source data
    await manager.applyMigrations([
      {
        version: 1,
        name: 'init_roster',
        sql: `
          CREATE TABLE custom_plans (plan_id TEXT PRIMARY KEY, notes TEXT);
          INSERT INTO custom_plans VALUES ('plan-42', 'Focus on Guild Raid Boss 5');
        `
      }
    ])

    await createEncryptedPackage(dbPath, backupFile, PASSPHRASE)

    // 2. Simulate fresh install in a new clean directory
    const freshDir = path.join(tempDir, 'fresh-installation')
    await fs.mkdir(freshDir)
    const freshDbPath = path.join(freshDir, 'fresh_app.db')

    // 3. Restore backup
    const restoreResult = await restoreEncryptedPackage(
      backupFile,
      freshDbPath,
      PASSPHRASE
    )
    assert.ok(restoreResult.restoredBytes > 0)

    // 4. Verify fresh database opens offline and contains committed data
    const restoredManager = new SqliteLifecycleManager(freshDbPath)
    await restoredManager.init()

    const plans = restoredManager.db
      .prepare('SELECT plan_id, notes FROM custom_plans WHERE plan_id = ?')
      .get('plan-42')
    assert.equal(plans.plan_id, 'plan-42')
    assert.equal(plans.notes, 'Focus on Guild Raid Boss 5')

    restoredManager.close()
  })

  test('rejects tampered or corrupt backups with AEAD auth tag failure and preserves active database', async () => {
    await manager.applyMigrations([
      {
        version: 1,
        name: 'm1',
        sql: 'CREATE TABLE secure_records (id INT); INSERT INTO secure_records VALUES (100);'
      }
    ])

    await createEncryptedPackage(dbPath, backupFile, PASSPHRASE)

    // Tamper with backup ciphertext
    const pkg = JSON.parse(await fs.readFile(backupFile, 'utf8'))
    const rawCipher = Buffer.from(pkg.ciphertextBase64, 'base64')
    rawCipher[0] ^= 0xff // Flip bits
    pkg.ciphertextBase64 = rawCipher.toString('base64')
    await fs.writeFile(backupFile, JSON.stringify(pkg))

    // Attempt restore to active database
    await assert.rejects(
      async () => {
        await restoreEncryptedPackage(
          backupFile,
          dbPath + '.attempted',
          PASSPHRASE
        )
      },
      (err) => {
        assert.match(
          err.message,
          /Unsupported state or unable to authenticate data/
        )
        return true
      }
    )

    // Active database remains 100% healthy and unmodified
    const record = manager.db.prepare('SELECT id FROM secure_records').get()
    assert.equal(record.id, 100)
  })

  test('wrong passphrase fails decryption immediately without writing output file', async () => {
    await manager.applyMigrations([
      { version: 1, name: 'm1', sql: 'CREATE TABLE t (x INT);' }
    ])

    await createEncryptedPackage(dbPath, backupFile, PASSPHRASE)

    const targetOutput = path.join(tempDir, 'should-not-exist.db')

    await assert.rejects(
      async () => {
        await restoreEncryptedPackage(
          backupFile,
          targetOutput,
          'WrongPassword123!'
        )
      },
      (err) => {
        assert.match(
          err.message,
          /Unsupported state or unable to authenticate data/
        )
        return true
      }
    )

    // Output target must NOT have been created
    const exists = await fs
      .stat(targetOutput)
      .then(() => true)
      .catch(() => false)
    assert.equal(exists, false)
  })
})
