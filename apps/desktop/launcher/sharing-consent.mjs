import { randomUUID, createHash } from 'node:crypto'

export const SHARING_PURPOSES = Object.freeze(['meta', 'portal'])
export const SHARING_DATASETS = Object.freeze(['raid', 'war', 'replay'])

export class SharingConsentError extends Error {
  constructor(message, code = 'ESHARING_CONSENT') {
    super(message)
    this.name = 'SharingConsentError'
    this.code = code
  }
}

/**
 * Creates default zero-sharing policy.
 * All purposes, datasets, and historical uploads are default-off.
 */
export function createDefaultConsentPolicy({ accountRef, guildId, purpose }) {
  if (!SHARING_PURPOSES.includes(purpose)) {
    throw new SharingConsentError(
      `Invalid purpose '${purpose}'`,
      'EINVALID_PURPOSE'
    )
  }

  return {
    version: 1,
    revision: 1,
    accountRef,
    guildId,
    purpose,
    enabled: false,
    paused: false,
    historyWindow: 'future-only',
    from: new Date().toISOString(),
    until: null,
    datasets: {
      raid: false,
      war: false,
      replay: false
    },
    updatedAt: new Date().toISOString()
  }
}

/**
 * Previews visible fields and destinations for user review before enrollment.
 */
export function getFieldDisclosurePreview(purpose, dataset) {
  if (!SHARING_PURPOSES.includes(purpose)) {
    throw new SharingConsentError(
      `Unknown purpose '${purpose}'`,
      'EINVALID_PURPOSE'
    )
  }
  if (!SHARING_DATASETS.includes(dataset)) {
    throw new SharingConsentError(
      `Unknown dataset '${dataset}'`,
      'EINVALID_DATASET'
    )
  }

  const disclosures = {
    meta: {
      destination: 'Global Community Analytics & Meta Trends',
      visibility: 'Public aggregate benchmarks across all participating guilds',
      retention: 'Permanent aggregate; raw records rolled up after 90 days'
    },
    portal: {
      destination: 'Private Guild Portal',
      visibility:
        'Restricted exclusively to authenticated members of your guild',
      retention: 'Retained for active season plus 3 historical seasons'
    }
  }

  const datasetFields = {
    raid: {
      identityTreatment: 'Pseudonymous (account-derived UUID). Not anonymous.',
      allowedFields: [
        'userId',
        'tier',
        'set',
        'encounterIndex',
        'damageDealt',
        'damageType',
        'startedOn',
        'completedOn',
        'unitId'
      ],
      omittedFields: [
        'playerAuthToken',
        'gamePassword',
        'ipAddress',
        'localDevicePaths'
      ]
    },
    war: {
      identityTreatment:
        'Guild-aggregate and slot numbers [1-30]. No real names.',
      allowedFields: [
        'season',
        'totalBattles',
        'totalPoints',
        'overallWinRate',
        'zoneAggregates'
      ],
      omittedFields: [
        'chatMessages',
        'individualRosterDetails',
        'gameCredentials'
      ]
    },
    replay: {
      identityTreatment:
        'Anonymized combat metrics only. Raw replay timeline is NEVER uploaded.',
      allowedFields: [
        'durationMs',
        'totalEvents',
        'alliedDamageDealt',
        'entitiesCount',
        'datasetDigest'
      ],
      omittedFields: [
        'rawEventStream',
        'coordinates',
        'replayFileBytes',
        'playerIds'
      ]
    }
  }

  return {
    purpose,
    dataset,
    disclosure: disclosures[purpose],
    fields: datasetFields[dataset]
  }
}

/**
 * Validates payload against strict schema allowlist.
 * Fails closed on any unexpected or secret-bearing properties.
 */
