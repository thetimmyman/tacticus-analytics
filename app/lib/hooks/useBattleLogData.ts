'use client'

import { useState, useEffect } from 'react'
import { assertClientSession, dbClient } from '@/app/lib/db/client'
import { loadHeroCatalog } from '@/app/lib/catalogs'
import { createComponentLogger } from '@/app/lib/logging/client'
import {
  buildPerformanceLookupKey,
  type PlayerBossPerformanceRow,
  toNullableNumber
} from '@/app/lib/utils/battle-log-performance'
import {
  parseHeroDetails,
  parseMachineOfWarDetails,
  normalizeMetaTeams,
  detectCategories,
  buildHeroMappingMap,
  type BattleLogEntry,
  type HeroMapping,
  type MetaTeamNormalized
} from '@/app/lib/utils/battle-log-helpers'

const logger = createComponentLogger('hooks.useBattleLogData')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueryModifier = (query: any) => any

export interface UseBattleLogDataConfig {
  guild: string | null
  season: string | null
  page: number
  pageSize: number
  selectColumns?: string
  orderBy?: Array<{ column: string; ascending: boolean }>
  buildFilters?: QueryModifier
  enabled?: boolean
  deps?: unknown[]
}

export interface UseBattleLogDataResult {
  entries: BattleLogEntry[]
  loading: boolean
  totalCount: number
  heroMappings: Map<string, HeroMapping>
  metaTeams: MetaTeamNormalized[]
  guildPerformancePctMap: Map<string, number | null>
  clusterPerformancePctMap: Map<string, number | null>
}

const DEFAULT_SELECT =
  'id, displayName, Name, damageDealt, damageType, tier, set, rarity, loopIndex, completedOn, remainingHp, maxHp, heroDetails, machineOfWarDetails, encounterId'

const DEFAULT_ORDER: Array<{ column: string; ascending: boolean }> = [
  { column: 'completedOn', ascending: false },
  { column: 'loopIndex', ascending: false }
]

export function useBattleLogData(
  config: UseBattleLogDataConfig
): UseBattleLogDataResult {
  const {
    guild,
    season,
    page,
    pageSize,
    selectColumns = DEFAULT_SELECT,
    orderBy = DEFAULT_ORDER,
    buildFilters,
    enabled = true,
    deps = []
  } = config

  const [entries, setEntries] = useState<BattleLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [heroMappings, setHeroMappings] = useState<Map<string, HeroMapping>>(
    new Map()
  )
  const [metaTeams, setMetaTeams] = useState<MetaTeamNormalized[]>([])
  const [guildPerformancePctMap, setGuildPerformancePctMap] = useState<
    Map<string, number | null>
  >(new Map())
  const [clusterPerformancePctMap, setClusterPerformancePctMap] = useState<
    Map<string, number | null>
  >(new Map())

  useEffect(() => {
    if (!enabled) return

    let cancelled = false

    const fetchData = async () => {
      setLoading(true)
      const supabase = dbClient()

      try {
        // Inside the try so a throw still reaches the finally that clears `loading`.
        await assertClientSession()

        const perfPromise =
          guild && season
            ? Promise.resolve(
                supabase.rpc('get_player_boss_performance', {
                  guild_code_param: guild,
                  season_param: season
                })
              ).then((r) => ({
                data: r.data as PlayerBossPerformanceRow[] | null
              }))
            : Promise.resolve({
                data: null as PlayerBossPerformanceRow[] | null
              })

        // SDK, not an RPC: callers compose dynamic filters, ordering and `.range()` pagination.
        let countQuery = supabase
          .from('EOT_GR_data')
          .select('id', { count: 'exact', head: true })
        if (buildFilters) countQuery = buildFilters(countQuery)

        // eot-gr-data-requires-order: ordered dynamically below after filters are applied.
        let dataQuery = supabase.from('EOT_GR_data').select(selectColumns)
        if (buildFilters) dataQuery = buildFilters(dataQuery)
        for (const o of orderBy) {
          dataQuery = dataQuery.order(o.column, { ascending: o.ascending })
        }
        dataQuery = dataQuery.range(page * pageSize, (page + 1) * pageSize - 1)

        const [perfResult, countResult, dataResult] = await Promise.all([
          perfPromise,
          Promise.resolve(countQuery),
          Promise.resolve(dataQuery).then(
            (r) => r as { data: BattleLogEntry[] | null; error: unknown }
          )
        ])

        if (!cancelled && perfResult.data) {
          const nextGuild = new Map<string, number | null>()
          const nextCluster = new Map<string, number | null>()

          perfResult.data.forEach((row) => {
            const key = buildPerformanceLookupKey({
              displayName: row.display_name,
              bossName: row.boss_name,
              encounterId: row.encounter_id,
              setNum: row.set_num,
              rarity: row.rarity
            })
            nextGuild.set(key, toNullableNumber(row.player_vs_guild_avg))
            nextCluster.set(key, toNullableNumber(row.player_vs_cluster_avg))
          })

          setGuildPerformancePctMap(nextGuild)
          setClusterPerformancePctMap(nextCluster)
        }

        if (!cancelled) setTotalCount(countResult.count || 0)

        const { data, error } = dataResult

        if (error) {
          logger.error({ error }, 'Error fetching battle log data')
          if (!cancelled) setEntries([])
          return
        }

        const battleEntries: BattleLogEntry[] = data || []

        const heroIds = new Set<string>()
        battleEntries.forEach((entry) => {
          const heroes = parseHeroDetails(entry.heroDetails)
          heroes.forEach((id) => heroIds.add(id))
          const machine = parseMachineOfWarDetails(entry.machineOfWarDetails)
          if (machine) heroIds.add(machine)
        })

        let mappingsMap = new Map<string, HeroMapping>()
        if (heroIds.size > 0) {
          const catalog = await loadHeroCatalog()
          mappingsMap = buildHeroMappingMap(catalog, heroIds)
        }
        if (!cancelled) setHeroMappings(mappingsMap)

        const { data: teams } = await supabase
          .from('meta_teams')
          .select('team_name, trigger_heroes, match_type')
          .order('sort_order')

        const normalized = normalizeMetaTeams(teams || [])
        if (!cancelled) setMetaTeams(normalized)

        const processedEntries = battleEntries.map((entry) => {
          const heroes = parseHeroDetails(entry.heroDetails)
          const heroNames = heroes.map(
            (heroId) => mappingsMap.get(heroId)?.display_name || heroId
          )
          const categories = detectCategories(heroNames, normalized)
          return { ...entry, categories }
        })

        if (!cancelled) setEntries(processedEntries)
      } catch (error) {
        logger.error({ error }, 'Error in battle log data fetch')
        if (!cancelled) setEntries([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild, season, page, pageSize, enabled, ...deps])

  return {
    entries,
    loading,
    totalCount,
    heroMappings,
    metaTeams,
    guildPerformancePctMap,
    clusterPerformancePctMap
  }
}
