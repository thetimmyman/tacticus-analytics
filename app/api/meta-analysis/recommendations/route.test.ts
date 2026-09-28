import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { MetaAtlasAuthenticatedRow } from '@/app/lib/meta/meta-atlas-compositions'

// Pins: the access gate runs, one best team per cell by p90, guildFilter degrades to global.

const { dbMock, requireSessionUserMock, resolveScopeMock, fetchRowsMock } =
  vi.hoisted(() => ({
    dbMock: vi.fn(),
    requireSessionUserMock: vi.fn(),
    resolveScopeMock: vi.fn(),
    fetchRowsMock: vi.fn()
  }))

vi.mock('@/app/lib/db', () => ({ db: dbMock }))
vi.mock('@/app/lib/api/session-user', () => ({
  requireSessionUser: requireSessionUserMock
}))
vi.mock('@/app/api/meta-analysis/_scope', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/api/meta-analysis/_scope')
  >('@/app/api/meta-analysis/_scope')
  return {
    ...actual,
    resolveMetaAnalysisAccessScope: resolveScopeMock
  }
})
vi.mock('@/app/lib/meta/meta-atlas-compositions', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/lib/meta/meta-atlas-compositions')
  >('@/app/lib/meta/meta-atlas-compositions')
  return {
    ...actual,
    fetchMetaAtlasSeasonRows: fetchRowsMock
  }
})

const row = (
  overrides: Partial<MetaAtlasAuthenticatedRow>
): MetaAtlasAuthenticatedRow => ({
  team_hash: 'hash',
  team_composition: 'Actus, Vitruvius + Biovore',
  meta_team: 'Admech',
  boss_type: 'SilentKing',
  boss_unit_id: null,
  sub_boss_name: 'Szarekh',
  encounter_index: 0,
  encounter_type: 'Boss',
  rarity: 'Legendary',
  set_num: 0,
  rarity_set: 'L1',
  season: '83',
  attack_count: 20,
  damage_max: 500,
  damage_p90: 400,
  damage_p75: 350,
  damage_avg: 300,
  damage_stddev: 50,
  coef_variation: 16.7,
  damage_min: null,
  distinct_players: null,
  distinct_guilds: null,
  ...overrides
})

const request = (query: string) =>
  new NextRequest(`http://localhost/api/meta-analysis/recommendations${query}`)

describe('GET /api/meta-analysis/recommendations (rebuild)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.mockResolvedValue({})
    requireSessionUserMock.mockResolvedValue({ id: 'user-1' })
    resolveScopeMock.mockResolvedValue({
      ownGuildCode: 'G1',
      clusterCode: null,
      requestedGuildCode: null,
      primaryClusterCode: null,
      primaryGuildCode: 'G1'
    })
    fetchRowsMock.mockResolvedValue([])
  })

  it('requires the season parameter', async () => {
    const { GET } = await import('./route')
    const response = await GET(request(''))
    expect(response.status).toBe(400)
  })

  it('picks the strongest team per (rarity, set, encounter) cell', async () => {
    fetchRowsMock.mockResolvedValue([
      row({ team_hash: 'weak', damage_p90: 100 }),
      row({ team_hash: 'strong', damage_p90: 900 }),
      row({ team_hash: 'prime', encounter_index: 1, damage_p90: 50 }),
      row({ team_hash: 'mythic', rarity: 'Mythic', set_num: 2 }),
      row({ team_hash: 'rare', rarity: 'Rare' })
    ])

    const { GET } = await import('./route')
    const response = await GET(request('?season=83&rarity=Legendary,Mythic'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-meta-scope')).toBe('global')
    expect(response.headers.get('x-meta-guild-filter-ignored')).toBeNull()

    const body = await response.json()
    // A bare array could not say what it was aggregated over.
    expect(body).toMatchObject({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false
    })
    const teams = body.data
    expect(teams).toHaveLength(3)

    const keys = teams.map(
      (t: { composition: { compositionKey: string } }) =>
        t.composition.compositionKey
    )
    expect(keys).toContain('strong')
    expect(keys).not.toContain('weak')
    expect(keys).toContain('prime')
    expect(keys).toContain('mythic')

    const strong = teams.find(
      (t: { composition: { compositionKey: string } }) =>
        t.composition.compositionKey === 'strong'
    )
    expect(strong.levelString).toBe('L1')
    expect(strong.bossName).toBe('Szarekh')
    expect(strong.rank).toBe(1)
    expect(strong.composition.battlesCount).toBe(20)
    expect(strong.composition.heroNames).toEqual(['Actus', 'Vitruvius'])
    expect(strong.composition.minDamage).toBe(300)
    expect(strong.composition.standardDeviation).toBe(0)
  })

  it('flags an ignored guild filter while still validating scope', async () => {
    fetchRowsMock.mockResolvedValue([row({})])
    const { GET } = await import('./route')
    const response = await GET(request('?season=83&guildFilter=G2'))

    expect(resolveScopeMock).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      'G2'
    )
    expect(response.headers.get('x-meta-scope')).toBe('global')
    expect(response.headers.get('x-meta-guild-filter-ignored')).toBe('true')
    await expect(response.json()).resolves.toMatchObject({
      scope: 'global',
      requestedGuildFilter: 'G2',
      guildFilterIgnored: true
    })
  })

  it('propagates a scope denial as 403', async () => {
    const { Errors } = await import('@/app/lib/errors/AppError')
    resolveScopeMock.mockRejectedValue(
      Errors.forbidden('Active guild membership required')
    )
    const { GET } = await import('./route')
    const response = await GET(request('?season=83'))
    expect(response.status).toBe(403)
    expect(fetchRowsMock).not.toHaveBeenCalled()
  })

  it('degrades to an empty list when the aggregate RPC fails', async () => {
    fetchRowsMock.mockRejectedValue(new Error('boom'))
    const { GET } = await import('./route')
    const response = await GET(request('?season=83'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-meta-source')).toBe('fallback-error')
    await expect(response.json()).resolves.toEqual({
      scope: 'global',
      requestedGuildFilter: null,
      guildFilterIgnored: false,
      data: []
    })
  })
})