export function validateUploadPayload(payload, policy) {
  if (!policy || !policy.enabled || policy.paused) {
    throw new SharingConsentError(
      'Sharing is not enabled or currently paused',
      'ECONSENT_DISABLED'
    )
  }

  const { purpose, dataset, guildId, consentRevision, observedAt, rows } =
    payload

  if (purpose !== policy.purpose) {
    throw new SharingConsentError(
      `Purpose mismatch: payload '${purpose}' vs policy '${policy.purpose}'`,
      'EPURPOSE_MISMATCH'
    )
  }
  if (guildId !== policy.guildId) {
    throw new SharingConsentError(
      `Guild mismatch: payload '${guildId}' vs policy '${policy.guildId}'`,
      'EGUILD_MISMATCH'
    )
  }
  if (consentRevision !== policy.revision) {
    throw new SharingConsentError(
      `Stale consent revision: payload ${consentRevision} vs policy ${policy.revision}`,
      'ESTALE_REVISION'
    )
  }
  if (!policy.datasets[dataset]) {
    throw new SharingConsentError(
      `Dataset '${dataset}' is not consented for sharing`,
      'EDATASET_NOT_CONSENTED'
    )
  }

  // History window verification
  if (policy.historyWindow === 'future-only' && observedAt < policy.from) {
    throw new SharingConsentError(
      `Historical record from ${observedAt} precedes consented enrollment time ${policy.from}`,
      'EHISTORICAL_DATA_REFUSED'
    )
  }

  if (policy.until && observedAt > policy.until) {
    throw new SharingConsentError(
      'Observed record falls after policy expiration',
      'EPOLICY_EXPIRED'
    )
  }

  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) {
    throw new SharingConsentError(
      'Rows must be an array with 1 to 100 items',
      'EINVALID_ROWS'
    )
  }

  const payloadString = JSON.stringify(payload)
  // Check for forbidden secret markers or local filesystem paths
  if (
    /password/i.test(payloadString) ||
    /token/i.test(payloadString) ||
    /secret/i.test(payloadString) ||
    /bearer/i.test(payloadString) ||
    /\/home\//.test(payloadString) ||
    /[A-Z]:\\/i.test(payloadString)
  ) {
    throw new SharingConsentError(
      'Payload contains forbidden secret tokens or local filesystem paths',
      'EFORBIDDEN_DATA_LEAK'
    )
  }

  const disclosure = getFieldDisclosurePreview(purpose, dataset)
  const allowedSet = new Set(disclosure.fields.allowedFields)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new SharingConsentError(
        `Row at index ${i} is not a valid object`,
        'EINVALID_ROW'
      )
    }
    for (const key of Object.keys(row)) {
      if (!allowedSet.has(key)) {
        throw new SharingConsentError(
          `Non-allowlisted property '${key}' in ${dataset} row`,
          'EUNKNOWN_FIELD'
        )
      }
    }
  }

  return { valid: true, rowCount: rows.length }
}

/**
 * Manages durable local storage of sharing consent policies in SQLite.
 */
export class SharingConsentStore {
  constructor(db) {
    this.db = db
    this.init()
  }

  init() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sharing_consent_policies (
        purpose TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        account_ref TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        history_window TEXT NOT NULL DEFAULT 'future-only',
        consented_from TEXT NOT NULL,
        consented_until TEXT,
        datasets_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc')),
        PRIMARY KEY (purpose, guild_id, account_ref)
      );

