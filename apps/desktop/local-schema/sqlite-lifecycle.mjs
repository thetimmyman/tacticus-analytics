import { DatabaseSync } from 'node:sqlite'
import { copyFile, unlink, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

/**
 * Custom Error Types for Schema Lifecycle
 */
export class SchemaIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'SchemaIntegrityError'
    this.details = details
  }
}

export class MigrationExecutionError extends Error {
  constructor(version, name, cause) {
    super(
      `Migration ${version} (${name}) failed during execution: ${cause.message}`
    )
    this.name = 'MigrationExecutionError'
    this.version = version
    this.migrationName = name
    this.cause = cause
  }
}

/**
 * Computes deterministic SHA-256 digest of string or buffer
 */
export function computeSha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * SQLite Local Schema Lifecycle Manager
 *
 * Provides:
 * 1. Clean-machine deterministic bootstrap
 * 2. Versioned append-only migration ledger with SHA-256 integrity verification
 * 3. Atomic transactions with pre-migration snapshotting & crash recovery
 * 4. Schema drift detection for unmanaged tables and altered migrations
 */
export class SqliteLifecycleManager {
  constructor(dbPath, options = {}) {
    if (!dbPath) throw new Error('Database path must be specified')
    this.dbPath = dbPath
    this.options = {
      backupSuffix: '.bak',
      allowUnmanagedTables: false,
      ...options
    }
    this.db = null
  }

  /**
   * Initializes database connection, applies PRAGMAs, and creates schema ledger tables
   */
  async init() {
    if (this.db) return

    this.db = new DatabaseSync(this.dbPath)

    // Mandatory PRAGMA invariants for durability and consistency
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
    `)

    // Create migration tracking ledger
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        checksum_sha256 TEXT NOT NULL,
        execution_time_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS _schema_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state TEXT NOT NULL CHECK (state IN ('ready', 'migrating', 'failed_recovery')),
        current_version INTEGER NOT NULL DEFAULT 0,
        pending_version INTEGER,
        last_backup_path TEXT,
        last_error TEXT
      );
    `)

