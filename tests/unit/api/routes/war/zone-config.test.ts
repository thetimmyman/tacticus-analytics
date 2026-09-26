import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockGetGuildWarSeasonConfigs: ReturnType<typeof vi.fn>

describe('GET /api/war/zone-config', () => {
  let GET: (request: Request) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    mockGetGuildWarSeasonConfigs = vi.fn()

    vi.doMock('@/app/lib/loki/global-config', () => ({
      getGuildWarSeasonConfigs: mockGetGuildWarSeasonConfigs
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))

    const routeModule = await import('@/app/api/war/zone-config/route')
    GET = routeModule.GET
  })

  it('returns 404 when no season configs are available', async () => {
    mockGetGuildWarSeasonConfigs.mockResolvedValue([])

    const response = await GET(
      new Request('http://localhost/api/war/zone-config')
    )
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error.message).toContain('No war season configs availabl')
  })

  it('returns zone layout and clamps battlefield level', async () => {
    mockGetGuildWarSeasonConfigs.mockResolvedValue([
      {
        id: 'season-1',
        maxAttempts: 8,
        defaultZoneTypeLayout: [['Trenches1', 'HQ']],
        zoneTypeConfigs: {
          Trenches1: { visualId: 'trench-1', canBeMoved: true },
          HQ: { visualId: 'hq', buffId: 'buff-1', canBeMoved: false }
        },
        scorePerZoneType: { Trenches1: 10, HQ: 50 },
        levels: [
          {
            battlefieldLevel: 1,
            minGuildPower: 1000,
            minOptedInPlayers: 1,
            zones: []
          },
          {
            battlefieldLevel: 3,
            minGuildPower: 2500,
            minOptedInPlayers: 1,
            zones: []
          }
        ],
        zoneTiers: [],
        raw: {
          levels: [
            { battlefieldLevel: 1, minGuildPower: 1000 },
            { battlefieldLevel: '3', minGuildPower: '2500' }
          ]
        }
      }
    ])

    const response = await GET(
      new Request('http://localhost/api/war/zone-config?bf=9')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.seasonId).toBe('season-1')
    expect(body.maxAttempts).toBe(8)
    expect(body.zones).toHaveLength(2)
    expect(body.battlefieldPowerThresholds[1]).toBe(1000)
    expect(body.battlefieldPowerThresholds[3]).toBe(2500)

    // zoneName comes from the game's shipped localization, never invented.
    const trenches = body.zones.find(
      (zone: { zoneId: string }) => zone.zoneId === 'Trenches1'
    )
    expect(trenches.zoneName).toBe('Left Frontline')
    expect(trenches.baseRarity).toBe('rare')
    expect(trenches.recommendedPower).toBe(350000)

    const hq = body.zones.find(
      (zone: { zoneId: string }) => zone.zoneId === 'HQ'
    )
    expect(hq.zoneName).toBe('Headquarters')
    expect(hq.baseRarity).toBe('legendary')
    expect(hq.difficulty).toBe('command')
    expect(hq.recommendedPower).toBe(750000)
    expect(hq.rarityByBattlefield['5']).toBe('legendary')
  })

  it('uses configured Guild War zone tiers for battlefield rarity and recommendations', async () => {
    const levels = [1, 2, 3, 4, 5].map((battlefieldLevel) => ({
      battlefieldLevel,
      minGuildPower: battlefieldLevel * 1000,
      minOptedInPlayers: 1,
      zones: [
        { warZoneType: 'Trenches1', zoneTierId: 'Trooper' },
        {
          warZoneType: 'Bunker1',
          zoneTierId: battlefieldLevel >= 3 ? 'Elite' : 'Veteran'
        },
        {
          warZoneType: 'HQ',
          zoneTierId: battlefieldLevel >= 3 ? 'Elite' : 'Veteran'
        }
      ]
    }))

    mockGetGuildWarSeasonConfigs.mockResolvedValue([
      {
        id: 'season-v140',
        maxAttempts: 10,
        defaultZoneTypeLayout: [['Trenches1', 'Bunker1', 'HQ']],
        zoneTypeConfigs: {
          Trenches1: { visualId: 'trenches', canBeMoved: false },
          Bunker1: { visualId: 'bunker', canBeMoved: true },
          HQ: { visualId: 'hq', canBeMoved: true }
        },
        scorePerZoneType: { Trenches1: 10, Bunker1: 16, HQ: 40 },
        levels,
        zoneTiers: [
          {
            zoneTierId: 'Trooper',
            npcUnitId: 'templNpc1Initiate:6',
            rarityCaps: ['Rare', 'Rare', 'Uncommon', 'Uncommon', 'Uncommon']
          },
          {
            zoneTierId: 'Veteran',
            npcUnitId: 'templNpc1Initiate:10',
            rarityCaps: ['Epic', 'Epic', 'Rare', 'Rare', 'Rare']
          },
          {
            zoneTierId: 'Elite',
            npcUnitId: 'templNpc1Initiate:13',
            rarityCaps: ['Legendary', 'Legendary', 'Epic', 'Epic', 'Epic']
          }
        ],
        raw: {}
      }
    ])

    const response = await GET(
      new Request('http://localhost/api/war/zone-config?bf=3')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.battlefieldPowerThresholds[3]).toBe(3000)
    expect(body.battlefieldRarityMatrix[3].Bunker1).toBe('epic')
    expect(body.battlefieldRarityMatrix[3].HQ).toBe('epic')

    const bunker = body.zones.find(
      (zone: { zoneId: string }) => zone.zoneId === 'Bunker1'
    )
    expect(bunker.zoneTierId).toBe('Elite')
    expect(bunker.baseRarity).toBe('epic')
    expect(bunker.recommendedPower).toBe(500000)
    expect(bunker.rarityCaps).toEqual([
      'Legendary',
      'Legendary',
      'Epic',
      'Epic',
      'Epic'
    ])
    expect(bunker.zoneTierByBattlefield['3']).toBe('Elite')

    const hq = body.zones.find(
      (zone: { zoneId: string }) => zone.zoneId === 'HQ'
    )
    expect(hq.zoneTierId).toBe('Elite')
    expect(hq.baseRarity).toBe('epic')
    expect(hq.recommendedPower).toBe(500000)
  })

  it('falls back to the canonical visualId (not the lowercased zone id) when GlobalConfig omits one', async () => {
    // getZoneIcon() cases are the game's camelCase ids; each branch of the fallback chain is pinned.
    mockGetGuildWarSeasonConfigs.mockResolvedValue([
      {
        id: 'season-visual',
        maxAttempts: 10,
        defaultZoneTypeLayout: [
          ['ComsStation', 'Trenches1', 'Armoury', 'HQ', 'BrandNewZone9']
        ],
        zoneTypeConfigs: {
          HQ: { visualId: 'hq' }
        },
        scorePerZoneType: {},
        levels: [],
        zoneTiers: [],
        raw: {}
      }
    ])

    const response = await GET(
      new Request('http://localhost/api/war/zone-config')
    )
    const body = await response.json()
    expect(response.status).toBe(200)

    const visualFor = (zoneId: string) =>
      body.zones.find((zone: { zoneId: string }) => zone.zoneId === zoneId)
        ?.visualId

    expect(visualFor('ComsStation')).toBe('radarStation')
    expect(visualFor('Trenches1')).toBe('trenches')
    expect(visualFor('Armoury')).toBe('armory')
    expect(visualFor('HQ')).toBe('hq')
    expect(visualFor('BrandNewZone9')).toBe('brandnewzone9')
  })

  it('returns 500 when config loading throws', async () => {
    mockGetGuildWarSeasonConfigs.mockRejectedValue(new Error('boom'))

    const response = await GET(
      new Request('http://localhost/api/war/zone-config')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to fetch zone configura')
  })
})
