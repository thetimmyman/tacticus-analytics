import { randomUUID } from 'node:crypto'
import { localIdentity } from '../launcher/local-workspace.mjs'

/**
 * Local Service and Storage Adapters
 *
 * Provides:
 * 1. Offline local workspace creation and recovery (zero OAuth/network requirement)
 * 2. In-process durable job queue with crash/suspend recovery (work_queue)
 * 3. Local privilege boundary checks preventing external browser escalation
 */

export class LocalWorkspaceAdapter {
  constructor(db) {
    if (!db) throw new Error('DatabaseSync instance required')
    this.db = db
  }

  /**
   * Initializes workspace tables in the local SQLite database
   */
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_config (
        id INTEGER PRIMARY KEY,
        guild_code TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        onboarding_completed BOOLEAN NOT NULL DEFAULT 0,
        auto_sync_enabled BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS player_identity_attestations (
        id TEXT PRIMARY KEY,
        mapping_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        subject_user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        consumed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        attested_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS player_mapping (
        id INTEGER PRIMARY KEY,
        player_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        guild_code TEXT NOT NULL,
        user_id TEXT NOT NULL,
        is_current BOOLEAN NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT 1,
        role TEXT NOT NULL DEFAULT 'member',
        is_app_admin BOOLEAN NOT NULL DEFAULT 0,
        ownership_attestation_id TEXT REFERENCES player_identity_attestations(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS desktop_preview_setup (
        singleton BOOLEAN PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
        subject_user_id TEXT NOT NULL,
        identity_mode TEXT NOT NULL,
        guild_code TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
    `)
  }

  /**
   * Creates a local workspace offline with zero external network connectivity
   */
  createWorkspace(subject, identity) {
    const data = localIdentity(identity)
    if (!/^[a-f0-9-]{36}$/.test(subject)) {
      throw new Error('Local account creation failed: invalid subject UUID')
    }

    const attestationId = randomUUID()

    this.db.exec('BEGIN IMMEDIATE;')
    try {
      // 1. Insert or update guild config
      this.db
        .prepare(
          `
        INSERT INTO guild_config (id, guild_code, display_name, enabled, onboarding_completed, auto_sync_enabled)
        VALUES (1, ?, ?, 1, 0, 0)
        ON CONFLICT(id) DO UPDATE SET guild_code = excluded.guild_code, display_name = excluded.display_name
      `
        )
        .run(data.guildCode, data.guildName)

      // 2. Insert attestation
      this.db
        .prepare(
          `
        INSERT INTO player_identity_attestations (id, mapping_id, player_id, subject_user_id, source)
        VALUES (?, 1, ?, ?, 'desktop_local_claim')
      `
        )
        .run(attestationId, data.playerId, subject)

      // 3. Insert or update player mapping
      this.db
        .prepare(
          `
        INSERT INTO player_mapping (id, player_id, display_name, guild_code, user_id, is_current, is_active, role, is_app_admin, ownership_attestation_id)
        VALUES (1, ?, ?, ?, ?, 1, 1, 'member', 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          player_id = excluded.player_id,
          display_name = excluded.display_name,
          guild_code = excluded.guild_code,
          user_id = excluded.user_id,
          ownership_attestation_id = excluded.ownership_attestation_id
      `
        )
        .run(
          data.playerId,
          data.displayName,
          data.guildCode,
          subject,
          attestationId
        )

      // 4. Record preview setup
      this.db
        .prepare(
          `
        INSERT INTO desktop_preview_setup (singleton, subject_user_id, identity_mode, guild_code)
        VALUES (1, ?, 'local-file', ?)
        ON CONFLICT(singleton) DO UPDATE SET
          subject_user_id = excluded.subject_user_id,
          identity_mode = excluded.identity_mode,
          guild_code = excluded.guild_code
      `
        )
        .run(subject, data.guildCode)

      this.db.exec('COMMIT;')

      return {
        success: true,
        subject,
        guildCode: data.guildCode,
        playerId: data.playerId,
        displayName: data.displayName
      }
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }

  /**
   * Loads current local workspace metadata without remote authentication
   */
  getWorkspace() {
    const setup = this.db
      .prepare(
        'SELECT subject_user_id, identity_mode, guild_code FROM desktop_preview_setup WHERE singleton = 1'
      )
      .get()
    if (!setup) return null

    const player = this.db
      .prepare(
        'SELECT player_id, display_name, guild_code, role FROM player_mapping WHERE id = 1'
      )
      .get()
    const guild = this.db
      .prepare(
        'SELECT guild_code, display_name, enabled FROM guild_config WHERE id = 1'
      )
      .get()

    return {
      subjectUserId: setup.subject_user_id,
      identityMode: setup.identity_mode,
      guild,
      player
    }
  }
}

export class LocalJobQueueAdapter {
  constructor(db) {
    if (!db) throw new Error('DatabaseSync instance required')
    this.db = db
  }

  /**
   * Initializes durable work_queue table in SQLite
   */
  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        job_class TEXT NOT NULL CHECK (job_class IN ('batch', 'sync', 'webhook', 'alert', 'notification', 'hook', 'heavy', 'verify', 'volunteer')),
        payload TEXT NOT NULL DEFAULT '{}',
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead')),
        priority INTEGER NOT NULL DEFAULT 5 CHECK (priority >= 1 AND priority <= 9),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        claimed_by TEXT,
        claimed_at TEXT,
        scheduled_for TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        started_at TEXT,
        completed_at TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE INDEX IF NOT EXISTS idx_work_queue_status_sched 
        ON work_queue (status, priority DESC, scheduled_for);
      
      CREATE UNIQUE INDEX IF NOT EXISTS idx_work_queue_dedupe 
        ON work_queue (dedupe_key) WHERE status IN ('pending', 'processing');
    `)
  }

  /**
   * Enqueues a job with deduplication
   */
  enqueueJob({
    jobType,
    jobClass = 'hook',
    payload = {},
    dedupeKey,
    priority = 5,
    scheduledFor = null
  }) {
    const payloadStr = JSON.stringify(payload)

    try {
      if (scheduledFor) {
        const stmt = this.db.prepare(`
          INSERT INTO work_queue (job_type, job_class, payload, dedupe_key, priority, scheduled_for, status)
          VALUES (?, ?, ?, ?, ?, datetime(?), 'pending')
        `)
        const res = stmt.run(
          jobType,
          jobClass,
          payloadStr,
          dedupeKey,
          priority,
          scheduledFor
        )
        return { enqueued: true, jobId: res.lastInsertRowid }
      } else {
        const stmt = this.db.prepare(`
          INSERT INTO work_queue (job_type, job_class, payload, dedupe_key, priority, scheduled_for, status)
          VALUES (?, ?, ?, ?, ?, datetime('now', 'utc'), 'pending')
        `)
        const res = stmt.run(jobType, jobClass, payloadStr, dedupeKey, priority)
        return { enqueued: true, jobId: res.lastInsertRowid }
      }
    } catch (err) {
      // If unique constraint on dedupe_key violated, job is already active
      if (err.message.includes('UNIQUE constraint failed')) {
        return { enqueued: false, reason: 'DEDUPLICATED' }
      }
      throw err
    }
  }

  /**
   * Atomically claims the next eligible pending job for processing
   */
  claimNextJob(workerId) {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const job = this.db
        .prepare(
          `
        SELECT id, job_type, job_class, payload, priority, attempts, max_attempts
        FROM work_queue
        WHERE status = 'pending' AND scheduled_for <= datetime('now', 'utc')
        ORDER BY priority DESC, scheduled_for ASC
        LIMIT 1
      `
        )
        .get()

      if (!job) {
        this.db.exec('COMMIT;')
        return null
      }

      const nextAttempts = job.attempts + 1

      this.db
        .prepare(
          `
        UPDATE work_queue
        SET status = 'processing',
            claimed_by = ?,
            claimed_at = datetime('now', 'utc'),
            started_at = datetime('now', 'utc'),
            attempts = ?,
            updated_at = datetime('now', 'utc')
        WHERE id = ?
      `
        )
        .run(workerId, nextAttempts, job.id)

      this.db.exec('COMMIT;')

      return {
        ...job,
        attempts: nextAttempts,
        payload: JSON.parse(job.payload)
      }
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }

  /**
   * Marks a job completed
   */
  completeJob(jobId) {
    this.db
      .prepare(
        `
      UPDATE work_queue
      SET status = 'completed',
          completed_at = datetime('now', 'utc'),
          updated_at = datetime('now', 'utc'),
          error = NULL
      WHERE id = ?
    `
      )
      .run(jobId)
  }

  /**
   * Marks a job failed, re-queuing if attempts remain, or marking dead if exhausted
   */
  failJob(jobId, errorMsg) {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const job = this.db
        .prepare('SELECT attempts, max_attempts FROM work_queue WHERE id = ?')
        .get(jobId)
      if (!job) {
        this.db.exec('COMMIT;')
        return
      }

      const isDead = job.attempts >= job.max_attempts
      const nextStatus = isDead ? 'dead' : 'pending'

      this.db
        .prepare(
          `
        UPDATE work_queue
        SET status = ?,
            error = ?,
            updated_at = datetime('now', 'utc')
        WHERE id = ?
      `
        )
        .run(nextStatus, errorMsg, jobId)

      this.db.exec('COMMIT;')
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }

  /**
   * Recovers dangling jobs stuck in 'processing' due to process death or machine suspend
   */
  recoverDanglingJobs(timeoutMinutes = 5) {
    const res = this.db
      .prepare(
        `
      UPDATE work_queue
      SET status = 'pending',
          claimed_by = NULL,
          claimed_at = NULL,
          updated_at = datetime('now', 'utc')
      WHERE status = 'processing'
        AND claimed_at <= datetime('now', '-' || ? || ' minutes', 'utc')
    `
      )
      .run(timeoutMinutes)

    return res.changes
  }
}

/**
 * Validates request origin and capability boundary to prevent browser privilege escalation
 */
export function validateServiceBoundary({
  origin,
  host,
  transportKey,
  expectedKey,
  requestedByBrowser = false
}) {
  if (requestedByBrowser) {
    throw new Error(
      'External browser context is forbidden from accessing local desktop services'
    )
  }

  if (!expectedKey || !transportKey || transportKey !== expectedKey) {
    throw new Error('Invalid or missing desktop transport capability token')
  }

  if (host && host !== '127.0.0.1' && !host.startsWith('127.0.0.1:')) {
    throw new Error('Host header violation: DNS rebinding rejected')
  }

  if (
    origin &&
    !origin.startsWith('http://127.0.0.1:') &&
    origin !== 'tauri://localhost'
  ) {
    throw new Error('Foreign origin rejected by desktop capability boundary')
  }

  return true
}
