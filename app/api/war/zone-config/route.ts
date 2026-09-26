import { NextResponse } from 'next/server'
import { getGuildWarSeasonConfigs } from '@/app/lib/loki/global-config'
import type {
  LokiGuildWarLevel,
  LokiGuildWarSeasonConfig,
  LokiGuildWarZoneTier
} from '@/app/lib/loki/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.war.zone-config')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { zoneDisplayName, zoneVisualId } from '@/app/lib/war/war-naming'

export type ZoneRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface WarZoneConfig {
  zoneId: string
  zoneName: string
  visualId: string
  row: number
  column: number
  score: number
  canBeMoved: boolean
  buffId?: string
  difficulty: 'frontline' | 'support' | 'strategic' | 'command'
  baseRarity: ZoneRarity
  rarityByBattlefield: Record<number, ZoneRarity>
  zoneTierId?: string
  zoneTierByBattlefield?: Record<number, string>
  rarityCaps?: string[]
  recommendedPower: number
}

export type BattlefieldPowerThresholds = Record<number, number>

export interface WarZoneLayout {
  seasonId: string
  maxAttempts: number
  zones: WarZoneConfig[]
  layout: string[][]
  battlefieldRarityMatrix: Record<number, Record<string, ZoneRarity>>
  battlefieldPowerThresholds?: BattlefieldPowerThresholds
}

const LEGACY_ZONE_GROUP: Record<string, 'front' | 'mid' | 'back' | 'command'> =
  {
    Trenches1: 'front',
    Trenches2: 'front',
    Trenches3: 'front',
    Garrison1: 'mid',
    Garrison2: 'mid',
    Bunker1: 'mid',
    Bunker2: 'mid',
    ArtilleryPosition1: 'back',
    ArtilleryPosition2: 'back',
    AntiAirBattery: 'back',
    AntiAirBattery1: 'back',
    AntiAirBattery2: 'back',
    MedicaeStation1: 'back',
    MedicaeStation2: 'back',
    Armoury: 'back',
    ComsStation: 'back',
    SupplyDepot: 'command',
    HQ: 'command',
    LandingPad: 'command',
    LandingPad1: 'command',
    LandingPad2: 'command'
  }

const BATTLEFIELD_RARITY_MATRIX: Record<
  number,
  Record<'front' | 'mid' | 'back' | 'command', ZoneRarity>
> = {
  1: { front: 'common', mid: 'common', back: 'uncommon', command: 'uncommon' },
  2: { front: 'common', mid: 'uncommon', back: 'uncommon', command: 'rare' },
  3: { front: 'uncommon', mid: 'uncommon', back: 'rare', command: 'rare' },
  4: { front: 'uncommon', mid: 'rare', back: 'rare', command: 'epic' },
  5: { front: 'rare', mid: 'rare', back: 'epic', command: 'legendary' }
}

const RARITY_TO_DIFFICULTY: Record<ZoneRarity, WarZoneConfig['difficulty']> = {
  common: 'frontline',
  uncommon: 'support',
  rare: 'strategic',
  epic: 'strategic',
  legendary: 'command'
}

const RARITY_POWER_BASE: Record<ZoneRarity, number> = {
  common: 100000,
  uncommon: 200000,
  rare: 350000,
  epic: 500000,
  legendary: 750000
}

const RARITY_ORDER: Record<ZoneRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4
}

const DEFAULT_ZONE_TIER_RARITY: Record<string, ZoneRarity> = {
  Trooper: 'uncommon',
  Veteran: 'rare',
  Elite: 'epic',
  Hero: 'legendary'
}

interface ConfiguredZoneTier {
  zoneTierId: string
  rarity: ZoneRarity
  rarityCaps: string[]
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

const normalizeGameRarity = (value: string): ZoneRarity | null => {
  switch (value.toLowerCase()) {
    case 'common':
      return 'common'
    case 'uncommon':
      return 'uncommon'
    case 'rare':
      return 'rare'
    case 'epic':
      return 'epic'
    case 'legendary':
    case 'mythic':
      return 'legendary'
    default:
      return null
  }
}

const deriveZoneTierRarity = (tier: LokiGuildWarZoneTier): ZoneRarity => {
  const normalizedCaps = tier.rarityCaps
    .map(normalizeGameRarity)
    .filter((rarity): rarity is ZoneRarity => rarity !== null)

  if (normalizedCaps.length > 0) {
    return normalizedCaps.reduce((lowest, rarity) =>
      RARITY_ORDER[rarity] < RARITY_ORDER[lowest] ? rarity : lowest
    )
  }

  return DEFAULT_ZONE_TIER_RARITY[tier.zoneTierId] ?? 'common'
}

const buildConfiguredZoneMatrix = (
  season: LokiGuildWarSeasonConfig
): Record<number, Record<string, ConfiguredZoneTier>> => {
  const tierLookup = new Map(
    season.zoneTiers.map((tier) => [
      tier.zoneTierId,
      {
        rarity: deriveZoneTierRarity(tier),
        rarityCaps: tier.rarityCaps
      }
    ])
  )

  return season.levels.reduce<
    Record<number, Record<string, ConfiguredZoneTier>>
  >((matrix, level: LokiGuildWarLevel) => {
    if (level.battlefieldLevel < 1 || level.battlefieldLevel > 5) {
      return matrix
    }

    const battlefieldEntry = matrix[level.battlefieldLevel] ?? {}
    level.zones.forEach((zone) => {
      const tier = tierLookup.get(zone.zoneTierId)
      battlefieldEntry[zone.warZoneType] = {
        zoneTierId: zone.zoneTierId,
        rarity:
          tier?.rarity ?? DEFAULT_ZONE_TIER_RARITY[zone.zoneTierId] ?? 'common',
        rarityCaps: tier?.rarityCaps ?? []
      }
    })
    matrix[level.battlefieldLevel] = battlefieldEntry
    return matrix
  }, {})
}

const extractBattlefieldPowerThresholds = (
  season: LokiGuildWarSeasonConfig
): BattlefieldPowerThresholds | null => {
  const thresholds: BattlefieldPowerThresholds = {}
  season.levels.forEach((level) => {
    const battlefieldLevel = toNumberOrNull(level.battlefieldLevel)
    const minGuildPower = toNumberOrNull(level.minGuildPower)
    if (battlefieldLevel !== null && minGuildPower !== null) {
      thresholds[battlefieldLevel] = minGuildPower
    }
  })

  return Object.keys(thresholds).length > 0 ? thresholds : null
}

export const GET = withErrorHandler(async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url)
    const battlefieldLevel = parseInt(searchParams.get('bf') || '3', 10)
    const validBf = Math.max(1, Math.min(5, battlefieldLevel)) as
      1 | 2 | 3 | 4 | 5

