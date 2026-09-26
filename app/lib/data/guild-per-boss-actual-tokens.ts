import { db } from '@/app/lib/db'
import { buildBattleRowsQuery } from '@/app/lib/data/battle-rows'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { lookupPrimeBossHp } from '@/app/lib/data/prime-boss-hp'
import {
  getSeasonConfigById,
  getSeasonConfigForSeasonNumber,
  ROTATION_INDEX_OFFSET,
  SEASON_NUMBER_OFFSET,
  SEASON_ROTATION
} from '@/app/lib/loki/season-configs'
import { createComponentLogger } from '@/app/lib/logging'
import type { Database } from '@tacticus/app-core/types'

const logger = createComponentLogger('lib.data.guild-per-boss-actual-tokens')

type DamageRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'Name'
  | 'set'
  | 'encounterId'
  | 'damageDealt'
  | 'remainingHp'
  | 'maxHp'
  | 'Season'
  | 'rarity'
>

interface PerBossActual {
  bossKey: string
  season: string
  tokensToKill: number
  sampleCount: number
}

export type PerBossActualsByKey = Record<string, Omit<PerBossActual, 'bossKey'>>

function classifyKill(row: {
  damageDealt: number
  remainingHp: number
  maxHp: number | null
}): 'non_kill' | 'one_shot' | 'sweep' {
  if (row.remainingHp > 0) return 'non_kill'
  if (row.maxHp !== null && row.maxHp > 0 && row.damageDealt < row.maxHp) {
    return 'sweep'
  }
  return 'one_shot'
}

