// Community replays are published as visibility 'public' (deliberate).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { ExternalReplayCandidate } from '@/app/lib/guild-ops/replay-external-sources'

function candidate(): ExternalReplayCandidate {
  return {
    sourceSystem: 'terminus-maximus',
    externalVideoId: 'vid-clean',
    videoUrl: 'https://www.youtube.com/watch?v=vid-clean',
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
    // Required by isPublishReadyCandidate; null demotes the fixture to stage-only.
    metaTeamName: 'Laviscus',
    publishedAt: '2026-07-01T00:00:00.000Z',
    parseFlags: { missing: [] }
  }
}

function fakeDb() {
  const publishInserts: Array<Record<string, unknown>> = []
  const db = {
    from(table: string) {
      if (table === 'meta_teams') {
        return { select: () => ({ eq: () => ({ data: [], error: null }) }) }
      }
      if (table === 'boss_playbook_replays') {
        return {
          select: () => ({ eq: () => ({ data: [], error: null }) }),
          insert: (row: Record<string, unknown>) => {
            publishInserts.push(row)
            return {
              select: () => ({
                single: () => ({
                  data: { id: `pub-${publishInserts.length}` },
                  error: null
                })
              })
            }
          }
        }
      }
      return {
        select: () => ({ in: () => ({ data: [], error: null }) }),
        upsert: () => ({ error: null }),
        update: () => {
          const chain = { eq: () => chain, error: null }
          return chain
        }
      }
    }
  }
  return { db, publishInserts }
}

describe('POST /api/cron/terminus-replay-ingest', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let publishInserts: Array<Record<string, unknown>>

  beforeEach(async () => {
    vi.resetModules()
    const fake = fakeDb()
    publishInserts = fake.publishInserts

    vi.doMock('@/app/lib/db', () => ({ serviceDb: () => fake.db }))
    vi.doMock('@/app/lib/scheduler/cron-guard', () => ({
      cronGuard: async () => ({ shouldExecute: true, reason: 'primary' })
    }))
    vi.doMock('@/app/lib/guild-ops/replay-external-ingest', async () => {
      const actual = await vi.importActual<
        typeof import('@/app/lib/guild-ops/replay-external-ingest')
      >('@/app/lib/guild-ops/replay-external-ingest')
      return { ...actual, fetchTerminusCandidates: async () => [candidate()] }
    })

    vi.stubEnv('CRON_SECRET', 'top-secret')
    const mod = await import('@/app/api/cron/terminus-replay-ingest/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const makeRequest = () =>
    new NextRequest('http://localhost/api/cron/terminus-replay-ingest', {
      method: 'POST',
      headers: { authorization: 'Bearer top-secret' }
    })

  it('inserts the published replay with visibility = public (operator ruling 2026-09-04)', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)

    // Positive control: without an insert the visibility check passes vacuously.
    expect(publishInserts).toHaveLength(1)
    expect(publishInserts[0].source_system).toBe('terminus-maximus')
    expect(publishInserts[0].visibility).toBe('public')
  })

  it('never publishes a terminus replay as cluster-scoped', async () => {
    await POST(makeRequest())
    expect(publishInserts).toHaveLength(1)
    expect(
      publishInserts.map((row) => row.visibility).filter((v) => v === 'cluster')
    ).toHaveLength(0)
  })
})
