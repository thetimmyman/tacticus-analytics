'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rarity } from '@tacticus/app-core/rarity-utils'

import { dbClient } from '@/app/lib/db/client'
import { loadHeroCatalog } from '@/app/lib/catalogs'
import { useDataContext } from '@/app/lib/hooks/useDataContext'
import { useAsyncPerformance } from '@/app/hooks/usePerformance'
import { createComponentLogger } from '@/app/lib/logging/client'
import {
  normalizeMetaTeams,
  type HeroMapping
} from '@/app/lib/utils/battle-log-helpers'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { GUILD_DISPLAY_COMPACT } from '@/app/lib/guild-config-selects'
import type { BossStatsRow } from '../../lib/boss-player-aggregates'
import {
  buildBossCatalogModel,
  buildBossLeaderboardRows,
  categorizeBossLeaderboardRows,
  resolveBossHeroMappings,
  type BossCatalogRecord,
  type RawBossLeaderboardRecord
} from './data-model'
import {
  findSelectedBoss,
  type BossLeaderboardEntry,
  type BossSummary
} from './model'

const logger = createComponentLogger(
  'leaderboards.components.useBossLeaderboardData'
)

type CachedLeaderboard = {
  leaderboardData: BossLeaderboardEntry[]
  avgLeaderboardData: BossLeaderboardEntry[]
  heroMappings: Map<string, HeroMapping> | null
}