/** Primes resolve their main through the rotation (targets key on the main). Sweep kills are excluded. */
export async function getGuildPerBossActualTokens(
  guildCode: string
): Promise<PerBossActualsByKey> {
  if (!guildCode) return {}

  try {
    const supabase = await db()
    const bossHpData = await getAllBossHp(guildCode)
    const hpTable = (bossHpData?.byBossName ?? {}) as Record<string, number>
    const primeHpTable = (bossHpData?.primes ?? {}) as Record<string, number>

    const configBySeason = new Map<
      number,
      ReturnType<typeof getSeasonConfigById>
    >()
    const rotationLength = SEASON_ROTATION.length || 5

    const resolveMainBossType = (
      season: string | null,
      rarity: 'Legendary' | 'Mythic',
      setOneIndexed: number,
      encounterId: number,
      rowName: string
    ): string | null => {
      if (encounterId === 0) return rowName

      const seasonNum = parseInt(season ?? '', 10)
      if (!Number.isFinite(seasonNum)) return null
      if (!configBySeason.has(seasonNum)) {
        const capturedConfig = getSeasonConfigForSeasonNumber(seasonNum)
        if (capturedConfig) {
          configBySeason.set(seasonNum, capturedConfig)
        } else {
          const rotationIndex =
            (((seasonNum + SEASON_NUMBER_OFFSET + ROTATION_INDEX_OFFSET - 1) %
              rotationLength) +
              rotationLength) %
            rotationLength
          const configId = SEASON_ROTATION[rotationIndex]
          if (!configId) return null
          configBySeason.set(seasonNum, getSeasonConfigById(configId))
        }
      }

      const config = configBySeason.get(seasonNum)
      const match = config?.bosses.find(
        (boss) =>
          boss.rarity === rarity &&
          boss.set + 1 === setOneIndexed &&
          boss.encounter_id === encounterId
      )
      return match?.boss_type ?? null
    }

    const lookupBossHp = (name: string, level: string): number => {
      const candidates = [
        `${name}_${level}`,
        name,
        name.toLowerCase(),
        name.replace(/\s+/g, ''),
        name.replace(/\s+/g, '').toLowerCase(),
        `${name.replace(/\s+/g, '')}_${level}`,
        `${name.replace(/\s+/g, '').toLowerCase()}_${level}`
      ]
      for (const candidate of candidates) {
        const hp = hpTable[candidate] ?? 0
        if (hp > 0) {
          return hp
        }
      }

      const normalizedName = name.replace(/\s+/g, '').toLowerCase()
      for (const key of Object.keys(hpTable)) {
        if (!key.endsWith(`_${level}`)) continue
        const stem = key.slice(0, -`_${level}`.length).toLowerCase()
        if (
          normalizedName.startsWith(stem) ||
          stem.startsWith(normalizedName)
        ) {
          const hp = hpTable[key] ?? 0
          if (hp > 0) return hp
        }
      }
      for (const key of Object.keys(hpTable)) {
        if (key.includes('_')) continue
        const normalizedKey = key.toLowerCase()
        if (
          normalizedName.startsWith(normalizedKey) ||
          normalizedKey.startsWith(normalizedName)
        ) {
          const hp = hpTable[key] ?? 0
          if (hp > 0) return hp
        }
      }
      return 0
    }

    const { data } = await buildBattleRowsQuery<DamageRow>(supabase, {
      select:
        'Name, set, encounterId, damageDealt, remainingHp, maxHp, Season, rarity',
      scope: { guild: guildCode },
      rarities: ['Legendary', 'Mythic'],
      encounters: 'main-and-primes'
    })
    const damageRows = (data as DamageRow[] | null) ?? []

    const mostRecentSeasonByKey: Record<string, string> = {}
    const resolvedRows = damageRows
      .map((row) => {
        if (!row.Name || !row.Season) return null
        const rarity = row.rarity === 'Mythic' ? 'Mythic' : 'Legendary'
        const encounterId =
          typeof row.encounterId === 'number' ? row.encounterId : 0
        if (encounterId < 0 || encounterId > 2) return null

        const setOneIndexed = (row.set ?? 0) + 1
        const mainBossType = resolveMainBossType(
          row.Season,
          rarity,
          setOneIndexed,
          encounterId,
          row.Name
        )
        if (!mainBossType) return null

        const bossKey = `${mainBossType}__${rarity}__${setOneIndexed}__${encounterId}`
        const level = `${rarity === 'Mythic' ? 'M' : 'L'}${setOneIndexed}`
        const bossHp =
          encounterId === 0
            ? lookupBossHp(mainBossType, level)
            : lookupPrimeBossHp(
                mainBossType,
                level,
                primeHpTable,
                encounterId as 1 | 2
              )
        if (bossHp <= 0) return null

        if (!mostRecentSeasonByKey[bossKey]) {
          mostRecentSeasonByKey[bossKey] = row.Season
        }

        return { row, bossKey, season: row.Season, bossHp }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    interface Agg {
      bossKey: string
      season: string
      bossHp: number
      totalDamage: number
      totalAttacks: number
    }
    const aggByKey = new Map<string, Agg>()

    resolvedRows.forEach(({ row, bossKey, season, bossHp }) => {
      if (season !== mostRecentSeasonByKey[bossKey]) return
      const klass = classifyKill({
        damageDealt: row.damageDealt ?? 0,
        remainingHp: row.remainingHp ?? 0,
        maxHp: row.maxHp ?? null
      })
      if (klass === 'sweep') return

      let agg = aggByKey.get(bossKey)
      if (!agg) {
        agg = {
          bossKey,
          season,
          bossHp,
          totalDamage: 0,
          totalAttacks: 0
        }
        aggByKey.set(bossKey, agg)
      }
      agg.totalDamage += row.damageDealt ?? 0
      agg.totalAttacks += 1
    })

    const result: PerBossActualsByKey = {}
    aggByKey.forEach((agg) => {
      if (agg.totalAttacks <= 0 || agg.totalDamage <= 0) return
      const guildAvgDamage = agg.totalDamage / agg.totalAttacks
      const tokensToKill = agg.bossHp / guildAvgDamage
      if (!Number.isFinite(tokensToKill) || tokensToKill <= 0) return
      result[agg.bossKey] = {
        season: agg.season,
        tokensToKill,
        sampleCount: agg.totalAttacks
      }
    })
    return result
  } catch (err) {
    logger.error(
      { guildCode, error: err },
      'getGuildPerBossActualTokens failed'
    )
    return {}
  }
}
