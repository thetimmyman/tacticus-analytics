// Pins idempotency (the daily cron re-ingests the library) and the publish-clean split.
import { describe, expect, it, vi } from 'vitest'
import {
  ingestExternalReplays,
  type ExternalIngestOptions
} from '@/app/lib/guild-ops/replay-external-ingest'
import type { ExternalReplayCandidate } from '@/app/lib/guild-ops/replay-external-sources'

function candidate(
  overrides: Partial<ExternalReplayCandidate> = {}
): ExternalReplayCandidate {
  // Publish writes videoUrl but dedupe keys on externalVideoId, so the two must agree.
  const externalVideoId = overrides.externalVideoId ?? 'vid-clean'
  return {
    sourceSystem: 'terminus-maximus',
    externalVideoId,
    videoUrl: `https://www.youtube.com/watch?v=${externalVideoId}`,
    title: 'Szarekh M2 2.94M',
    bossId: 'silent-king',
    boardId: 'Szarekh_03',
    mapNumber: '3',
    encounterRole: 'boss',
    season: '100',
    tier: 'M2',
    damage: 2940000,
    units: ['Laviscus', 'Kariel'],
    creator: 'Mawg',
    // A null here demotes the fixture to stage-only and makes publish asserts vacuous.
    metaTeamName: 'Laviscus',
    publishedAt: '2026-07-01T00:00:00.000Z',
    parseFlags: { missing: [] },
    ...overrides
  }
}

function fakeDb(options?: {
  queueRows?: Array<{
    id: string
    external_video_id: string
    review_status: string
    published_replay_id: string | null
    boss_id?: string | null
    board_id?: string | null
  }>
  publishedRows?: Array<{ id: string; video_url: string }>
}) {
  const writes = {
    queueUpserts: [] as unknown[],
    queueUpdates: [] as unknown[],
    publishInserts: [] as unknown[]
  }

  const db = {
    from(table: string) {
      if (table === 'meta_teams') {
        return {
          select: () => ({ eq: () => ({ data: [], error: null }) })
        }
      }
      if (table === 'boss_playbook_replays') {
        return {
          select: () => ({
            eq: () => ({ data: options?.publishedRows ?? [], error: null })
          }),
          insert: (row: unknown) => {
            writes.publishInserts.push(row)
            return {
              select: () => ({
                single: () => ({
                  data: { id: `pub-${writes.publishInserts.length}` },
                  error: null
                })
              })
            }
          }
        }
      }
      return {
        select: () => ({
          in: () => ({ data: options?.queueRows ?? [], error: null })
        }),
        upsert: (rows: unknown) => {
          writes.queueUpserts.push(rows)
          return { error: null }
        },
        update: (patch: unknown) => {
          writes.queueUpdates.push(patch)
          const chain = { eq: () => chain, error: null }
          return chain
        }
      }
    }
  }

  return { db, writes }
}

const OPTIONS: ExternalIngestOptions = {
  apply: true,
  publishClean: true,
  visibility: 'public'
}

