import type { Rarity } from '@tacticus/app-core/rarity-utils'
import {
  normalizeRarity,
  sortRaritiesByHierarchy
} from '@tacticus/app-core/rarity-utils'

import {
  buildHeroMappingMap,
  detectCategories,
  parseHeroDetails,
  parseMachineOfWarDetails,
  type HeroMapping,
  type MetaTeamNormalized
} from '@/app/lib/utils/battle-log-helpers'
import {
  filterToLoopWindow,
  toLoopObservations
} from '@/app/lib/boss-assignments/loop-window'
import {
  computeBossPlayerAggregates,
  stableBossPlayerId,
  type BossStatsRow
} from '../../lib/boss-player-aggregates'
import {
  getBossId,
  getLevelDisplay,
  toBossSummary,
  type BossLeaderboardEntry,
  type BossSummary
} from './model'

export type BossCatalogRecord = Record<string, unknown> & {
  rarity?: string | null
  set?: number | null
  loopIndex?: number | null
  Guild?: string | null
  damageType?: string | null
  damageDealt?: number | null
}

export type BossCatalogModel = {
  availableBosses: BossSummary[]
  singlePassBosses: BossSummary[]
  availableRarities: Rarity[]
  defaultRarities: Rarity[]
  defaultBossId: string | null
}

export function buildBossCatalogModel(
  records: BossCatalogRecord[]
): BossCatalogModel {
  const unique = new Map<string, BossSummary>()
  const participation = new Map<string, number>()

  for (const record of records) {
    const boss = toBossSummary(record)
    if (!boss) continue
    const key = getBossId(boss)
    if (record.damageType === 'Battle' && Number(record.damageDealt) > 0) {
      participation.set(key, (participation.get(key) ?? 0) + 1)
    }
    if (!unique.has(key)) unique.set(key, boss)
  }

  const allBosses = [...unique.values()]
  const availableBosses = filterToLoopWindow(
    allBosses,
    (boss) => getLevelDisplay(boss.set, boss.rarity),
    toLoopObservations(records)
  )
  const availableKeys = new Set(availableBosses.map(getBossId))
  const singlePassBosses = allBosses.filter(
    (boss) => !availableKeys.has(getBossId(boss))
  )
  const availableRarities = sortRaritiesByHierarchy(
    [
      ...new Set(availableBosses.map((boss) => normalizeRarity(boss.rarity)))
    ].filter((rarity): rarity is Rarity => Boolean(rarity))
  )
  const defaultRarities = availableRarities.slice(
    0,
    Math.min(2, availableRarities.length)
  )
  const mythic = availableBosses.filter((boss) => boss.rarity === 'Mythic')
  const candidates = mythic.length > 0 ? mythic : availableBosses
  const defaultBoss = candidates.reduce<BossSummary | null>((best, boss) => {
    if (!best) return boss
    return (participation.get(getBossId(boss)) ?? 0) >
      (participation.get(getBossId(best)) ?? 0)
      ? boss
      : best
  }, null)

  return {
    availableBosses,
    singlePassBosses,
    availableRarities,
    defaultRarities,
    defaultBossId: defaultBoss ? getBossId(defaultBoss) : null
  }
}

export type RawBossLeaderboardRecord = {
  displayName: string
  userId: string | null
  Guild: string
  damageDealt: number
  completedOn: string
  heroDetails: string | null
  machineOfWarDetails: string | null
  tier: number
  loopIndex: number
}

export type BossLeaderboardRowsModel = {
  maxRows: BossLeaderboardEntry[]
  averageRows: BossLeaderboardEntry[]
  heroIds: Set<string>
}

