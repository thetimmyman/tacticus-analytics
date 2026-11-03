import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateReplayTimeline,
  ReplayPlaybackEngine,
  REPLAY_IMPORT_LIMITS,
  REPLAY_ASSET_MANIFEST,
  sanitizeReplayForPublication,
  ReplayValidationError
} from '../launcher/replay-module.mjs'

const validReplayFixture = {
  schemaVersion: 1,
  format: 'ta-replay-timeline-v1',
  durationMs: 1500,
  events: [
    { type: 'spawn', at: 0, entity: 1, side: 'allies', x: 10, y: 10, hp: 100 },
    {
      type: 'spawn',
      at: 0,
      entity: 2,
      side: 'opponents',
      x: 20,
      y: 20,
      hp: 120
    },
    { type: 'move', at: 250, entity: 1, x: 15, y: 15 },
    { type: 'damage', at: 500, entity: 2, amount: 40 },
    { type: 'damage', at: 750, entity: 1, amount: 25 },
    { type: 'damage', at: 1000, entity: 2, amount: 80 },
    { type: 'remove', at: 1250, entity: 2 }
  ]
}

test('Replay Add-on Lifecycle: Offline Import, Parsing Limits, and Playback Engine', async (t) => {
  await t.test(
    'imports and validates canonical replay timeline completely offline',
    () => {
      const rawJson = JSON.stringify(validReplayFixture)
      const result = validateReplayTimeline(rawJson)

      assert.equal(result.totalEntities, 2)
      assert.equal(result.eventCount, 7)
      assert.equal(result.durationMs, 1500)
      assert.equal(result.timeline.format, 'ta-replay-timeline-v1')
    }
  )

  await t.test('strictly rejects file-size overruns beyond limit', () => {
    const oversizePadding = ' '.repeat(REPLAY_IMPORT_LIMITS.maxBytes + 1)
    assert.throws(
      () => validateReplayTimeline(oversizePadding),
      (err) =>
        err instanceof ReplayValidationError && err.code === 'EFILE_TOO_LARGE'
    )
  })

  await t.test(
    'strictly rejects active script content, javascript links, and directory traversal',
    () => {
      const hostileInputs = [
        JSON.stringify({
          ...validReplayFixture,
          metadata: '<script>alert(1)</script>'
        }),
        JSON.stringify({
          ...validReplayFixture,
          metadata: 'javascript:void(0)'
        }),
        JSON.stringify({
          ...validReplayFixture,
          metadata: '<img onerror=alert(1)>'
        }),
        JSON.stringify({
          ...validReplayFixture,
          metadata: '../../../../etc/passwd'
        }),
        JSON.stringify({
          ...validReplayFixture,
          metadata: '..\\..\\windows\\system32'
        })
      ]

      for (const input of hostileInputs) {
        assert.throws(
          () => validateReplayTimeline(input),
          (err) =>
            err instanceof ReplayValidationError &&
            err.code === 'EHOSTILE_PAYLOAD'
        )
      }
    }
  )

  await t.test(
    'identifies and rejects unsupported schema versions and unknown formats',
    () => {
      const wrongFormat = JSON.stringify({
        ...validReplayFixture,
        format: 'unknown-format-v2'
      })
      assert.throws(
        () => validateReplayTimeline(wrongFormat),
        (err) =>
          err instanceof ReplayValidationError &&
          err.code === 'EUNSUPPORTED_FORMAT'
      )

      const wrongVersion = JSON.stringify({
        ...validReplayFixture,
        schemaVersion: 2
      })
      assert.throws(
        () => validateReplayTimeline(wrongVersion),
        (err) =>
          err instanceof ReplayValidationError &&
          err.code === 'EUNSUPPORTED_VERSION'
      )
    }
  )

  await t.test(
    'rejects non-monotonic event timestamps and out-of-order execution',
    () => {
      const outOfOrder = {
        ...validReplayFixture,
        events: [
          {
            type: 'spawn',
            at: 500,
            entity: 1,
            side: 'allies',
            x: 10,
            y: 10,
            hp: 100
          },
          { type: 'move', at: 200, entity: 1, x: 15, y: 15 } // Timestamp decreased!
        ]
      }
      assert.throws(
        () => validateReplayTimeline(JSON.stringify(outOfOrder)),
        (err) =>
          err instanceof ReplayValidationError &&
          err.code === 'ENON_MONOTONIC_TIMESTAMP'
      )
    }
  )

  await t.test(
    'rejects entity lifecycle violations (duplicate spawn, actions on unspawned/removed)',
    () => {
      const duplicateSpawn = {
        ...validReplayFixture,
        events: [
          {
            type: 'spawn',
            at: 0,
            entity: 1,
            side: 'allies',
            x: 10,
            y: 10,
            hp: 100
          },
          {
            type: 'spawn',
            at: 100,
            entity: 1,
            side: 'allies',
            x: 10,
            y: 10,
            hp: 100
          }
        ]
      }
      assert.throws(
        () => validateReplayTimeline(JSON.stringify(duplicateSpawn)),
        (err) =>
          err instanceof ReplayValidationError &&
          err.code === 'EDUPLICATE_SPAWN'
      )

      const prematureDamage = {
        ...validReplayFixture,
        events: [{ type: 'damage', at: 100, entity: 99, amount: 20 }]
      }
      assert.throws(
        () => validateReplayTimeline(JSON.stringify(prematureDamage)),
        (err) =>
          err instanceof ReplayValidationError &&
          err.code === 'EENTITY_NOT_FOUND'
      )
    }
  )

  await t.test(
    'playback engine projects deterministic frames across seek positions',
    () => {
      const engine = new ReplayPlaybackEngine(validReplayFixture)

      // Initial state at t = 0
      const frame0 = engine.projectFrame(0)
      assert.equal(frame0.provenance, 'locally-supplied-unverified')
      assert.equal(frame0.entities.length, 2)
      assert.equal(frame0.entities[0].x, 10)
      assert.equal(frame0.entities[0].y, 10)
      assert.equal(frame0.entities[0].hp, 100)

      // Intermediate state at t = 500 (Entity 1 moved, Entity 2 took 40 damage)
      const frame500 = engine.projectFrame(500)
      assert.equal(frame500.entities[0].x, 15)
      assert.equal(frame500.entities[0].y, 15)
      assert.equal(frame500.entities[1].hp, 80) // 120 - 40

      // After removal at t = 1300 (Entity 2 removed)
      const frame1300 = engine.projectFrame(1300)
      assert.equal(frame1300.entities.length, 1)
      assert.equal(frame1300.entities[0].entity, 1)
      assert.equal(frame1300.entities[0].hp, 75) // 100 - 25
    }
  )

  await t.test(
    'computes sanitized summary metrics without leaking raw player secrets or private IDs',
    () => {
      const engine = new ReplayPlaybackEngine(validReplayFixture)
      const metrics = engine.getSummaryMetrics()

      assert.equal(metrics.durationMs, 1500)
      assert.equal(metrics.totalEvents, 7)
      assert.equal(metrics.alliedDamageDealt, 120) // 40 + 80 to opponent (entity 2)
      assert.equal(metrics.alliedDamageTaken, 25) // 25 to ally (entity 1)
      assert.equal(metrics.entitiesCount, 2)
    }
  )

  await t.test(
    'redistributable asset manifest confirms zero proprietary extracted game art',
    () => {
      assert.equal(REPLAY_ASSET_MANIFEST.proprietaryAssetsIncluded, false)
      assert.equal(REPLAY_ASSET_MANIFEST.renderingEngine, 'vector-svg-board-v1')
      assert.ok(REPLAY_ASSET_MANIFEST.tokenPlaceholders.allies)
      assert.ok(REPLAY_ASSET_MANIFEST.tokenPlaceholders.opponents)
    }
  )

  await t.test(
    'publishing sanitization enforces opt-in consent and excludes raw event dumps',
    () => {
      // Fails closed if consent is omitted
      assert.throws(
        () =>
          sanitizeReplayForPublication(validReplayFixture, {
            optInStatsConsent: false
          }),
        (err) =>
          err instanceof ReplayValidationError &&
          err.code === 'ECONSENT_REQUIRED'
      )

      // With explicit consent, returns strictly anonymized summary schema
      const publishPayload = sanitizeReplayForPublication(validReplayFixture, {
        optInStatsConsent: true
      })
      assert.equal(publishPayload.schemaVersion, 1)
      assert.equal(publishPayload.format, 'ta-replay-summary-v1')
      assert.equal(publishPayload.rawEventsIncluded, false)
      assert.equal(publishPayload.anonymized, true)
      assert.equal(publishPayload.provenance, 'locally-supplied-unverified')
      assert.ok(publishPayload.datasetDigest)
      assert.equal(publishPayload.metrics.alliedDamageDealt, 120)
      assert.equal(typeof publishPayload.rawEvents, 'undefined')
    }
  )
})