describe('ingestExternalReplays', () => {
  it('publishes a parse-flagged candidate, and stages only what it cannot publish', async () => {
    // A parse flag is provenance; only rows the table would reject (boss_id NOT NULL) are held back.
    const { db, writes } = fakeDb()
    const summary = await ingestExternalReplays(
      db as never,
      [
        candidate({ externalVideoId: 'clean-1' }),
        candidate({
          externalVideoId: 'flagged-1',
          parseFlags: { missing: ['hero:Unknown'] }
        }),
        candidate({ externalVideoId: 'no-boss-1', bossId: null })
      ],
      OPTIONS
    )

    expect(summary.publishable).toBe(2)
    expect(summary.stageOnly).toBe(1)
    expect(summary.published).toBe(2)
    const urls = writes.publishInserts.map(
      (r) => (r as { video_url: string }).video_url
    )
    expect(urls.some((u) => u.includes('clean-1'))).toBe(true)
    expect(urls.some((u) => u.includes('flagged-1'))).toBe(true)
    expect(urls.some((u) => u.includes('no-boss-1'))).toBe(false)
  })

  it('is idempotent — an already-queued library re-ingests as a no-op', async () => {
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'clean-1',
          review_status: 'approved',
          published_replay_id: 'pub-1'
        }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      OPTIONS
    )

    expect(summary.newCandidates).toBe(0)
    expect(summary.published).toBe(0)
    expect(summary.staged).toBe(0)
    expect(writes.publishInserts).toHaveLength(0)
  })

  it('skips a candidate already published outside the queue', async () => {
    // Manually added YouTube replays match by extracted video id, not URL string.
    const { db, writes } = fakeDb({
      publishedRows: [
        { id: 'pub-existing', video_url: 'https://youtu.be/clean-1' }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      OPTIONS
    )

    expect(summary.newCandidates).toBe(0)
    expect(writes.publishInserts).toHaveLength(0)
  })

  it('promotes a previously-staged row that now clears the gate', async () => {
    // Rows staged under an older gate are released only by the promote pass.
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'clean-1',
          review_status: 'needs_review',
          published_replay_id: null
        }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      OPTIONS
    )

    expect(summary.newCandidates).toBe(0)
    expect(summary.promotable).toBe(1)
    expect(summary.promoted).toBe(1)
    expect(summary.published).toBe(0)
    expect(writes.publishInserts).toHaveLength(1)
    expect(writes.queueUpdates[0]).toMatchObject({ review_status: 'approved' })
  })

  it('does NOT promote a staged row that still fails the gate', async () => {
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'no-boss',
          review_status: 'needs_review',
          published_replay_id: null
        }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'no-boss', bossId: null })],
      OPTIONS
    )

    expect(summary.promotable).toBe(0)
    expect(summary.promoted).toBe(0)
    expect(writes.publishInserts).toHaveLength(0)
  })

  it('promotes using the boss the row resolved to when it was STAGED', async () => {
    // An old season's boss may now normalize to null; the stored bossId still releases the row.
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'aged-out',
          review_status: 'needs_review',
          published_replay_id: null,
          boss_id: 'tervigon-gorgon',
          board_id: 'Tervigon_04'
        }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'aged-out', bossId: null, boardId: null })],
      OPTIONS
    )

    expect(summary.promoted).toBe(1)
    expect(writes.publishInserts[0]).toMatchObject({
      boss_id: 'tervigon-gorgon',
      map_id: 'Tervigon_04'
    })
  })

  it('never lets a stored boss override a fresh resolution', async () => {
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'clean-1',
          review_status: 'needs_review',
          published_replay_id: null,
          boss_id: 'STALE-VALUE',
          board_id: 'STALE_BOARD'
        }
      ]
    })
    await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      OPTIONS
    )
    expect(writes.publishInserts[0]).toMatchObject({ boss_id: 'silent-king' })
  })

  it('still cannot promote when NEITHER fresh nor stored has a boss', async () => {
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'no-boss',
          review_status: 'needs_review',
          published_replay_id: null,
          boss_id: null,
          board_id: null
        }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'no-boss', bossId: null })],
      OPTIONS
    )
    expect(summary.promoted).toBe(0)
    expect(writes.publishInserts).toHaveLength(0)
  })

  it('does not double-count a promoted row as repaired', async () => {
    // Already live elsewhere is `repairable`, not `promotable`: conflating them inserts a duplicate.
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'clean-1',
          review_status: 'needs_review',
          published_replay_id: null
        }
      ],
      publishedRows: [
        { id: 'pub-existing', video_url: 'https://youtu.be/clean-1' }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      OPTIONS
    )

    expect(summary.repairable).toBe(1)
    expect(summary.promotable).toBe(0)
    expect(writes.publishInserts).toHaveLength(0)
  })

  it('repairs a queue row orphaned by a half-finished publish', async () => {
    // A run that died between publish and queue mark leaves the video live but the row in review.
    const { db, writes } = fakeDb({
      queueRows: [
        {
          id: 'q1',
          external_video_id: 'clean-1',
          review_status: 'needs_review',
          published_replay_id: null
        }
      ],
      publishedRows: [
        { id: 'pub-existing', video_url: 'https://youtu.be/clean-1' }
      ]
    })
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      OPTIONS
    )

    expect(summary.repairable).toBe(1)
    expect(summary.repaired).toBe(1)
    expect(writes.queueUpdates).toHaveLength(1)
    expect(writes.queueUpdates[0]).toMatchObject({
      review_status: 'approved',
      published_replay_id: 'pub-existing'
    })
  })

  it('dry-run reports the split without writing', async () => {
    const { db, writes } = fakeDb()
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      { ...OPTIONS, apply: false }
    )

    expect(summary.applied).toBe(false)
    expect(summary.publishable).toBe(1)
    expect(summary.published).toBe(0)
    expect(writes.publishInserts).toHaveLength(0)
    expect(writes.queueUpserts).toHaveLength(0)
  })

  it('publishes nothing when publishClean is off', async () => {
    const { db, writes } = fakeDb()
    const summary = await ingestExternalReplays(
      db as never,
      [candidate({ externalVideoId: 'clean-1' })],
      { ...OPTIONS, publishClean: false }
    )

    expect(summary.publishable).toBe(0)
    expect(summary.stageOnly).toBe(1)
    expect(writes.publishInserts).toHaveLength(0)
    expect(writes.queueUpserts).toHaveLength(1)
  })
})

describe('fetchTerminusCandidates', () => {
  it('surfaces an upstream non-200 rather than returning an empty library', async () => {
    // A silent empty return is how a dead scraper looks healthy.
    const { fetchTerminusCandidates } =
      await import('@/app/lib/guild-ops/replay-external-ingest')
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 503 }))

    await expect(fetchTerminusCandidates()).rejects.toThrow('HTTP 503')
    spy.mockRestore()
  })
})
