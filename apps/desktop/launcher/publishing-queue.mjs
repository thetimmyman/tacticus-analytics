import { randomUUID, createHash } from 'node:crypto'

export class PublishingQueueError extends Error {
  constructor(message, code = 'EPUBLISHING_QUEUE') {
    super(message)
    this.name = 'PublishingQueueError'
    this.code = code
  }
}

/**
 * Durable, consent-aware publishing queue backed by SQLite.
 * Ensures strict purpose/guild/dataset isolation and just-in-time consent rechecking.
 */
export class DurablePublishingQueue {
  constructor({
    db,
    consentStore,
    portalManager,
    maxRetries = 5,
    retryDelayMs = 1000
  }) {
    this.db = db
    this.consentStore = consentStore
    this.portalManager = portalManager
    this.maxRetries = maxRetries
    this.retryDelayMs = retryDelayMs
    this.init()
  }

  init() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS publishing_queue (
        job_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK(purpose IN ('meta', 'portal')),
        guild_id TEXT NOT NULL,
        dataset TEXT NOT NULL CHECK(dataset IN ('raid', 'war', 'replay')),
        account_ref TEXT NOT NULL,
        consent_revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'in_flight', 'delivered', 'dead')),
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        next_attempt_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS publishing_receipts (
        receipt_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        dataset TEXT NOT NULL,
        status TEXT NOT NULL,
        server_receipt_digest TEXT,
        received_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (job_id) REFERENCES publishing_queue(job_id) ON DELETE CASCADE
      );
    `)
  }

  /**
   * Enqueues an upload job after verifying current consent.
   */
  enqueueJob({ purpose, guildId, dataset, accountRef, payload }) {
    if (!this.db) return null

    // Check consent policy before enqueueing
    const policy = this.consentStore.getPolicy(purpose, guildId, accountRef)
    if (!policy || !policy.enabled || policy.paused) {
      throw new PublishingQueueError(
        'Sharing is not consented for this purpose and guild',
        'ECONSENT_NOT_GRANTED'
      )
    }

    if (!policy.datasets[dataset]) {
      throw new PublishingQueueError(
        `Dataset '${dataset}' is not consented for sharing`,
        'EDATASET_NOT_CONSENTED'
      )
    }

    const jobId = randomUUID()
    const nowMs = Date.now()

    this.db
      .prepare(
        `
      INSERT INTO publishing_queue (
        job_id, purpose, guild_id, dataset, account_ref, consent_revision, payload_json, status, attempts, next_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `
      )
      .run(
        jobId,
        purpose,
        guildId,
        dataset,
        accountRef,
        policy.revision,
        JSON.stringify(payload),
        nowMs
      )

    return { jobId, status: 'pending', purpose, guildId, dataset }
  }

  /**
   * Recovers dangling jobs stuck in 'in_flight' state following process crash or restart.
   */
  recoverStaleInFlightJobs(staleThresholdMs = 300000) {
    if (!this.db) return 0
    const cutoff = Date.now() - staleThresholdMs
    const result = this.db
      .prepare(
        `
      UPDATE publishing_queue
      SET status = 'pending', updated_at = datetime('now', 'utc')
      WHERE status = 'in_flight' AND next_attempt_at < ?
    `
      )
      .run(cutoff)
    return result.changes
  }

  /**
   * Processes the next eligible job in the queue using the provided transport sender function.
   */
  async processNextJob(transportSender) {
    if (!this.db) return null
    const nowMs = Date.now()

    // 1. Claim next pending job
    const job = this.db
      .prepare(
        `
      SELECT * FROM publishing_queue
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT 1
    `
      )
      .get(nowMs)

    if (!job) return null

    // Mark in_flight
    this.db
      .prepare(
        `
      UPDATE publishing_queue
      SET status = 'in_flight', attempts = attempts + 1, updated_at = datetime('now', 'utc')
      WHERE job_id = ?
    `
      )
      .run(job.job_id)

    // 2. Just-In-Time Consent & Authority Recheck
    const policy = this.consentStore.getPolicy(
      job.purpose,
      job.guild_id,
      job.account_ref
    )
    if (
      !policy ||
      !policy.enabled ||
      policy.paused ||
      !policy.datasets[job.dataset]
    ) {
      // Consent was revoked while job sat in queue: cancel it immediately
      this.db
        .prepare(
          `
        UPDATE publishing_queue
        SET status = 'dead', error = 'Consent revoked before dispatch', updated_at = datetime('now', 'utc')
        WHERE job_id = ?
      `
        )
        .run(job.job_id)

      return { jobId: job.job_id, status: 'dead', reason: 'consent-revoked' }
    }

    if (policy.revision !== job.consent_revision) {
      // Consent revision bumped: cancel stale job
      this.db
        .prepare(
          `
        UPDATE publishing_queue
        SET status = 'dead', error = 'Stale consent revision', updated_at = datetime('now', 'utc')
        WHERE job_id = ?
      `
        )
        .run(job.job_id)

      return { jobId: job.job_id, status: 'dead', reason: 'stale-revision' }
    }

    // 3. Dispatch via transport sender
    try {
      const payload = JSON.parse(job.payload_json)
      const receipt = await transportSender(job.purpose, job.guild_id, payload)

      // Record successful delivery
      this.db.exec('BEGIN IMMEDIATE;')
      try {
        this.db
          .prepare(
            `
          UPDATE publishing_queue
          SET status = 'delivered', error = NULL, updated_at = datetime('now', 'utc')
          WHERE job_id = ?
        `
          )
          .run(job.job_id)

        const receiptId = randomUUID()
        this.db
          .prepare(
            `
          INSERT INTO publishing_receipts (
            receipt_id, job_id, purpose, guild_id, dataset, status, server_receipt_digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            receiptId,
            job.job_id,
            job.purpose,
            job.guild_id,
            job.dataset,
            receipt.status,
            receipt.receiptDigest || null
          )

        this.db.exec('COMMIT;')
        return { jobId: job.job_id, status: 'delivered', receipt }
      } catch (err) {
        this.db.exec('ROLLBACK;')
        throw err
      }
    } catch (err) {
      // Handle retry or mark dead
      const nextAttempts = job.attempts + 1
      const isDead = nextAttempts >= this.maxRetries
      const nextAttemptAt = isDead
        ? nowMs
        : nowMs + this.retryDelayMs * Math.pow(2, job.attempts)

      this.db
        .prepare(
          `
        UPDATE publishing_queue
        SET status = ?, error = ?, next_attempt_at = ?, updated_at = datetime('now', 'utc')
        WHERE job_id = ?
      `
        )
        .run(
          isDead ? 'dead' : 'pending',
          err.message || 'Transport error',
          nextAttemptAt,
          job.job_id
        )

      return {
        jobId: job.job_id,
        status: isDead ? 'dead' : 'retrying',
        error: err.message
      }
    }
  }

  /**
   * Retrieves summary of queue status and recent receipts.
   */
  getQueueStatus(guildId) {
    if (!this.db) return { pending: 0, delivered: 0, dead: 0, receipts: [] }

    const counts = this.db
      .prepare(
        `
      SELECT status, count(*) as count
      FROM publishing_queue
      WHERE guild_id = ?
      GROUP BY status
    `
      )
      .all(guildId)

    const receipts = this.db
      .prepare(
        `
      SELECT * FROM publishing_receipts
      WHERE guild_id = ?
      ORDER BY received_at DESC
      LIMIT 10
    `
      )
      .all(guildId)

    const summary = { pending: 0, delivered: 0, dead: 0, in_flight: 0 }
    for (const c of counts) {
      summary[c.status] = c.count
    }

    return {
      guildId,
      summary,
      recentReceipts: receipts
    }
  }
}
