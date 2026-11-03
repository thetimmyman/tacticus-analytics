import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  DurablePublishingQueue,
  PublishingQueueError
} from '../launcher/publishing-queue.mjs'
import { SharingConsentStore } from '../launcher/sharing-consent.mjs'

test('Durable Publishing Queue Lifecycle: Consent Rechecks, Partitions, Retries & Receipts', async (t) => {
  function setupTestEnvironment() {
    const db = new DatabaseSync(':memory:')
    const consentStore = new SharingConsentStore(db)
    const queue = new DurablePublishingQueue({
      db,
      consentStore,
      maxRetries: 3,
      retryDelayMs: 10
    })
    return { db, consentStore, queue }
  }

  await t.test(
    'enqueues job only when consent is active and fails closed when absent',
    () => {
      const { consentStore, queue } = setupTestEnvironment()

      // Fails closed initially
      assert.throws(
        () =>
          queue.enqueueJob({
            purpose: 'meta',
            guildId: 'GUILD-A',
            dataset: 'raid',
            accountRef: 'user-alpha',
            payload: { test: true }
          }),
        (err) =>
          err instanceof PublishingQueueError &&
          err.code === 'ECONSENT_NOT_GRANTED'
      )

      // Grant consent for raid in meta
      consentStore.updateConsent('meta', 'GUILD-A', 'user-alpha', {
        enabled: true,
        datasets: { raid: true }
      })

      const enqueued = queue.enqueueJob({
        purpose: 'meta',
        guildId: 'GUILD-A',
        dataset: 'raid',
        accountRef: 'user-alpha',
        payload: { test: true }
      })

      assert.equal(enqueued.status, 'pending')
      assert.ok(enqueued.jobId)
    }
  )

  await t.test(
    'strictly partitions purposes: turning off portal does not affect meta jobs',
    async () => {
      const { consentStore, queue } = setupTestEnvironment()

      consentStore.updateConsent('meta', 'GUILD-A', 'user-alpha', {
        enabled: true,
        datasets: { raid: true }
      })
      consentStore.updateConsent('portal', 'GUILD-A', 'user-alpha', {
        enabled: true,
        datasets: { raid: true }
      })

      // Enqueue one job for meta and one for portal
      const metaJob = queue.enqueueJob({
        purpose: 'meta',
        guildId: 'GUILD-A',
        dataset: 'raid',
        accountRef: 'user-alpha',
        payload: { data: 'meta-batch' }
      })
      const portalJob = queue.enqueueJob({
        purpose: 'portal',
        guildId: 'GUILD-A',
        dataset: 'raid',
        accountRef: 'user-alpha',
        payload: { data: 'portal-batch' }
      })

      // Now revoke portal consent only
      consentStore.updateConsent('portal', 'GUILD-A', 'user-alpha', {
        enabled: false
      })

      // Process jobs
      const mockSender = async (purpose, guildId, payload) => ({
        status: 'verified',
        receiptDigest: 'digest-123'
      })

      const res1 = await queue.processNextJob(mockSender)
      assert.equal(res1.jobId, metaJob.jobId)
      assert.equal(res1.status, 'delivered') // Meta succeeds!

      const res2 = await queue.processNextJob(mockSender)
      assert.equal(res2.jobId, portalJob.jobId)
      assert.equal(res2.status, 'dead') // Portal killed due to revoked consent before dispatch!
      assert.equal(res2.reason, 'consent-revoked')
    }
  )

  await t.test(
    'recovers dangling in_flight jobs after simulated process crash or suspend',
    () => {
      const { db, consentStore, queue } = setupTestEnvironment()

      consentStore.updateConsent('meta', 'GUILD-A', 'user-alpha', {
        enabled: true,
        datasets: { raid: true }
      })

      const job = queue.enqueueJob({
        purpose: 'meta',
        guildId: 'GUILD-A',
        dataset: 'raid',
        accountRef: 'user-alpha',
        payload: { data: 'batch-crash' }
      })

      // Simulate job was claimed and process died 10 minutes ago
      const tenMinutesAgo = Date.now() - 600000
      db.prepare(
        `
      UPDATE publishing_queue
      SET status = 'in_flight', next_attempt_at = ?
      WHERE job_id = ?
    `
      ).run(tenMinutesAgo, job.jobId)

      // Trigger recovery
      const recoveredCount = queue.recoverStaleInFlightJobs(300000)
      assert.equal(recoveredCount, 1)

      // Job is back to pending
      const recoveredJob = db
        .prepare('SELECT status FROM publishing_queue WHERE job_id = ?')
        .get(job.jobId)
      assert.equal(recoveredJob.status, 'pending')
    }
  )

  await t.test(
    'retries on transport errors with exponential backoff and records receipts upon success',
    async () => {
      const { consentStore, queue } = setupTestEnvironment()

      consentStore.updateConsent('meta', 'GUILD-A', 'user-alpha', {
        enabled: true,
        datasets: { raid: true }
      })

      const job = queue.enqueueJob({
        purpose: 'meta',
        guildId: 'GUILD-A',
        dataset: 'raid',
        accountRef: 'user-alpha',
        payload: { data: 'batch-retry' }
      })

      // 1. Simulate network failure on attempt 1
      let failSender = true
      const flappySender = async () => {
        if (failSender) throw new Error('Network timeout')
        return { status: 'verified', receiptDigest: 'digest-abc' }
      }

      const attempt1 = await queue.processNextJob(flappySender)
      assert.equal(attempt1.status, 'retrying')
      assert.match(attempt1.error, /Network timeout/)

      // Fast-forward delay and let sender succeed
      failSender = false
      await new Promise((r) => setTimeout(r, 25))
      const statusBefore = queue.getQueueStatus('GUILD-A')
      assert.equal(statusBefore.summary.pending, 1)

      // Now succeed
      const attempt2 = await queue.processNextJob(flappySender)
      assert.equal(attempt2.status, 'delivered')

      const statusAfter = queue.getQueueStatus('GUILD-A')
      assert.equal(statusAfter.summary.delivered, 1)
      assert.equal(statusAfter.recentReceipts.length, 1)
      assert.equal(
        statusAfter.recentReceipts[0].server_receipt_digest,
        'digest-abc'
      )
    }
  )
})