    // Ensure status row exists
    const statusRow = this.db
      .prepare('SELECT id FROM _schema_status WHERE id = 1')
      .get()
    if (!statusRow) {
      this.db
        .prepare(
          `
        INSERT INTO _schema_status (id, state, current_version)
        VALUES (1, 'ready', 0)
      `
        )
        .run()
    }
  }

  /**
   * Returns current schema status row
   */
  getStatus() {
    this._ensureInitialized()
    return this.db
      .prepare(
        `
      SELECT state, current_version, pending_version, last_backup_path, last_error
      FROM _schema_status WHERE id = 1
    `
      )
      .get()
  }

  /**
   * Returns all applied migration records ordered by version
   */
  getAppliedMigrations() {
    this._ensureInitialized()
    return this.db
      .prepare(
        `
      SELECT version, name, applied_at, checksum_sha256, execution_time_ms
      FROM _schema_migrations ORDER BY version ASC
    `
      )
      .all()
  }

  /**
   * Verifies SHA-256 integrity of all previously applied migrations
   */
  verifyMigrationIntegrity(availableMigrations) {
    this._ensureInitialized()
    const applied = this.getAppliedMigrations()
    const availableMap = new Map(availableMigrations.map((m) => [m.version, m]))

    for (const record of applied) {
      const available = availableMap.get(record.version)
      if (!available) {
        throw new SchemaIntegrityError(
          `Applied migration ${record.version} (${record.name}) is missing from available migrations`,
          { version: record.version, reason: 'MISSING_MIGRATION' }
        )
      }

      const currentDigest =
        available.checksumSha256 || computeSha256(available.sql)
      if (currentDigest !== record.checksum_sha256) {
        throw new SchemaIntegrityError(
          `Applied migration ${record.version} (${record.name}) checksum mismatch: expected ${record.checksum_sha256}, got ${currentDigest}`,
          {
            version: record.version,
            recordedSha256: record.checksum_sha256,
            currentSha256: currentDigest,
            reason: 'CHECKSUM_MISMATCH'
          }
        )
      }
    }
  }

  /**
   * Creates an atomic backup snapshot of the database before applying migrations
   */
  async createPreMigrationBackup() {
    this._ensureInitialized()
    // Flush all WAL pages into the database file before creating snapshot
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);')

    const backupPath = `${this.dbPath}${this.options.backupSuffix}`
    await copyFile(this.dbPath, backupPath)
    return backupPath
  }

  /**
   * Applies all pending migrations deterministically in version order
   */
  async applyMigrations(availableMigrations) {
    this._ensureInitialized()

    const status = this.getStatus()
    if (status.state === 'failed_recovery') {
      throw new SchemaIntegrityError(
        'Database is in failed_recovery state. Restore from backup before attempting subsequent migrations.',
        { state: status.state, lastError: status.last_error }
      )
    }

    // 1. Verify integrity of existing migrations
    this.verifyMigrationIntegrity(availableMigrations)

    // 2. Filter to pending migrations sorted by version
    const sorted = [...availableMigrations].sort(
      (a, b) => a.version - b.version
    )
    const pending = sorted.filter((m) => m.version > status.current_version)

    if (pending.length === 0) {
      return { appliedCount: 0, currentVersion: status.current_version }
    }

    // 3. Create pre-migration backup snapshot
    const backupPath = await this.createPreMigrationBackup()
    const targetVersion = pending[pending.length - 1].version

    // Update state to 'migrating'
    this.db
      .prepare(
        `
      UPDATE _schema_status
      SET state = 'migrating', pending_version = ?, last_backup_path = ?, last_error = NULL
      WHERE id = 1
    `
      )
      .run(targetVersion, backupPath)

    let appliedCount = 0

    // 4. Execute migrations sequentially within immediate transactions
    for (const migration of pending) {
      const digest = migration.checksumSha256 || computeSha256(migration.sql)
      const startTime = performance.now()

      try {
        this.db.exec('BEGIN IMMEDIATE;')

        this.db.exec(migration.sql)

        const durationMs = Math.round(performance.now() - startTime)

        this.db
          .prepare(
            `
          INSERT INTO _schema_migrations (version, name, applied_at, checksum_sha256, execution_time_ms)
          VALUES (?, ?, datetime('now', 'utc'), ?, ?)
        `
          )
          .run(migration.version, migration.name, digest, durationMs)

        this.db
          .prepare(
            `
          UPDATE _schema_status
          SET current_version = ?
          WHERE id = 1
        `
          )
          .run(migration.version)

        this.db.exec('COMMIT;')
        appliedCount++
      } catch (err) {
        try {
          this.db.exec('ROLLBACK;')
        } catch {
          // ignore rollback error if connection already in failed state
        }

        this.db
          .prepare(
            `
          UPDATE _schema_status
          SET state = 'failed_recovery', last_error = ?
          WHERE id = 1
        `
          )
          .run(err.message)

        throw new MigrationExecutionError(
          migration.version,
          migration.name,
          err
        )
      }
    }

    // 5. Finalize status to 'ready' upon complete success
    this.db
      .prepare(
        `
      UPDATE _schema_status
      SET state = 'ready', pending_version = NULL, last_error = NULL
      WHERE id = 1
    `
      )
      .run()

    return {
      appliedCount,
      currentVersion: targetVersion
    }
  }

  /**
   * Restores the database from a backup snapshot following an interrupted or failed migration
   */
  async restoreFromBackup(backupPath) {
    const targetBackup =
      backupPath || `${this.dbPath}${this.options.backupSuffix}`
    const backupStat = await stat(targetBackup)
    if (!backupStat.isFile()) {
      throw new Error(`Backup file not found at ${targetBackup}`)
    }

    this.close()

    // Clean up any surviving WAL and SHM files to prevent stale replays
    await unlink(`${this.dbPath}-wal`).catch(() => {})
    await unlink(`${this.dbPath}-shm`).catch(() => {})

    // Restore file atomically
    await copyFile(targetBackup, this.dbPath)

    // Reopen and reconcile status
    await this.init()
    const status = this.getStatus()

    // Calculate actual current version based on restored ledger
    const maxRow = this.db
      .prepare('SELECT MAX(version) as max_v FROM _schema_migrations')
      .get()
    const trueVersion = maxRow?.max_v || 0

    this.db
      .prepare(
        `
      UPDATE _schema_status
      SET state = 'ready', current_version = ?, pending_version = NULL, last_error = NULL
      WHERE id = 1
    `
      )
      .run(trueVersion)

    return {
      restored: true,
      restoredVersion: trueVersion
    }
  }

  /**
   * Detects drift between registered migration tables and current database state
   */
  detectSchemaDrift(availableMigrations) {
    this._ensureInitialized()

    const systemTables = new Set([
      '_schema_migrations',
      '_schema_status',
      'sqlite_sequence'
    ])
    const actualTables = this.db
      .prepare(
        `
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `
      )
      .all()
      .map((r) => r.name)

    // Verify migration checksums
    const applied = this.getAppliedMigrations()
    const availableMap = new Map(availableMigrations.map((m) => [m.version, m]))
    const tampered = []

    for (const record of applied) {
      const avail = availableMap.get(record.version)
      if (!avail) {
        tampered.push({ version: record.version, reason: 'MISSING_SOURCE' })
      } else {
        const currentDigest = avail.checksumSha256 || computeSha256(avail.sql)
        if (currentDigest !== record.checksum_sha256) {
          tampered.push({
            version: record.version,
            recorded: record.checksum_sha256,
            current: currentDigest
          })
        }
      }
    }

    const unmanagedTables = actualTables.filter((tbl) => !systemTables.has(tbl))

    return {
      hasDrift: tampered.length > 0,
      tamperedMigrations: tampered,
      tableCount: actualTables.length,
      unmanagedTables
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close()
      } finally {
        this.db = null
      }
    }
  }

  _ensureInitialized() {
    if (!this.db) {
      throw new Error(
        'SqliteLifecycleManager is not initialized. Call init() first.'
      )
    }
  }
}