export function useBossLeaderboardData(season: string) {
  const { measureAsync } = useAsyncPerformance()
  const { context, loading: contextLoading } = useDataContext()
  const supabase = dbClient()
  const seasonKey = season ?? '__global__'
  const [selectedBossIdsBySeason, setSelectedBossIdsBySeason] = useState<
    Record<string, string>
  >({})
  const selectedBossId = selectedBossIdsBySeason[seasonKey] ?? ''
  const setSelectedBossId = useCallback(
    (bossId: string) => {
      setSelectedBossIdsBySeason((previous) =>
        previous[seasonKey] === bossId
          ? previous
          : { ...previous, [seasonKey]: bossId }
      )
    },
    [seasonKey]
  )
  const [availableBosses, setAvailableBosses] = useState<BossSummary[]>([])
  const [singlePassBosses, setSinglePassBosses] = useState<BossSummary[]>([])
  const [availableRarities, setAvailableRarities] = useState<Rarity[]>([])
  const [defaultRarities, setDefaultRarities] = useState<Rarity[]>([])
  const [selectedRarities, setSelectedRaritiesState] = useState<Rarity[]>([])
  const [leaderboardData, setLeaderboardData] = useState<
    BossLeaderboardEntry[]
  >([])
  const [avgLeaderboardData, setAvgLeaderboardData] = useState<
    BossLeaderboardEntry[]
  >([])
  const [heroMappings, setHeroMappings] = useState<Map<string, HeroMapping>>(
    new Map()
  )
  const [guildLabels, setGuildLabels] = useState<Record<string, string>>({})
  const [metaTeams, setMetaTeams] = useState<
    ReturnType<typeof normalizeMetaTeams>
  >([])
  const [loading, setLoading] = useState(true)
  const rarityOverrideRef = useRef(false)
  const selectedRaritiesRef = useRef<Rarity[]>([])
  const cacheRef = useRef<Map<string, CachedLeaderboard>>(new Map())
  const requestRef = useRef(0)

  useEffect(() => {
    selectedRaritiesRef.current = selectedRarities
  }, [selectedRarities])

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from('meta_teams')
        .select('team_name, trigger_heroes, match_type')
        .order('sort_order')
      if (!error && data) setMetaTeams(normalizeMetaTeams(data))
      else logger.error({ err: error }, 'Error fetching meta teams')
    })()
  }, [supabase])

  useEffect(() => {
    if (contextLoading || !season) return
    void measureAsync('loadBosses', async () => {
      void loadHeroCatalog().catch((error) =>
        logger.error({ err: error }, 'Failed to warm hero catalog')
      )
      let query = supabase
        .from('EOT_GR_data')
        .select(
          'Name, tier, set, rarity, encounterId, cluster_code, Guild, damageType, damageDealt, loopIndex'
        )
        .eq('Season', season)
        .not('Name', 'is', null)
        .order('startedOn', { ascending: false })
      if (context.clusterCode)
        query = query.eq('cluster_code', context.clusterCode)
      else if (context.guildCode) query = query.eq('Guild', context.guildCode)
      const { data, error } = await query
      if (!error && data && data.length > 0) {
        const model = buildBossCatalogModel(
          data as unknown as BossCatalogRecord[]
        )
        setAvailableBosses(model.availableBosses)
        setSinglePassBosses(model.singlePassBosses)
        setAvailableRarities(model.availableRarities)
        setDefaultRarities(model.defaultRarities)
        if (!rarityOverrideRef.current) {
          setSelectedRaritiesState(model.defaultRarities)
        } else {
          setSelectedRaritiesState((current) =>
            current.filter((rarity) => model.availableRarities.includes(rarity))
          )
        }
        if (!selectedBossId && model.defaultBossId) {
          setSelectedBossId(model.defaultBossId)
        }
      }
      setLoading(false)
    })
  }, [
    context,
    contextLoading,
    measureAsync,
    season,
    selectedBossId,
    setSelectedBossId,
    supabase
  ])

  useEffect(() => {
    const requestId = ++requestRef.current
    const isCurrent = () => requestRef.current === requestId
    if (!selectedBossId) {
      void Promise.resolve().then(() => {
        if (isCurrent()) setLoading(false)
      })
      return () => {
        if (isCurrent()) requestRef.current += 1
      }
    }
    const selectedBoss = findSelectedBoss(
      [...availableBosses, ...singlePassBosses],
      selectedBossId
    )
    if (!selectedBoss) {
      setLeaderboardData([])
      setAvgLeaderboardData([])
      setLoading(false)
      return
    }
    const cacheKey = `${season}|${selectedBossId}|${context.clusterCode ?? ''}|${context.guildCode ?? ''}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setLeaderboardData(cached.leaderboardData)
      setAvgLeaderboardData(cached.avgLeaderboardData)
      if (cached.heroMappings) setHeroMappings(cached.heroMappings)
      setLoading(false)
      return
    }
    if (contextLoading || metaTeams.length === 0) return

    setLoading(true)
    void measureAsync('loadLeaderboardData', async () => {
      let leaderboardQuery = supabase
        .from('EOT_GR_data')
        .select(
          'displayName, userId, Guild, damageDealt, completedOn, heroDetails, machineOfWarDetails, tier, loopIndex, cluster_code'
        )
        .eq('Season', season)
        .eq('Name', selectedBoss.Name)
        .eq('rarity', selectedBoss.rarity)
        .eq('set', selectedBoss.set)
        .eq('encounterId', selectedBoss.encounterId)
        .eq('damageType', 'Battle')
        .gt('damageDealt', 0)
        .order('damageDealt', { ascending: false })
        .limit(100)
      const hasScope = Boolean(context.clusterCode || context.guildCode)
      let statsQuery = supabase
        .from('EOT_GR_data')
        .select('displayName, userId, Guild, damageDealt, remainingHp, maxHp')
        .eq('Season', season)
        .eq('Name', selectedBoss.Name)
        .eq('rarity', selectedBoss.rarity)
        .eq('set', selectedBoss.set)
        .eq('encounterId', selectedBoss.encounterId)
        .eq('damageType', 'Battle')
        .gt('damageDealt', 0)
        .order('startedOn', { ascending: false })
      if (context.clusterCode) {
        leaderboardQuery = leaderboardQuery.eq(
          'cluster_code',
          context.clusterCode
        )
        statsQuery = statsQuery.eq('cluster_code', context.clusterCode)
      } else if (context.guildCode) {
        leaderboardQuery = leaderboardQuery.eq('Guild', context.guildCode)
        statsQuery = statsQuery.eq('Guild', context.guildCode)
      }
      const [leaderboardResult, statsResult] = await Promise.all([
        leaderboardQuery,
        hasScope
          ? statsQuery
          : Promise.resolve({ data: null, error: null } as const)
      ])
      if (!isCurrent()) return
      if (leaderboardResult.error) {
        logger.error(
          { err: leaderboardResult.error },
          'Error fetching leaderboard'
        )
        setLoading(false)
        return
      }
      if (statsResult.error) {
        logger.error({ err: statsResult.error }, 'Error fetching boss averages')
      }
      const statsRows = (statsResult.data ?? []) as unknown as BossStatsRow[]
      const usableStats = statsRows.length >= 10_000 ? [] : statsRows
      if (statsRows.length >= 10_000) {
        logger.warn(
          { rowCount: statsRows.length },
          'Boss stats hit row cap; omitting averages'
        )
      }
      const rows = buildBossLeaderboardRows(
        (leaderboardResult.data ?? []) as unknown as RawBossLeaderboardRecord[],
        usableStats,
        selectedBoss
      )
      const mappings = await resolveBossHeroMappings(
        rows.heroIds,
        loadHeroCatalog
      )
      if (!isCurrent()) return
      const categorized = categorizeBossLeaderboardRows(
        rows,
        mappings,
        metaTeams
      )
      setLeaderboardData(categorized.maxRows)
      setAvgLeaderboardData(categorized.averageRows)
      if (rows.heroIds.size > 0) setHeroMappings(mappings)
      cacheRef.current.set(cacheKey, {
        leaderboardData: categorized.maxRows,
        avgLeaderboardData: categorized.averageRows,
        heroMappings: rows.heroIds.size > 0 ? mappings : null
      })
      setLoading(false)
    })
    return () => {
      if (isCurrent()) requestRef.current += 1
    }
  }, [
    availableBosses,
    context,
    contextLoading,
    measureAsync,
    metaTeams,
    season,
    selectedBossId,
    singlePassBosses,
    supabase
  ])

  useEffect(() => {
    const guilds = [
      ...new Set(
        [...leaderboardData, ...avgLeaderboardData]
          .map((entry) => entry.Guild)
          .filter(Boolean)
      )
    ]
    const missing = guilds.filter((guild) => !(guild in guildLabels))
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('guild_config')
        .select(GUILD_DISPLAY_COMPACT)
        .in('guild_code', missing)
      if (cancelled || error || !data) return
      setGuildLabels((previous) => {
        const next = { ...previous }
        for (const guild of data) {
          if (guild.guild_code) {
            next[guild.guild_code] = formatGuildDisplayLabel(
              guild,
              guild.guild_code
            )
          }
        }
        for (const guild of missing) {
          next[guild] ??= formatGuildDisplayLabel(null, guild)
        }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [avgLeaderboardData, guildLabels, leaderboardData, supabase])

  const setSelectedRarities = (rarities: Rarity[]) => {
    rarityOverrideRef.current = true
    setSelectedRaritiesState(rarities)
  }
  const resetSelectedRarities = () => {
    rarityOverrideRef.current = false
    setSelectedRaritiesState(defaultRarities)
  }

  return {
    context,
    selectedBossId,
    setSelectedBossId,
    availableBosses,
    singlePassBosses,
    availableRarities,
    defaultRarities,
    selectedRarities,
    setSelectedRarities,
    resetSelectedRarities,
    leaderboardData,
    avgLeaderboardData,
    heroMappings,
    guildLabels,
    loading
  }
}
