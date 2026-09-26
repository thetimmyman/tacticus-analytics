import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'

// Pins per-player row scoping: full roster for officers, at most the caller's own row otherwise.

const { requireAccess, computeDetail, latestSeason } = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  computeDetail: vi.fn(),
  latestSeason: vi.fn()
}))

vi.mock('@/app/api/members/token-usage/access', () => ({
  requireTokenUsageGuildAccess: requireAccess
}))
vi.mock('@/app/lib/season-forecast/season-outlook-projection', () => ({
  computeSeasonOutlookDetailWithTimeout: computeDetail
}))
vi.mock('@/app/lib/utils/season', () => ({
  getLatestSeason: latestSeason
}))

const row = (playerId: string, displayName: string): PlayerTokenPaceRow => ({
  playerId,
  displayName,
  tokensUsed: 6,
  tokensRemaining: 18,
  projectedWaste: 3,
  atCapRisk: true
})

const ROSTER = [row('p1', 'Alpha'), row('p2', 'Beta'), row('p3', 'Gamma')]

const PROJECTION = {
  guildCode: 'EOT',
  season: 30,
  tokensUsed: 100,
  tokensRemaining: 400,
  projectedWaste: 20,
  playersAtCapRisk: 3
}

const request = () =>
  new NextRequest(
    'http://localhost/api/season-forecast/outlook?guildCode=EOT&season=30'
  )

const accessResult = (profile: {
  player_id: string | null
  role: string | null
  guild_code?: string
  cluster_code?: string | null
}) => ({
  guild: 'EOT',
  clusterCode: profile.cluster_code ?? null,
  guildConfig: {},
  supabase: {},
  profile: { guild_code: 'EOT', cluster_code: null, ...profile }
})

describe('GET /api/season-forecast/outlook (WI-4510 player scoping)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestSeason.mockResolvedValue('30')
    computeDetail.mockResolvedValue({
      projection: PROJECTION,
      players: ROSTER
    })
  })

  it('returns the FULL roster to an officer-level caller', async () => {
    requireAccess.mockResolvedValue(
      accessResult({ player_id: 'p1', role: 'officer' })
    )
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.projection).toEqual(PROJECTION)
    expect(body.players).toHaveLength(3)
    expect(body.players.map((p: PlayerTokenPaceRow) => p.playerId)).toEqual([
      'p1',
      'p2',
      'p3'
    ])
  })

  it('returns the FULL roster to a same-cluster officer of a SIBLING guild', async () => {
    // Must not depend on their own player_id, which belongs to their home guild.
    requireAccess.mockResolvedValue(
      accessResult({
        player_id: 'their-own-mapping',
        role: 'officer',
        guild_code: 'SIBLING',
        cluster_code: 'CLUSTER-1'
      })
    )
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.players).toHaveLength(3)
    expect(body.players.map((p: PlayerTokenPaceRow) => p.playerId)).toEqual([
      'p1',
      'p2',
      'p3'
    ])
  })

  it("returns ONLY the caller's own row to a plain member", async () => {
    requireAccess.mockResolvedValue(
      accessResult({ player_id: 'p2', role: 'member' })
    )
    const { GET } = await import('./route')
    const response = await GET(request())

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.projection).toEqual(PROJECTION)
    expect(body.players).toEqual([row('p2', 'Beta')])
  })

  it('returns NO rows to an unmapped member (null player_id)', async () => {
    requireAccess.mockResolvedValue(
      accessResult({ player_id: null, role: 'member' })
    )
    const { GET } = await import('./route')
    const response = await GET(request())

    const body = await response.json()
    expect(body.players).toEqual([])
  })

  it('returns null projection and players on a sim miss, so callers fall back', async () => {
    requireAccess.mockResolvedValue(
      accessResult({ player_id: 'p1', role: 'officer' })
    )
    computeDetail.mockResolvedValue(null)
    const { GET } = await import('./route')
    const response = await GET(request())

    const body = await response.json()
    expect(body).toEqual({ projection: null, players: null })
  })

  it('short-circuits past seasons before the sim, with null players', async () => {
    requireAccess.mockResolvedValue(
      accessResult({ player_id: 'p1', role: 'officer' })
    )
    latestSeason.mockResolvedValue('31')
    const { GET } = await import('./route')
    const response = await GET(request())

    const body = await response.json()
    expect(body).toEqual({ projection: null, players: null })
    expect(computeDetail).not.toHaveBeenCalled()
  })
})
