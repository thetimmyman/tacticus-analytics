import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  GlobalMetadataAggregator,
  AggregationError,
  MINIMUM_COHORT_THRESHOLD
} from '../launcher/global-metadata-aggregator.mjs'

test('Global Metadata Aggregator: Purpose Boundaries, Deduplication, Privacy & Deletion Lineage', async (t) => {
  function setupAggregator() {
    const db = new DatabaseSync(':memory:')
    const aggregator = new GlobalMetadataAggregator(db)
    return { db, aggregator }
  }

  await t.test(
    'strictly enforces purpose boundary: refuses portal records from global metadata',
    () => {
      const { aggregator } = setupAggregator()

      assert.throws(
        () =>
          aggregator.recordContribution({
            purpose: 'portal', // Illegal purpose for global meta!
            dataset: 'raid',
            guildId: 'GUILD-A',
            accountRef: 'user-1',
            fingerprint: 'fp-1',
            bossId: 'Ghazghkull',
            tier: 5,
            damage: 150000
          }),
        (err) =>
          err instanceof AggregationError &&
          err.code === 'EINVALID_PURPOSE_BOUNDARY'
      )
    }
  )

  await t.test(
    'deduplicates duplicate events and excludes quarantined records from aggregates',
    () => {
      const { aggregator } = setupAggregator()

      // 5 unique records to meet threshold
      for (let i = 1; i <= 5; i++) {
        aggregator.recordContribution({
          purpose: 'meta',
          dataset: 'raid',
          guildId: 'GUILD-A',
          accountRef: `user-${i}`,
          fingerprint: `fp-${i}`,
          bossId: 'Avatar',
          tier: 4,
          damage: 100000
        })
      }

      // A duplicate submission of fp-1 by a second collector
      aggregator.recordContribution({
        purpose: 'meta',
        dataset: 'raid',
        guildId: 'GUILD-B',
        accountRef: 'user-collector-2',
        fingerprint: 'fp-1', // Same fingerprint
        bossId: 'Avatar',
        tier: 4,
        damage: 100000
      })

      // A quarantined poisoned record
      aggregator.recordContribution({
        purpose: 'meta',
        dataset: 'raid',
        guildId: 'GUILD-A',
        accountRef: 'user-bad',
        fingerprint: 'fp-poison',
        bossId: 'Avatar',
        tier: 4,
        damage: 9999999,
        isQuarantined: true
      })

      aggregator.recomputeAggregates()

      const cohort = aggregator.getPublicCohortMeta('Avatar', 4)
      assert.equal(cohort.published, true)
      // Exactly 5 unique records, not 6 or 7
      assert.equal(cohort.sampleCount, 5)
      assert.equal(cohort.avgDamage, 100000)
    }
  )

  await t.test(
    'suppresses cohorts below minimum privacy threshold (<5 samples)',
    () => {
      const { aggregator } = setupAggregator()

      // Only 3 samples for Mortarion tier 5
      for (let i = 1; i <= 3; i++) {
        aggregator.recordContribution({
          purpose: 'meta',
          dataset: 'raid',
          guildId: 'GUILD-A',
          accountRef: `user-${i}`,
          fingerprint: `fp-mort-${i}`,
          bossId: 'Mortarion',
          tier: 5,
          damage: 120000
        })
      }

      aggregator.recomputeAggregates()

      // Cohort is suppressed
      const cohort = aggregator.getPublicCohortMeta('Mortarion', 5)
      assert.equal(cohort.published, false)
      assert.equal(cohort.reason, 'insufficient-sample-size-or-no-data')
    }
  )

  await t.test(
    'executes deletion lineage, purges source records, and updates aggregates immediately',
    () => {
      const { aggregator, db } = setupAggregator()

      // Add 6 samples: 2 from user-del, 4 from others
      aggregator.recordContribution({
        purpose: 'meta',
        dataset: 'raid',
        guildId: 'GUILD-A',
        accountRef: 'user-del',
        fingerprint: 'fp-d1',
        bossId: 'Swarmlord',
        tier: 3,
        damage: 200000
      })
      aggregator.recordContribution({
        purpose: 'meta',
        dataset: 'raid',
        guildId: 'GUILD-A',
        accountRef: 'user-del',
        fingerprint: 'fp-d2',
        bossId: 'Swarmlord',
        tier: 3,
        damage: 200000
      })

      for (let i = 1; i <= 4; i++) {
        aggregator.recordContribution({
          purpose: 'meta',
          dataset: 'raid',
          guildId: 'GUILD-A',
          accountRef: `user-keep-${i}`,
          fingerprint: `fp-k${i}`,
          bossId: 'Swarmlord',
          tier: 3,
          damage: 100000
        })
      }

      aggregator.recomputeAggregates()
      assert.equal(
        aggregator.getPublicCohortMeta('Swarmlord', 3).sampleCount,
        6
      )

      // Execute deletion for user-del
      const delResult = aggregator.executeDeletionRequest('user-del', 'GUILD-A')
      assert.equal(delResult.recordsDeleted, 2)
      assert.ok(delResult.lineageId)

      // Lineage audit was recorded
      const lineageRow = db
        .prepare(
          'SELECT records_deleted FROM global_deletion_lineage WHERE lineage_id = ?'
        )
        .get(delResult.lineageId)
      assert.equal(lineageRow.records_deleted, 2)

      // Aggregate now drops to 4 samples, which is < MINIMUM_COHORT_THRESHOLD (5), so it becomes suppressed!
      const postDelCohort = aggregator.getPublicCohortMeta('Swarmlord', 3)
      assert.equal(postDelCohort.published, false)
    }
  )
})
