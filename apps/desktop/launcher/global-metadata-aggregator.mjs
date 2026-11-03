import { createHash, randomUUID } from 'node:crypto'

export const MINIMUM_COHORT_THRESHOLD = 5

export class AggregationError extends Error {
  constructor(message, code = 'EAGGREGATION') {
    super(message)
    this.name = 'AggregationError'
    this.code = code
  }
}

/**
 * Purpose-limited Global Metadata Aggregation and Deletion Lineage Engine.
 */
export class GlobalMetadataAggregator {
  constructor(db) {
    this.db = db
    this.init()
  }

  init() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS global_contribution_records (
        record_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK(purpose IN ('meta', 'portal')),
        dataset TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        boss_id TEXT NOT NULL,
        tier INTEGER NOT NULL,
        damage INTEGER NOT NULL,
        is_quarantined INTEGER NOT NULL DEFAULT 0,
        contributed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS global_derived_meta_aggregates (
        boss_id TEXT NOT NULL,
        tier INTEGER NOT NULL,
        sample_count INTEGER NOT NULL,
        total_damage INTEGER NOT NULL,
        avg_damage REAL NOT NULL,
        min_damage INTEGER NOT NULL,
        max_damage INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        last_recomputed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        PRIMARY KEY (boss_id, tier)
      );

      CREATE TABLE IF NOT EXISTS global_deletion_lineage (
        lineage_id TEXT PRIMARY KEY,
        account_ref TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        records_deleted INTEGER NOT NULL,
        executed_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
    `)
  }

  /**
   * Records a validated contribution. Fails closed if purpose is not 'meta'.
   */
  recordContribution({
    purpose,
    dataset,
    guildId,
    accountRef,
    fingerprint,
    bossId,
    tier,
    damage,
    isQuarantined = false
  }) {
    if (!this.db) return

    // Strict schema boundary: Never accept portal records into global contribution table
    if (purpose !== 'meta') {
      throw new AggregationError(
        `Purpose '${purpose}' cannot be added to global metadata. Only 'meta' purpose allowed`,
        'EINVALID_PURPOSE_BOUNDARY'
      )
    }

    const recordId = randomUUID()
    this.db
      .prepare(
        `
      INSERT INTO global_contribution_records (
        record_id, purpose, dataset, guild_id, account_ref, fingerprint, boss_id, tier, damage, is_quarantined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        recordId,
        purpose,
        dataset,
        guildId,
        accountRef,
        fingerprint,
        bossId,
        tier,
        damage,
        isQuarantined ? 1 : 0
      )

    return { recordId, fingerprint }
  }

  /**
   * Recomputes derived aggregate statistics from scratch, enforcing:
   * 1. Only purpose = 'meta' and is_quarantined = 0.
   * 2. Intrinsic event deduplication across multiple collectors.
   * 3. k-anonymity privacy threshold (minimum 5 samples per boss/tier cohort).
   */
  recomputeAggregates() {
    if (!this.db) return

    this.db.exec('BEGIN IMMEDIATE;')
    try {
      this.db.exec('DELETE FROM global_derived_meta_aggregates;')

      // Query deduplicated, valid meta records
      const cohorts = this.db
        .prepare(
          `
        WITH deduplicated AS (
          SELECT DISTINCT fingerprint, boss_id, tier, damage
          FROM global_contribution_records
          WHERE purpose = 'meta' AND is_quarantined = 0
        )
        SELECT 
          boss_id,
          tier,
          count(*) as sample_count,
          sum(damage) as total_damage,
          avg(damage) as avg_damage,
          min(damage) as min_damage,
          max(damage) as max_damage
        FROM deduplicated
        GROUP BY boss_id, tier
      `
        )
        .all()

      const insertAgg = this.db.prepare(`
        INSERT INTO global_derived_meta_aggregates (
          boss_id, tier, sample_count, total_damage, avg_damage, min_damage, max_damage, metadata_json, last_recomputed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'))
      `)

      for (const c of cohorts) {
        // Enforce privacy threshold: do not publish cohorts below minimum threshold
        const isSuppressed = c.sample_count < MINIMUM_COHORT_THRESHOLD
        const meta = {
          formatVersion: 1,
          thresholdMet: !isSuppressed,
          privacyPolicy: 'k-anonymity-5'
        }

        if (!isSuppressed) {
          insertAgg.run(
            c.boss_id,
            c.tier,
            c.sample_count,
            c.total_damage,
            Math.round(c.avg_damage),
            c.min_damage,
            c.max_damage,
            JSON.stringify(meta)
          )
        }
      }

      this.db.exec('COMMIT;')
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }

  /**
   * Reads public aggregate statistics for a given boss and tier.
   * Rejects queries if cohort did not meet privacy threshold.
   */
  getPublicCohortMeta(bossId, tier) {
    if (!this.db) return null
    const row = this.db
      .prepare(
        `
      SELECT * FROM global_derived_meta_aggregates
      WHERE boss_id = ? AND tier = ?
    `
      )
      .get(bossId, tier)

    if (!row) {
      return {
        bossId,
        tier,
        published: false,
        reason: 'insufficient-sample-size-or-no-data',
        minRequiredSamples: MINIMUM_COHORT_THRESHOLD
      }
    }

    return {
      bossId: row.boss_id,
      tier: row.tier,
      published: true,
      sampleCount: row.sample_count,
      avgDamage: row.avg_damage,
      minDamage: row.min_damage,
      maxDamage: row.max_damage,
      metadata: JSON.parse(row.metadata_json)
    }
  }

  /**
   * Executes an approved user data deletion request:
   * 1. Deletes raw contribution records matching accountRef and guildId.
   * 2. Logs cryptographic deletion lineage audit receipt.
   * 3. Recomputes all global aggregates immediately to purge deleted inputs.
   */
  executeDeletionRequest(accountRef, guildId) {
    if (!this.db) return null

    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const deleteResult = this.db
        .prepare(
          `
        DELETE FROM global_contribution_records
        WHERE account_ref = ? AND guild_id = ?
      `
        )
        .run(accountRef, guildId)

      const lineageId = randomUUID()
      this.db
        .prepare(
          `
        INSERT INTO global_deletion_lineage (lineage_id, account_ref, guild_id, records_deleted)
        VALUES (?, ?, ?, ?)
      `
        )
        .run(lineageId, accountRef, guildId, deleteResult.changes)

      this.db.exec('COMMIT;')

      // Recompute derived statistics without deleted inputs
      this.recomputeAggregates()

      return {
        lineageId,
        accountRef,
        guildId,
        recordsDeleted: deleteResult.changes,
        recomputed: true
      }
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }
}