export function buildBossLeaderboardRows(
  records: RawBossLeaderboardRecord[],
  statsRows: BossStatsRow[],
  boss: BossSummary
): BossLeaderboardRowsModel {
  const aggregates = computeBossPlayerAggregates(statsRows)
  const entries: BossLeaderboardEntry[] = records.map((record) => ({
    ...record,
    Name: boss.Name,
    rarity: boss.rarity,
    set: boss.set,
    encounterId: boss.encounterId
  }))
  const uniqueTeams = new Map<string, BossLeaderboardEntry>()
  for (const entry of entries) {
    const heroes = parseHeroDetails(entry.heroDetails)
    const mow = parseMachineOfWarDetails(entry.machineOfWarDetails)
    const key = `${stableBossPlayerId(entry)}|${heroes.join(',')}|${mow ?? ''}`
    const current = uniqueTeams.get(key)
    if (!current || entry.damageDealt > current.damageDealt) {
      uniqueTeams.set(key, entry)
    }
  }
  const annotate = (entry: BossLeaderboardEntry): BossLeaderboardEntry => {
    const aggregate = aggregates.get(stableBossPlayerId(entry))
    return aggregate
      ? {
          ...entry,
          avgDamage: aggregate.avgDamage,
          avgBattleCount: aggregate.battleCount
        }
      : entry
  }
  const maxRows = [...uniqueTeams.values()]
    .sort((a, b) => b.damageDealt - a.damageDealt)
    .slice(0, 20)
    .map(annotate)
  const bestByPlayer = new Map<string, BossLeaderboardEntry>()
  for (const entry of uniqueTeams.values()) {
    const key = stableBossPlayerId(entry)
    const current = bestByPlayer.get(key)
    if (!current || entry.damageDealt > current.damageDealt) {
      bestByPlayer.set(key, entry)
    }
  }
  const averageRows = [...aggregates.entries()]
    .filter(([, aggregate]) => aggregate.avgDamage > 0)
    .sort(
      ([, a], [, b]) => b.avgDamage - a.avgDamage || b.maxDamage - a.maxDamage
    )
    .slice(0, 20)
    .map(([key, aggregate]) => {
      const base = bestByPlayer.get(key)
      return {
        ...(base ?? {
          displayName: aggregate.displayName,
          userId: aggregate.userId,
          Guild: aggregate.Guild,
          damageDealt: aggregate.maxDamage,
          completedOn: '',
          heroDetails: null,
          machineOfWarDetails: null,
          tier: boss.tier,
          loopIndex: -1,
          Name: boss.Name,
          rarity: boss.rarity,
          set: boss.set,
          encounterId: boss.encounterId
        }),
        avgDamage: aggregate.avgDamage,
        avgBattleCount: aggregate.battleCount
      }
    })
  const heroIds = new Set<string>()
  for (const entry of [...maxRows, ...averageRows]) {
    parseHeroDetails(entry.heroDetails).forEach((id) => heroIds.add(id))
    const mow = parseMachineOfWarDetails(entry.machineOfWarDetails)
    if (mow) heroIds.add(mow)
  }
  return { maxRows, averageRows, heroIds }
}

export function categorizeBossLeaderboardRows(
  rows: BossLeaderboardRowsModel,
  mappings: Map<string, HeroMapping>,
  metaTeams: MetaTeamNormalized[]
): Pick<BossLeaderboardRowsModel, 'maxRows' | 'averageRows'> {
  const categorize = (entry: BossLeaderboardEntry): BossLeaderboardEntry => {
    const names = parseHeroDetails(entry.heroDetails)
      .map((id) => mappings.get(id)?.display_name)
      .filter((name): name is string => Boolean(name))
    return { ...entry, categories: detectCategories(names, metaTeams) }
  }
  return {
    maxRows: rows.maxRows.map(categorize),
    averageRows: rows.averageRows.map(categorize)
  }
}

export async function resolveBossHeroMappings(
  heroIds: Set<string>,
  loadCatalog: () => ReturnType<
    typeof import('@/app/lib/catalogs').loadHeroCatalog
  >
): Promise<Map<string, HeroMapping>> {
  if (heroIds.size === 0) return new Map()
  return buildHeroMappingMap(await loadCatalog(), heroIds)
}
