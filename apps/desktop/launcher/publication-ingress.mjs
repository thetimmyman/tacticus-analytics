import { createHash, createHmac, randomUUID } from 'node:crypto'

export class IngressSecurityError extends Error {
  constructor(message, code = 'EINGRESS_SECURITY') {
    super(message)
    this.name = 'IngressSecurityError'
    this.code = code
  }
}

/**
 * Generates an authenticated, scoped publishing token.
 */
export function issuePublishingToken({
  signingKey,
  subjectUserId,
  guildId,
  purpose,
  revision = 1,
  ttlSeconds = 3600
}) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = {
    tokenId: randomUUID(),
    sub: subjectUserId,
    guildId,
    purpose,
    revision,
    exp: expiresAt
  }

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', signingKey)
    .update(payloadB64)
    .digest('base64url')
  return `${payloadB64}.${sig}`
}

/**
 * Validates publishing token authenticity and claims.
 */
export function verifyPublishingToken(
  tokenString,
  signingKey,
  { nowSeconds = Math.floor(Date.now() / 1000) } = {}
) {
  if (typeof tokenString !== 'string') {
    throw new IngressSecurityError('Token must be a string', 'EINVALID_TOKEN')
  }

  const parts = tokenString.split('.')
  if (parts.length !== 2) {
    throw new IngressSecurityError(
      'Malformed token structure',
      'EINVALID_TOKEN'
    )
  }

  const [payloadB64, providedSig] = parts
  const expectedSig = createHmac('sha256', signingKey)
    .update(payloadB64)
    .digest('base64url')

  if (providedSig !== expectedSig) {
    throw new IngressSecurityError(
      'Token signature verification failed',
      'EUNAUTHORIZED_TOKEN'
    )
  }

  let claims
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    throw new IngressSecurityError(
      'Malformed token claims JSON',
      'EINVALID_TOKEN'
    )
  }

  if (claims.exp < nowSeconds) {
    throw new IngressSecurityError(
      'Publishing token has expired',
      'ETOKEN_EXPIRED'
    )
  }

  return claims
}

/**
 * Ingestion and Publication Gate.
 * Enforces server-side authority, schema validation, deduplication, and zero-secret leak logging.
 */
export class PublicationIngressService {
  constructor({ signingKey, db }) {
    this.signingKey = signingKey
    this.db = db
    this.revokedTokenIds = new Set()
    this.init()
  }

