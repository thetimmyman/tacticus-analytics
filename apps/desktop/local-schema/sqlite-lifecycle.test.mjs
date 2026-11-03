import { test, describe, beforeEach, afterEach } from 'node:test'
import { strict as assert } from 'node:assert'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  SqliteLifecycleManager,
  SchemaIntegrityError,
  MigrationExecutionError,
  computeSha256
} from './sqlite-lifecycle.mjs'

describe('SQLite Schema Lifecycle and Bootstrap Suite', () => {
  let tempDir
  let dbPath
  let manager

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-lifecycle-test-'))
    dbPath = path.join(tempDir, 'desktop_local.db')
    manager = new SqliteLifecycleManager(dbPath)
  })

  afterEach(async () => {
    if (manager) {
      manager.close()
    }
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  test('clean bootstrap initializes WAL pragma and migration status ledger', async () => {
    await manager.init()

    const status = manager.getStatus()
    assert.equal(status.state, 'ready')
    assert.equal(status.current_version, 0)
    assert.equal(status.pending_version, null)
    assert.equal(status.last_error, null)

    const applied = manager.getAppliedMigrations()
    assert.deepEqual(applied, [])

    // Verify WAL journal mode
    const pragmaRow = manager.db.prepare('PRAGMA journal_mode;').get()
    assert.equal(pragmaRow.journal_mode.toLowerCase(), 'wal')
  })

  test('applies migrations deterministically and records version, timestamp, and checksum', async () => {
    await manager.init()

    const migrations = [
      {
        version: 1,
        name: 'create_characters_roster',
        sql: `
          CREATE TABLE roster_characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            rarity TEXT NOT NULL,
            rank INTEGER NOT NULL DEFAULT 1
          );
        `
      },
      {
        version: 2,
        name: 'create_raid_plans',
        sql: `
          CREATE TABLE raid_plans (
            id TEXT PRIMARY KEY,
            boss_id TEXT NOT NULL,
            target_date TEXT NOT NULL
          );
        `
      }
    ]

    const result = await manager.applyMigrations(migrations)
    assert.equal(result.appliedCount, 2)
    assert.equal(result.currentVersion, 2)

    const status = manager.getStatus()
    assert.equal(status.state, 'ready')
    assert.equal(status.current_version, 2)

    const applied = manager.getAppliedMigrations()
    assert.equal(applied.length, 2)

    assert.equal(applied[0].version, 1)
    assert.equal(applied[0].name, 'create_characters_roster')
    assert.equal(applied[0].checksum_sha256, computeSha256(migrations[0].sql))
    assert.ok(applied[0].execution_time_ms >= 0)

    assert.equal(applied[1].version, 2)
    assert.equal(applied[1].name, 'create_raid_plans')
    assert.equal(applied[1].checksum_sha256, computeSha256(migrations[1].sql))

    // Verify idempotent re-run applies zero migrations
    const reapply = await manager.applyMigrations(migrations)
    assert.equal(reapply.appliedCount, 0)
    assert.equal(reapply.currentVersion, 2)
  })

  test('aborts and raises SchemaIntegrityError when an applied migration is tampered with', async () => {
    await manager.init()

    const initialMigrations = [
      {
        version: 1,
        name: 'create_table_alpha',
        sql: 'CREATE TABLE table_alpha (id TEXT PRIMARY KEY);'
      }
    ]

    await manager.applyMigrations(initialMigrations)

    // Tamper with migration 1 SQL content
    const tamperedMigrations = [
      {
        version: 1,
        name: 'create_table_alpha',
        sql: 'CREATE TABLE table_alpha (id TEXT PRIMARY KEY, altered_col TEXT);'
      },
      {
        version: 2,
        name: 'create_table_beta',
        sql: 'CREATE TABLE table_beta (id TEXT PRIMARY KEY);'
      }
    ]

    await assert.rejects(
      async () => {
        await manager.applyMigrations(tamperedMigrations)
      },
      (err) => {
        assert.ok(err instanceof SchemaIntegrityError)
        assert.match(err.message, /checksum mismatch/)
        assert.equal(err.details.reason, 'CHECKSUM_MISMATCH')
        return true
      }
    )

    // Verify migration 2 was NOT applied due to integrity halt
    const status = manager.getStatus()
    assert.equal(status.current_version, 1)
  })

  test('aborts and raises SchemaIntegrityError when an applied migration is missing from source', async () => {
    await manager.init()

    await manager.applyMigrations([
      { version: 1, name: 'm1', sql: 'CREATE TABLE m1 (id INT);' },
      { version: 2, name: 'm2', sql: 'CREATE TABLE m2 (id INT);' }
    ])

    // Candidate migrations only supply version 2, omitting version 1
    const incompleteMigrations = [
      { version: 2, name: 'm2', sql: 'CREATE TABLE m2 (id INT);' },
      { version: 3, name: 'm3', sql: 'CREATE TABLE m3 (id INT);' }
    ]

    await assert.rejects(
      async () => {
        await manager.applyMigrations(incompleteMigrations)
      },
      (err) => {
        assert.ok(err instanceof SchemaIntegrityError)
        assert.match(err.message, /missing from available migrations/)
        assert.equal(err.details.reason, 'MISSING_MIGRATION')
        return true
      }
    )
  })

  test('rolls back transaction on SQL failure and locks database into failed_recovery state', async () => {
    await manager.init()

    await manager.applyMigrations([
      {
        version: 1,
        name: 'initial_ok',
        sql: 'CREATE TABLE initial_ok (id TEXT PRIMARY KEY);'
      }
    ])

    const brokenMigrations = [
      {
        version: 1,
        name: 'initial_ok',
        sql: 'CREATE TABLE initial_ok (id TEXT PRIMARY KEY);'
      },
      {
        version: 2,
        name: 'broken_syntax',
        sql: 'CREATE TABLE valid_step (id INT); INVALID SQL SYNTAX ERROR;'
      }
    ]

    await assert.rejects(
      async () => {
        await manager.applyMigrations(brokenMigrations)
      },
      (err) => {
        assert.ok(err instanceof MigrationExecutionError)
        assert.equal(err.version, 2)
        return true
      }
    )

    // Verify transaction rolled back (valid_step table does not exist)
    const validStepTable = manager.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'valid_step';"
      )
      .get()
    assert.equal(validStepTable, undefined)

    // Verify database is locked in failed_recovery
    const status = manager.getStatus()
    assert.equal(status.state, 'failed_recovery')
    assert.equal(status.current_version, 1)
    assert.ok(status.last_error.length > 0)

    // Subsequent migration attempts must be refused
    await assert.rejects(
      async () => {
        await manager.applyMigrations([
          {
            version: 1,
            name: 'initial_ok',
            sql: 'CREATE TABLE initial_ok (id TEXT PRIMARY KEY);'
          },
          {
            version: 2,
            name: 'repaired_attempt',
            sql: 'CREATE TABLE repaired (id INT);'
          }
        ])
      },
      (err) => {
        assert.ok(err instanceof SchemaIntegrityError)
        assert.match(err.message, /failed_recovery state/)
        return true
      }
    )
  })

  test('safely restores from backup snapshot following failed migration', async () => {
    await manager.init()

    // 1. Establish valid baseline
    await manager.applyMigrations([
      {
        version: 1,
        name: 'users_baseline',
        sql: 'CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);'
      }
    ])

    manager.db
      .prepare(
        "INSERT INTO users (id, username) VALUES ('u1', 'commander_alpha')"
      )
      .run()

    // 2. Trigger failed migration
    try {
      await manager.applyMigrations([
        {
          version: 1,
          name: 'users_baseline',
          sql: 'CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);'
        },
        { version: 2, name: 'bad_sql', sql: 'BAD SYNTAX;' }
      ])
    } catch {
      // expected failure
    }

    assert.equal(manager.getStatus().state, 'failed_recovery')

    // 3. Restore from backup
    const restoreResult = await manager.restoreFromBackup()
    assert.equal(restoreResult.restored, true)
    assert.equal(restoreResult.restoredVersion, 1)

    // 4. Verify original committed row is intact
    const userRow = manager.db
      .prepare('SELECT username FROM users WHERE id = ?')
      .get('u1')
    assert.equal(userRow.username, 'commander_alpha')

    // 5. Verify status is healthy and unlocked
    const status = manager.getStatus()
    assert.equal(status.state, 'ready')
    assert.equal(status.current_version, 1)
    assert.equal(status.last_error, null)

    // 6. Can now cleanly apply repaired migration
    const repairedResult = await manager.applyMigrations([
      {
        version: 1,
        name: 'users_baseline',
        sql: 'CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);'
      },
      {
        version: 2,
        name: 'fixed_sql',
        sql: 'CREATE TABLE guilds (id TEXT PRIMARY KEY);'
      }
    ])

    assert.equal(repairedResult.appliedCount, 1)
    assert.equal(repairedResult.currentVersion, 2)
  })

  test('drift detection flags tampered migrations and unmanaged tables', async () => {
    await manager.init()

    const migrations = [
      { version: 1, name: 'm1', sql: 'CREATE TABLE m1 (id INT);' }
    ]

    await manager.applyMigrations(migrations)

    // Add unmanaged table directly to database
    manager.db.exec('CREATE TABLE unmanaged_rogue_table (secret TEXT);')

    const driftResult = manager.detectSchemaDrift(migrations)
    assert.ok(driftResult.unmanagedTables.includes('unmanaged_rogue_table'))

    // Test with tampered definition
    const tampered = [
      { version: 1, name: 'm1', sql: 'CREATE TABLE m1 (id INT, modified INT);' }
    ]
    const tamperedDrift = manager.detectSchemaDrift(tampered)
    assert.equal(tamperedDrift.hasDrift, true)
    assert.equal(tamperedDrift.tamperedMigrations.length, 1)
  })
})