    const seasonConfigs = await getGuildWarSeasonConfigs()

    if (!seasonConfigs || seasonConfigs.length === 0) {
      throw Errors.fromResponse(404, {
        error: 'No war season configs available'
      })
    }

    const currentSeason = seasonConfigs[0]
    if (!currentSeason) {
      throw Errors.fromResponse(404, {
        error: 'No war season configs available'
      })
    }
    const battlefieldPowerThresholds =
      extractBattlefieldPowerThresholds(currentSeason)
    const configuredZoneMatrix = buildConfiguredZoneMatrix(currentSeason)

    const zones: WarZoneConfig[] = []
    const layout = currentSeason.defaultZoneTypeLayout ?? []

    const battlefieldRarityMatrix: Record<
      number,
      Record<string, ZoneRarity>
    > = {}
    for (let bf = 1; bf <= 5; bf++) {
      battlefieldRarityMatrix[bf] = {}
    }

    layout.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) return
      row.forEach((zoneId, colIndex) => {
        if (!zoneId) return
        const zoneConfig = currentSeason.zoneTypeConfigs?.[zoneId] || {}
        const score = currentSeason.scorePerZoneType?.[zoneId] || 0
        const legacyZoneGroup = LEGACY_ZONE_GROUP[zoneId] || 'mid'

        const rarityByBattlefield: Record<number, ZoneRarity> = {}
        const zoneTierByBattlefield: Record<number, string> = {}
        for (let bf = 1; bf <= 5; bf++) {
          const matrix =
            BATTLEFIELD_RARITY_MATRIX[bf] ??
            BATTLEFIELD_RARITY_MATRIX[validBf] ??
            BATTLEFIELD_RARITY_MATRIX[3]
          const configuredZone = configuredZoneMatrix[bf]?.[zoneId]
          const rarity =
            configuredZone?.rarity ?? matrix?.[legacyZoneGroup] ?? 'common'
          rarityByBattlefield[bf] = rarity
          if (configuredZone?.zoneTierId) {
            zoneTierByBattlefield[bf] = configuredZone.zoneTierId
          }
          const battlefieldEntry =
            battlefieldRarityMatrix[bf] ?? (battlefieldRarityMatrix[bf] = {})
          battlefieldEntry[zoneId] = rarity
        }

        const currentRarity = rarityByBattlefield[validBf] ?? 'common'
        const difficulty = RARITY_TO_DIFFICULTY[currentRarity]
        const recommendedPower = RARITY_POWER_BASE[currentRarity]
        const configuredZone = configuredZoneMatrix[validBf]?.[zoneId]

        zones.push({
          zoneId,
          zoneName: zoneDisplayName(zoneId),
          // getZoneIcon() needs the game's camelCase visual id (Trenches1), which zoneId rarely
          // matches; lowercased zoneId is the fallback for zones the table lacks.
          visualId:
            (zoneConfig.visualId as string) ||
            zoneVisualId(zoneId) ||
            zoneId.toLowerCase(),
          row: rowIndex,
          column: colIndex,
          score,
          canBeMoved: (zoneConfig.canBeMoved as boolean) || false,
          buffId: zoneConfig.buffId as string | undefined,
          difficulty,
          baseRarity: currentRarity,
          rarityByBattlefield,
          zoneTierId: configuredZone?.zoneTierId,
          zoneTierByBattlefield:
            Object.keys(zoneTierByBattlefield).length > 0
              ? zoneTierByBattlefield
              : undefined,
          rarityCaps: configuredZone?.rarityCaps,
          recommendedPower
        })
      })
    })

    const result: WarZoneLayout = {
      seasonId: currentSeason.id,
      maxAttempts: currentSeason.maxAttempts || 10,
      zones,
      layout,
      battlefieldRarityMatrix,
      battlefieldPowerThresholds: battlefieldPowerThresholds || undefined
    }

    return NextResponse.json(result)
  } catch (error) {
    rethrowIfAppError(error)
    const msg = error instanceof Error ? error.message : 'unknown_error'
    logger.error({ error: msg }, 'Error fetching zone config')
    throw Errors.fromResponse(500, {
      error: `Failed to fetch zone configuration: ${msg}`
    })
  }
})