      CREATE TABLE IF NOT EXISTS sharing_deletion_receipts (
        receipt_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        dataset TEXT NOT NULL,
        revision INTEGER NOT NULL,
        action TEXT NOT NULL,
        receipt_digest TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
    `)
  }

  getPolicy(purpose, guildId, accountRef) {
    if (!this.db) return null
    const row = this.db
      .prepare(
        `
      SELECT * FROM sharing_consent_policies
      WHERE purpose = ? AND guild_id = ? AND account_ref = ?
    `
      )
      .get(purpose, guildId, accountRef)

    if (!row) {
      return createDefaultConsentPolicy({ purpose, guildId, accountRef })
    }

    return {
      version: row.version,
      revision: row.revision,
      accountRef: row.account_ref,
      guildId: row.guild_id,
      purpose: row.purpose,
      enabled: Boolean(row.enabled),
      paused: Boolean(row.paused),
      historyWindow: row.history_window,
      from: row.consented_from,
      until: row.consented_until,
      datasets: JSON.parse(row.datasets_json),
      updatedAt: row.updated_at
    }
  }

  updateConsent(purpose, guildId, accountRef, updates) {
    if (!this.db) return
    const current = this.getPolicy(purpose, guildId, accountRef)
    const nextRevision = current.revision + 1
    const nextEnabled = updates.enabled ?? current.enabled
    const nextPaused = updates.paused ?? current.paused
    const nextHistory = updates.historyWindow ?? current.historyWindow
    const nextDatasets = { ...current.datasets, ...(updates.datasets || {}) }
    const nowIso = new Date().toISOString()

    this.db
      .prepare(
        `
      INSERT INTO sharing_consent_policies (
        purpose, guild_id, account_ref, version, revision, enabled, paused,
        history_window, consented_from, consented_until, datasets_json, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'utc'))
      ON CONFLICT(purpose, guild_id, account_ref) DO UPDATE SET
        revision = excluded.revision,
        enabled = excluded.enabled,
        paused = excluded.paused,
        history_window = excluded.history_window,
        consented_from = excluded.consented_from,
        consented_until = excluded.consented_until,
        datasets_json = excluded.datasets_json,
        updated_at = excluded.updated_at
    `
      )
      .run(
        purpose,
        guildId,
        accountRef,
        nextRevision,
        nextEnabled ? 1 : 0,
        nextPaused ? 1 : 0,
        nextHistory,
        updates.from ?? current.from,
        updates.until ?? current.until,
        JSON.stringify(nextDatasets)
      )

    return this.getPolicy(purpose, guildId, accountRef)
  }

  /**
   * Immediately revokes consent:
   * 1. Sets policy enabled = 0, increments revision.
   * 2. Clears any pending queue entries in work_queue for this purpose/guild.
   * 3. Optionally creates deletion request receipt for prior published records.
   */
  revokeConsent(
    purpose,
    guildId,
    accountRef,
    { requestRemoteDeletion = false } = {}
  ) {
    if (!this.db) return

    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const current = this.getPolicy(purpose, guildId, accountRef)
      const nextRevision = current.revision + 1

      // 1. Update policy
      this.db
        .prepare(
          `
        UPDATE sharing_consent_policies
        SET enabled = 0, revision = ?, updated_at = datetime('now', 'utc')
        WHERE purpose = ? AND guild_id = ? AND account_ref = ?
      `
        )
        .run(nextRevision, purpose, guildId, accountRef)

      // 2. Clear unsent pending publishing work in work_queue
      this.db
        .prepare(
          `
        UPDATE work_queue
        SET status = 'dead', error = 'Sharing consent revoked by user', updated_at = datetime('now', 'utc')
        WHERE job_type LIKE ? AND status = 'pending'
      `
        )
        .run(`publish:${purpose}:${guildId}:%`)

      // 3. Record deletion receipt if requested
      let deletionReceipt = null
      if (requestRemoteDeletion) {
        const receiptId = randomUUID()
        const digest = createHash('sha256')
          .update(`${receiptId}:${purpose}:${guildId}:${nextRevision}`)
          .digest('hex')

        this.db
          .prepare(
            `
          INSERT INTO sharing_deletion_receipts (receipt_id, purpose, guild_id, dataset, revision, action, receipt_digest)
          VALUES (?, ?, ?, 'all', ?, 'delete-prior-uploads', ?)
        `
          )
          .run(receiptId, purpose, guildId, nextRevision, digest)

        deletionReceipt = {
          receiptId,
          digest,
          action: 'delete-prior-uploads',
          revision: nextRevision
        }
      }

      this.db.exec('COMMIT;')

      return {
        revoked: true,
        revision: nextRevision,
        action: requestRemoteDeletion
          ? 'stopped-and-deletion-requested'
          : 'stopped-future-uploads-only',
        deletionReceipt
      }
    } catch (err) {
      this.db.exec('ROLLBACK;')
      throw err
    }
  }
}
