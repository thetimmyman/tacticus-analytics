import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  createDefaultConsentPolicy,
  getFieldDisclosurePreview,
  validateUploadPayload,
  SharingConsentStore,
  SharingConsentError
} from '../launcher/sharing-consent.mjs'

test('Sharing Consent Lifecycle: Independent Purpose Controls, Field Previews, and Revocation', async (t) => {
  await t.test(
    'initializes default zero-sharing posture (all purposes, datasets, and history off)',
    () => {
      const policy = createDefaultConsentPolicy({
        accountRef: 'user-uuid-1',
        guildId: 'guild-uuid-1',
        purpose: 'meta'
      })

      assert.equal(policy.enabled, false)
      assert.equal(policy.paused, false)
      assert.equal(policy.historyWindow, 'future-only')
      assert.equal(policy.datasets.raid, false)
      assert.equal(policy.datasets.war, false)
      assert.equal(policy.datasets.replay, false)
    }
  )

  await t.test(
    'field disclosure preview transparently discloses destinations, visibility, and pseudonymous status',
    () => {
      const raidMetaPreview = getFieldDisclosurePreview('meta', 'raid')
      assert.equal(
        raidMetaPreview.disclosure.destination,
        'Global Community Analytics & Meta Trends'
      )
      assert.match(
        raidMetaPreview.fields.identityTreatment,
        /Pseudonymous.*Not anonymous/
      )
      assert.ok(raidMetaPreview.fields.allowedFields.includes('userId'))
      assert.ok(
        raidMetaPreview.fields.omittedFields.includes('playerAuthToken')
      )

      const replayPortalPreview = getFieldDisclosurePreview('portal', 'replay')
      assert.equal(
        replayPortalPreview.disclosure.destination,
        'Private Guild Portal'
      )
      assert.match(
        replayPortalPreview.fields.identityTreatment,
        /Raw replay timeline is NEVER uploaded/
      )
      assert.ok(
        replayPortalPreview.fields.allowedFields.includes('datasetDigest')
      )
      assert.ok(
        replayPortalPreview.fields.omittedFields.includes('rawEventStream')
      )
    }
  )

  await t.test(
    'validates payload allowlist and strictly rejects unknown, nested, or secret-bearing properties',
    () => {
      const policy = {
        version: 1,
        revision: 1,
        purpose: 'meta',
        guildId: 'guild-uuid-1',
        enabled: true,
        paused: false,
        historyWindow: 'future-only',
        from: '2026-11-01T00:00:00.000Z',
        until: null,
        datasets: { raid: true, war: false, replay: false }
      }

      // Valid payload
      const validPayload = {
        purpose: 'meta',
        dataset: 'raid',
        guildId: 'guild-uuid-1',
        consentRevision: 1,
        observedAt: '2026-11-02T12:00:00.000Z',
        rows: [
          {
            userId: 'player-uuid-1',
            tier: 5,
            set: 1,
            encounterIndex: 2,
            damageDealt: 150000,
            damageType: 'Battle',
            startedOn: 1700000000,
            completedOn: 1700000120,
            unitId: 'UnitCaptain'
          }
        ]
      }
      const result = validateUploadPayload(validPayload, policy)
      assert.equal(result.valid, true)
      assert.equal(result.rowCount, 1)

      // Rejects unconsented dataset
      const unconsentedDataset = { ...validPayload, dataset: 'war' }
      assert.throws(
        () => validateUploadPayload(unconsentedDataset, policy),
        (err) =>
          err instanceof SharingConsentError &&
          err.code === 'EDATASET_NOT_CONSENTED'
      )

      // Rejects historical data when future-only policy is set
      const historicalPayload = {
        ...validPayload,
        observedAt: '2026-10-15T00:00:00.000Z'
      }
      assert.throws(
        () => validateUploadPayload(historicalPayload, policy),
        (err) =>
          err instanceof SharingConsentError &&
          err.code === 'EHISTORICAL_DATA_REFUSED'
      )

      // Rejects payload bearing canary secret or local path
      const secretLeakPayload = {
        ...validPayload,
        rows: [{ ...validPayload.rows[0], token: 'CANARY-SECRET-TOKEN' }]
      }
      assert.throws(
        () => validateUploadPayload(secretLeakPayload, policy),
        (err) =>
          err instanceof SharingConsentError &&
          err.code === 'EFORBIDDEN_DATA_LEAK'
      )

      // Rejects payload with unknown non-allowlisted property
      const extraPropertyPayload = {
        ...validPayload,
        rows: [{ ...validPayload.rows[0], unexpectedField: 'malicious' }]
      }
      assert.throws(
        () => validateUploadPayload(extraPropertyPayload, policy),
        (err) =>
          err instanceof SharingConsentError && err.code === 'EUNKNOWN_FIELD'
      )
    }
  )

  await t.test(
    'consent store manages multi-purpose independence and granular dataset selections',
    () => {
      const db = new DatabaseSync(':memory:')
      const store = new SharingConsentStore(db)

      // Update 'meta' policy: enable raid only
      store.updateConsent('meta', 'guild-uuid-1', 'account-1', {
        enabled: true,
        datasets: { raid: true, war: false, replay: false }
      })

      // Update 'portal' policy: enable war and replay only
      store.updateConsent('portal', 'guild-uuid-1', 'account-1', {
        enabled: true,
        datasets: { raid: false, war: true, replay: true }
      })

      const metaPolicy = store.getPolicy('meta', 'guild-uuid-1', 'account-1')
      assert.equal(metaPolicy.enabled, true)
      assert.equal(metaPolicy.datasets.raid, true)
      assert.equal(metaPolicy.datasets.war, false)

      const portalPolicy = store.getPolicy(
        'portal',
        'guild-uuid-1',
        'account-1'
      )
      assert.equal(portalPolicy.enabled, true)
      assert.equal(portalPolicy.datasets.raid, false)
      assert.equal(portalPolicy.datasets.war, true)
      assert.equal(portalPolicy.datasets.replay, true)
    }
  )

  await t.test(
    'revoking consent immediately increments revision, kills pending queue jobs, and supports deletion receipt',
    () => {
      const db = new DatabaseSync(':memory:')
      // Setup work_queue mock table
      db.exec(`
      CREATE TABLE work_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now', 'utc'))
      );
    `)

      const store = new SharingConsentStore(db)

      // Enable sharing
      store.updateConsent('meta', 'guild-uuid-1', 'account-1', {
        enabled: true,
        datasets: { raid: true }
      })

      // Enqueue pending jobs
      db.prepare(
        "INSERT INTO work_queue (job_type, status) VALUES ('publish:meta:guild-uuid-1:raid', 'pending')"
      ).run()
      db.prepare(
        "INSERT INTO work_queue (job_type, status) VALUES ('publish:portal:guild-uuid-1:war', 'pending')"
      ).run()

      // Revoke 'meta' consent with remote deletion request
      const revokeResult = store.revokeConsent(
        'meta',
        'guild-uuid-1',
        'account-1',
        { requestRemoteDeletion: true }
      )

      assert.equal(revokeResult.revoked, true)
      assert.equal(revokeResult.action, 'stopped-and-deletion-requested')
      assert.ok(revokeResult.deletionReceipt)
      assert.equal(revokeResult.deletionReceipt.action, 'delete-prior-uploads')

      // Policy is now disabled with bumped revision
      const postRevokePolicy = store.getPolicy(
        'meta',
        'guild-uuid-1',
        'account-1'
      )
      assert.equal(postRevokePolicy.enabled, false)
      assert.equal(postRevokePolicy.revision, revokeResult.revision)

      // Meta job was cancelled/dead in work_queue
      const metaJob = db
        .prepare(
          "SELECT status, error FROM work_queue WHERE job_type LIKE 'publish:meta:%'"
        )
        .get()
      assert.equal(metaJob.status, 'dead')
      assert.match(metaJob.error, /consent revoked/)

      // Unrelated portal job remains pending
      const portalJob = db
        .prepare(
          "SELECT status FROM work_queue WHERE job_type LIKE 'publish:portal:%'"
        )
        .get()
      assert.equal(portalJob.status, 'pending')
    }
  )
})
