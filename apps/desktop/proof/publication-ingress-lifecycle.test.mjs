import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  issuePublishingToken,
  verifyPublishingToken,
  PublicationIngressService,
  IngressSecurityError
} from '../launcher/publication-ingress.mjs'

test('Publication Ingress Lifecycle: Scoped Ingestion, Token Validation, Deduplication & Quarantine', async (t) => {
  const signingKey = randomBytes(32)

  await t.test(
    'issues and validates scoped publishing token with cryptographic integrity',
    () => {
      const token = issuePublishingToken({
        signingKey,
        subjectUserId: 'user-1',
        guildId: 'GUILD-A',
        purpose: 'portal',
        revision: 2,
        ttlSeconds: 60
      })

      const claims = verifyPublishingToken(token, signingKey)
      assert.equal(claims.sub, 'user-1')
      assert.equal(claims.guildId, 'GUILD-A')
      assert.equal(claims.purpose, 'portal')
      assert.equal(claims.revision, 2)
    }
  )

  await t.test('rejects expired tokens and tampered signatures', () => {
    const expiredToken = issuePublishingToken({
      signingKey,
      subjectUserId: 'user-1',
      guildId: 'GUILD-A',
      purpose: 'portal',
      ttlSeconds: -10 // expired in the past
    })

    assert.throws(
      () => verifyPublishingToken(expiredToken, signingKey),
      (err) =>
        err instanceof IngressSecurityError && err.code === 'ETOKEN_EXPIRED'
    )

    const wrongKey = randomBytes(32)
    const validToken = issuePublishingToken({
      signingKey,
      subjectUserId: 'user-1',
      guildId: 'GUILD-A',
      purpose: 'portal'
    })

    assert.throws(
      () => verifyPublishingToken(validToken, wrongKey),
      (err) =>
        err instanceof IngressSecurityError &&
        err.code === 'EUNAUTHORIZED_TOKEN'
    )
  })

  await t.test(
    'enforces server-side authority: rejects wrong-guild and wrong-purpose tokens regardless of payload claims',
    async () => {
      const db = new DatabaseSync(':memory:')
      const ingress = new PublicationIngressService({ signingKey, db })

      // Token authorizes GUILD-A and purpose 'portal'
      const tokenA = issuePublishingToken({
        signingKey,
        subjectUserId: 'user-1',
        guildId: 'GUILD-A',
        purpose: 'portal',
        revision: 1
      })

      // Malicious payload attempts to inject data for GUILD-B
      const spoofedGuildPayload = {
        requestId: randomUUID(),
        guildId: 'GUILD-B', // Attempting cross-guild spoofing!
        purpose: 'portal',
        dataset: 'raid',
        consentRevision: 1,
        rows: []
      }

      await assert.rejects(
        ingress.ingestBatch(tokenA, spoofedGuildPayload),
        (err) =>
          err instanceof IngressSecurityError && err.code === 'EFORBIDDEN_GUILD'
      )

      // Payload attempts to submit for 'meta' using 'portal' token
      const wrongPurposePayload = {
        requestId: randomUUID(),
        guildId: 'GUILD-A',
        purpose: 'meta', // Purpose mismatch!
        dataset: 'raid',
        consentRevision: 1,
        rows: []
      }

      await assert.rejects(
        ingress.ingestBatch(tokenA, wrongPurposePayload),
        (err) =>
          err instanceof IngressSecurityError &&
          err.code === 'EFORBIDDEN_PURPOSE'
      )
    }
  )

  await t.test(
    'quarantines payload with canary secret without leaking raw body into error messages',
    async () => {
      const db = new DatabaseSync(':memory:')
      const ingress = new PublicationIngressService({ signingKey, db })

      const token = issuePublishingToken({
        signingKey,
        subjectUserId: 'user-1',
        guildId: 'GUILD-A',
        purpose: 'portal',
        revision: 1
      })

      const canaryPayload = {
        requestId: randomUUID(),
        guildId: 'GUILD-A',
        purpose: 'portal',
        dataset: 'raid',
        consentRevision: 1,
        rows: [
          { userId: 'user-1', secretCanaryToken: 'SYNTHETIC-CANARY-VALUE' }
        ]
      }

      await assert.rejects(ingress.ingestBatch(token, canaryPayload), (err) => {
        assert.equal(err.code, 'EQUARANTINE_VIOLATION')
        // Error message must NOT leak the canary token
        assert.doesNotMatch(err.message, /SYNTHETIC-CANARY-VALUE/)
        return true
      })

      // Quarantined receipt is recorded in database
      const receipt = db
        .prepare(
          'SELECT status FROM publication_batch_receipts WHERE request_id = ?'
        )
        .get(canaryPayload.requestId)
      assert.equal(receipt.status, 'quarantined')
    }
  )

  await t.test(
    'deduplicates events across multiple collectors and handles idempotent batch retries',
    async () => {
      const db = new DatabaseSync(':memory:')
      const ingress = new PublicationIngressService({ signingKey, db })

      const token = issuePublishingToken({
        signingKey,
        subjectUserId: 'collector-client-1',
        guildId: 'GUILD-A',
        purpose: 'portal',
        revision: 1
      })

      const raidRow1 = {
        userId: 'player-1',
        startedOn: 1700000000,
        completedOn: 1700000100,
        unitId: 'UnitX',
        tier: 3,
        encounterIndex: 1,
        damageType: 'Battle'
      }

      const batch1 = {
        requestId: randomUUID(),
        guildId: 'GUILD-A',
        purpose: 'portal',
        dataset: 'raid',
        consentRevision: 1,
        rows: [raidRow1]
      }

      // Ingest first batch from collector 1
      const res1 = await ingress.ingestBatch(token, batch1)
      assert.equal(res1.status, 'verified')
      assert.equal(res1.rowsAccepted, 1)
      assert.equal(res1.rowsDuplicate, 0)

      // Retry exact same batch (idempotency)
      const retryRes = await ingress.ingestBatch(token, batch1)
      assert.equal(retryRes.status, 'idempotent-cached')
      assert.equal(retryRes.rowsAccepted, 1)

      // A second different collector submits a batch containing the exact same event
      const token2 = issuePublishingToken({
        signingKey,
        subjectUserId: 'collector-client-2',
        guildId: 'GUILD-A',
        purpose: 'portal',
        revision: 1
      })

      const batch2 = {
        requestId: randomUUID(), // New request from collector 2
        guildId: 'GUILD-A',
        purpose: 'portal',
        dataset: 'raid',
        consentRevision: 1,
        rows: [raidRow1] // Same intrinsic event
      }

      const res2 = await ingress.ingestBatch(token2, batch2)
      assert.equal(res2.status, 'verified')
      assert.equal(res2.rowsAccepted, 0)
      assert.equal(res2.rowsDuplicate, 1) // Recognized as duplicate!
    }
  )
})
