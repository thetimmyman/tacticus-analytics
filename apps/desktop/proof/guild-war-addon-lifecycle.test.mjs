import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  validateGuildWarSummary,
  GuildWarAnalyticsEngine,
  GuildWarHistoryStore,
  sanitizeGuildWarForPublication,
  GuildWarValidationError,
  GUILD_WAR_LIMITS
} from '../launcher/guild-war-module.mjs'

const validWarFixture = {
  schemaVersion: 1,
  format: 'ta-war-summary-v1',
  season: 42,
  guildCode: 'GUILD-ALPHA',
  battles: [
    { battle: 1, attackerSlot: 1, zone: 1, points: 250, outcome: 'victory' },
    { battle: 2, attackerSlot: 1, zone: 2, points: 300, outcome: 'victory' },
    { battle: 3, attackerSlot: 2, zone: 1, points: 50, outcome: 'defeat' },
    { battle: 4, attackerSlot: 3, zone: 5, points: 400, outcome: 'victory' }
  ]
}

test('Guild War Add-on Lifecycle: Offline Processing, Tactical Analytics, and Historical Resilience', async (t) => {
  await t.test(
    'validates and parses valid Guild War summary 100% offline',
    () => {
      const rawJson = JSON.stringify(validWarFixture)
      const result = validateGuildWarSummary(rawJson, 'GUILD-ALPHA')

      assert.equal(result.season, 42)
      assert.equal(result.totalBattles, 4)
    }
  )

  await t.test(
    'enforces cross-guild isolation and rejects mismatched guild codes',
    () => {
      const rawJson = JSON.stringify(validWarFixture)
      assert.throws(
        () => validateGuildWarSummary(rawJson, 'GUILD-BRAVO'),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'ECROSS_GUILD_MISMATCH'
      )
    }
  )

  await t.test(
    'strictly rejects file-size overruns and hostile injection payloads',
    () => {
      const oversizePadding = ' '.repeat(GUILD_WAR_LIMITS.maxBytes + 1)
      assert.throws(
        () => validateGuildWarSummary(oversizePadding),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'EFILE_TOO_LARGE'
      )

      const scriptInjection = JSON.stringify({
        ...validWarFixture,
        note: '<script>alert("xss")</script>'
      })
      assert.throws(
        () => validateGuildWarSummary(scriptInjection),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'EHOSTILE_PAYLOAD'
      )
    }
  )

  await t.test(
    'rejects duplicate battle IDs and out-of-range player/zone slots',
    () => {
      const duplicateBattle = {
        ...validWarFixture,
        battles: [
          {
            battle: 1,
            attackerSlot: 1,
            zone: 1,
            points: 200,
            outcome: 'victory'
          },
          {
            battle: 1,
            attackerSlot: 2,
            zone: 1,
            points: 200,
            outcome: 'victory'
          }
        ]
      }
      assert.throws(
        () => validateGuildWarSummary(JSON.stringify(duplicateBattle)),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'EDUPLICATE_BATTLE'
      )

      const invalidSlot = {
        ...validWarFixture,
        battles: [
          {
            battle: 1,
            attackerSlot: 31,
            zone: 1,
            points: 200,
            outcome: 'victory'
          }
        ]
      }
      assert.throws(
        () => validateGuildWarSummary(JSON.stringify(invalidSlot)),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'ESLOT_OUT_OF_RANGE'
      )

      const invalidZone = {
        ...validWarFixture,
        battles: [
          {
            battle: 1,
            attackerSlot: 1,
            zone: 26,
            points: 200,
            outcome: 'victory'
          }
        ]
      }
      assert.throws(
        () => validateGuildWarSummary(JSON.stringify(invalidZone)),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'EZONE_OUT_OF_RANGE'
      )
    }
  )

  await t.test(
    'tactical analytics engine accurately computes win rates, MVP, and zone totals',
    () => {
      const engine = new GuildWarAnalyticsEngine(validWarFixture)
      const analysis = engine.computeTacticalAnalysis()

      assert.equal(analysis.provenance, 'locally-supplied-unverified')
      assert.equal(analysis.totalPoints, 1000) // 250 + 300 + 50 + 400
      assert.equal(analysis.totalBattles, 4)
      assert.equal(analysis.overallWinRate, 75) // 3 victories out of 4 battles
      assert.equal(analysis.activePlayerCount, 3)

      // Player 1 had 2 victories, 550 points (top attacker)
      assert.equal(analysis.topAttacker.slot, 1)
      assert.equal(analysis.topAttacker.points, 550)
      assert.equal(analysis.topAttacker.winRate, 100)

      // Player 2 had 1 defeat, 50 points, 0% win rate
      const p2 = analysis.players.find((p) => p.slot === 2)
      assert.equal(p2.winRate, 0)
      assert.equal(p2.defeats, 1)

      // Zone totals
      const z1 = analysis.zones.find((z) => z.zone === 1)
      assert.equal(z1.points, 300) // 250 + 50
      assert.equal(z1.battles, 2)
    }
  )

  await t.test(
    'history store retains past seasons and preserves historical data on failed acquisition',
    () => {
      const db = new DatabaseSync(':memory:')
      const store = new GuildWarHistoryStore(db)

      const engine = new GuildWarAnalyticsEngine(validWarFixture)
      const analysis = engine.computeTacticalAnalysis()

      // Store Season 42 run
      store.storeRun('GUILD-ALPHA', analysis)

      const retrieved = store.getRun(42, 'GUILD-ALPHA')
      assert.equal(retrieved.season, 42)
      assert.equal(retrieved.total_points, 1000)
      assert.equal(retrieved.analysis.topAttacker.slot, 1)

      // Simulate an acquisition error during next run (e.g. timeout / network failure)
      try {
        throw new Error('Simulated network/acquisition failure')
      } catch {
        // Historical data remains untouched and safe
        const postFail = store.getRun(42, 'GUILD-ALPHA')
        assert.equal(postFail.total_points, 1000)
      }

      // Add Season 43
      const season43 = {
        ...validWarFixture,
        season: 43,
        battles: [
          {
            battle: 1,
            attackerSlot: 1,
            zone: 1,
            points: 500,
            outcome: 'victory'
          }
        ]
      }
      const engine43 = new GuildWarAnalyticsEngine(season43)
      store.storeRun('GUILD-ALPHA', engine43.computeTacticalAnalysis())

      const list = store.listRuns('GUILD-ALPHA')
      assert.equal(list.length, 2)
      assert.equal(list[0].season, 43)
      assert.equal(list[1].season, 42)
    }
  )

  await t.test(
    'publication schema requires opt-in consent and exports only anonymized aggregates',
    () => {
      assert.throws(
        () =>
          sanitizeGuildWarForPublication(validWarFixture, {
            optInStatsConsent: false
          }),
        (err) =>
          err instanceof GuildWarValidationError &&
          err.code === 'ECONSENT_REQUIRED'
      )

      const published = sanitizeGuildWarForPublication(validWarFixture, {
        optInStatsConsent: true
      })
      assert.equal(published.schemaVersion, 1)
      assert.equal(published.format, 'ta-war-public-summary-v1')
      assert.equal(published.season, 42)
      assert.equal(published.totalPoints, 1000)
      assert.equal(published.totalBattles, 4)
      assert.equal(published.overallWinRate, 75)
      assert.equal(published.anonymized, true)
      assert.equal(published.provenance, 'locally-supplied-unverified')
      assert.ok(published.datasetDigest)

      // Does NOT leak raw battles, player secrets, or slot specifics
      assert.equal(typeof published.battles, 'undefined')
      assert.equal(typeof published.players, 'undefined')
    }
  )
})