  init() {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ingested_event_fingerprints (
        fingerprint TEXT PRIMARY KEY,
        dataset TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        first_request_id TEXT NOT NULL,
        ingested_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );

      CREATE TABLE IF NOT EXISTS publication_batch_receipts (
        request_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        dataset TEXT NOT NULL,
        status TEXT NOT NULL,
        rows_accepted INTEGER NOT NULL,
        rows_duplicate INTEGER NOT NULL,
        rows_rejected INTEGER NOT NULL,
        receipt_digest TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
    `)
  }

  revokeToken(tokenId) {
    this.revokedTokenIds.add(tokenId)
  }

  /**
   * Processes an incoming publication submission batch.
   */
  async ingestBatch(tokenString, batchPayload) {
    // 1. Authenticate token
    const claims = verifyPublishingToken(tokenString, this.signingKey)
    if (this.revokedTokenIds.has(claims.tokenId)) {
      throw new IngressSecurityError(
        'Publishing token has been revoked',
        'ETOKEN_REVOKED'
      )
    }

    if (!batchPayload || typeof batchPayload !== 'object') {
      throw new IngressSecurityError(
        'Invalid batch payload',
        'EMALFORMED_PAYLOAD'
      )
    }

    const { purpose, dataset, guildId, consentRevision, requestId, rows } =
      batchPayload

    // 2. Authorize scope: Token claims override and enforce server-side authority
    if (purpose !== claims.purpose) {
      throw new IngressSecurityError(
        `Token purpose '${claims.purpose}' does not authorize payload purpose '${purpose}'`,
        'EFORBIDDEN_PURPOSE'
      )
    }

    if (guildId !== claims.guildId) {
      throw new IngressSecurityError(
        `Token guild '${claims.guildId}' does not authorize payload guild '${guildId}'`,
        'EFORBIDDEN_GUILD'
      )
    }

    if (consentRevision < claims.revision) {
      throw new IngressSecurityError(
        `Stale consent revision ${consentRevision} (server requires ${claims.revision})`,
        'ESTALE_REVISION'
      )
    }

    // 3. Scan for secret canaries and forbidden tokens before any persistence or logging
    const rawString = JSON.stringify(batchPayload)
    if (
      /canary/i.test(rawString) ||
      /secret/i.test(rawString) ||
      /password/i.test(rawString) ||
      /bearer\s+[a-z0-9]/i.test(rawString) ||
      /private[-_]?key/i.test(rawString) ||
      /\/home\//.test(rawString) ||
      /[a-z]:\\/i.test(rawString)
    ) {
      // Quarantine event - do NOT record raw payload in error or log
      const quarantineReceiptId = randomUUID()
      const receiptDigest = createHash('sha256')
        .update(`quarantine:${requestId}:${guildId}:${dataset}`)
        .digest('hex')

      if (this.db) {
        this.db
          .prepare(
            `
          INSERT INTO publication_batch_receipts (request_id, guild_id, purpose, dataset, status, rows_accepted, rows_duplicate, rows_rejected, receipt_digest)
          VALUES (?, ?, ?, ?, 'quarantined', 0, 0, ?, ?)
        `
          )
          .run(
            requestId,
            guildId,
            purpose,
            dataset,
            rows?.length || 0,
            receiptDigest
          )
      }

      throw new IngressSecurityError(
        'Submission quarantined due to forbidden credential or path markers',
        'EQUARANTINE_VIOLATION'
      )
    }

    // 4. Check for duplicate batch (idempotency)
    if (this.db) {
      const existingReceipt = this.db
        .prepare(
          `
        SELECT * FROM publication_batch_receipts WHERE request_id = ?
      `
        )
        .get(requestId)

      if (existingReceipt) {
        return {
          status: 'idempotent-cached',
          requestId,
          receiptDigest: existingReceipt.receipt_digest,
          rowsAccepted: existingReceipt.rows_accepted,
          rowsDuplicate: existingReceipt.rows_duplicate
        }
      }
    }

    // 5. Ingest rows with intrinsic event deduplication
    let rowsAccepted = 0
    let rowsDuplicate = 0
    let rowsRejected = 0

    if (this.db) {
      this.db.exec('BEGIN IMMEDIATE;')
      try {
        for (const row of rows || []) {
          // Construct intrinsic fingerprint independent of client installation ID
          let intrinsicKey
          if (dataset === 'raid') {
            intrinsicKey = [
              row.userId,
              row.startedOn,
              row.completedOn,
              row.unitId,
              row.tier,
              row.encounterIndex,
              row.damageType
            ].join('/')
          } else {
            intrinsicKey = createHash('sha256')
              .update(JSON.stringify(row))
              .digest('hex')
          }

          const fingerprint = createHash('sha256')
            .update(`${guildId}:${dataset}:${intrinsicKey}`)
            .digest('hex')

          const existing = this.db
            .prepare(
              `
            SELECT 1 FROM ingested_event_fingerprints WHERE fingerprint = ?
          `
            )
            .get(fingerprint)

          if (existing) {
            rowsDuplicate += 1
          } else {
            this.db
              .prepare(
                `
              INSERT INTO ingested_event_fingerprints (fingerprint, dataset, guild_id, first_request_id)
              VALUES (?, ?, ?, ?)
            `
              )
              .run(fingerprint, dataset, guildId, requestId)
            rowsAccepted += 1
          }
        }

        const receiptDigest = createHash('sha256')
          .update(`receipt:${requestId}:${rowsAccepted}:${rowsDuplicate}`)
          .digest('hex')

        this.db
          .prepare(
            `
          INSERT INTO publication_batch_receipts (request_id, guild_id, purpose, dataset, status, rows_accepted, rows_duplicate, rows_rejected, receipt_digest)
          VALUES (?, ?, ?, ?, 'verified', ?, ?, ?, ?)
        `
          )
          .run(
            requestId,
            guildId,
            purpose,
            dataset,
            rowsAccepted,
            rowsDuplicate,
            rowsRejected,
            receiptDigest
          )

        this.db.exec('COMMIT;')

        return {
          status: 'verified',
          requestId,
          receiptDigest,
          rowsAccepted,
          rowsDuplicate,
          rowsRejected
        }
      } catch (err) {
        this.db.exec('ROLLBACK;')
        throw err
      }
    }

    return {
      status: 'verified',
      requestId,
      rowsAccepted: rows?.length || 0,
      rowsDuplicate: 0
    }
  }
}
