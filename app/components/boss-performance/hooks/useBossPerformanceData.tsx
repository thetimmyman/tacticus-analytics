'use client'

import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.boss-performance.hooks.useBossPerformanceData'
)
import { logQuery } from '@tacticus/app-core/performance-monitor'
import { PLAYERS_PER_PAGE } from '@/app/components/boss-performance/constants'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import type {
  AssignedPlayers,
  BossPerformanceOverview,
  BossPerformanceParams,
  LapTrend,
  PlayerBossStats,
  PrimeBossStats,
  PrimeStats,
  TopStats
} from '@/app/components/boss-performance/types'
import type { BoxWhiskerStats } from '@/app/components/boss-performance/boxWhiskerUtils'

interface RpcAssignedPlayers {
  primary?: unknown
  secondary?: unknown
}

interface RpcPrimeBossStat {
  bossName?: unknown
  playerStats?: unknown
}

interface RpcPrimeStat {
  displayName?: unknown
  avgDamage?: unknown
  tokenCount?: unknown
  maxHit?: unknown
}

interface RpcPlayerStat extends RpcPrimeStat {
  totalDamage?: unknown
  efficiency?: unknown
}

interface RpcLapTrend {
  lap?: unknown
  avgDamage?: unknown
  tokenCount?: unknown
}

interface RpcTopStats {
  topTotalDamagePlayer?: unknown
  topTotalDamage?: unknown
  biggestHitPlayer?: unknown
  biggestHit?: unknown
  totalBossTokens?: unknown
  totalPrimeTokens?: unknown
  overallAvgDamage?: unknown
}

interface RpcBoxWhisker {
  name?: unknown
  min?: unknown
  q1?: unknown
  median?: unknown
  q3?: unknown
  max?: unknown
  sampleSize?: unknown
}

interface RpcOverview {
  bossName?: unknown
  // CamelCase boss_type from the RPC ("BelisariusRW") for Herald season config.
  bossType?: unknown
  playerStats?: unknown
  primeStats?: unknown
  primeBossStats?: unknown
  primeDistributions?: unknown
  lapTrends?: unknown
  topStats?: unknown
  mainDistribution?: unknown
  assignedPlayers?: RpcAssignedPlayers
  hasPrimeData?: unknown
  hasCluster?: unknown
}

const DEFAULT_TOP_STATS: TopStats = {
  topTotalDamagePlayer: '',
  topTotalDamage: 0,
  biggestHitPlayer: '',
  biggestHit: 0,
  totalBossTokens: 0,
  totalPrimeTokens: 0,
  overallAvgDamage: 0
}

const EMPTY_ASSIGNED_PLAYERS: AssignedPlayers = { primary: [], secondary: [] }

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

function parseString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry
      }
      if (entry === null || entry === undefined) {
        return ''
      }
      return String(entry)
    })
    .filter((entry) => entry.length > 0)
}

function parseBoxStats(raw: unknown): BoxWhiskerStats | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const stats = raw as RpcBoxWhisker
  const sampleSize = parseNumber(stats.sampleSize, 0)

  if (sampleSize <= 0) {
    return null
  }

  return {
    name: parseString(stats.name, 'Boss'),
    min: parseNumber(stats.min),
    q1: parseNumber(stats.q1),
    median: parseNumber(stats.median),
    q3: parseNumber(stats.q3),
    max: parseNumber(stats.max),
    sampleSize
  }
}

function parsePrimeStats(raw: unknown): PrimeStats[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((entry) => {
    const stat = entry as RpcPrimeStat
    return {
      displayName: parseString(stat.displayName),
      avgDamage: parseNumber(stat.avgDamage),
      tokenCount: parseNumber(stat.tokenCount),
      maxHit: parseNumber(stat.maxHit)
    }
  })
}

function parsePlayerStats(raw: unknown): PlayerBossStats[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((entry) => {
    const stat = entry as RpcPlayerStat
    return {
      displayName: parseString(stat.displayName),
      avgDamage: parseNumber(stat.avgDamage),
      maxHit: parseNumber(stat.maxHit),
      totalDamage: parseNumber(stat.totalDamage),
      tokenCount: parseNumber(stat.tokenCount),
      efficiency: parseNumber(stat.efficiency)
    }
  })
}

function parsePrimeBossStats(raw: unknown): PrimeBossStats[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((entry) => {
    const stat = entry as RpcPrimeBossStat
    const players = parsePrimeStats(stat.playerStats)
    return {
      bossName: parseString(stat.bossName, 'Prime Boss'),
      playerStats: players
    }
  })
}

function parseLapTrends(raw: unknown): LapTrend[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((entry) => {
    const trend = entry as RpcLapTrend
    return {
      lap: parseNumber(trend.lap, 0),
      avgDamage: parseNumber(trend.avgDamage),
      tokenCount: parseNumber(trend.tokenCount)
    }
  })
}

function parseTopStats(raw: unknown): TopStats {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_TOP_STATS
  }

  const stats = raw as RpcTopStats
  return {
    topTotalDamagePlayer: parseString(stats.topTotalDamagePlayer),
    topTotalDamage: parseNumber(stats.topTotalDamage),
    biggestHitPlayer: parseString(stats.biggestHitPlayer),
    biggestHit: parseNumber(stats.biggestHit),
    totalBossTokens: parseNumber(stats.totalBossTokens),
    totalPrimeTokens: parseNumber(stats.totalPrimeTokens),
    overallAvgDamage: parseNumber(stats.overallAvgDamage)
  }
}

function parseAssignedPlayers(
  raw: RpcAssignedPlayers | undefined
): AssignedPlayers {
  if (!raw) {
    return EMPTY_ASSIGNED_PLAYERS
  }

  return {
    primary: ensureStringArray(raw.primary),
    secondary: ensureStringArray(raw.secondary)
  }
}

function parseBoxCollection(raw: unknown): BoxWhiskerStats[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map(parseBoxStats)
    .filter((entry): entry is BoxWhiskerStats => Boolean(entry))
}

function normalizeOverview(
  data: RpcOverview | null,
  level: string
): BossPerformanceOverview {
  const bossName = parseString(data?.bossName, `Boss ${level}`)
  const bossType = parseString(data?.bossType, bossName)

  return {
    bossName,
    bossType,
    displayBossName: getBossDisplayName(bossName),
    playerStats: parsePlayerStats(data?.playerStats),
    primeStats: parsePrimeStats(data?.primeStats),
    primeBossStats: parsePrimeBossStats(data?.primeBossStats),
    lapTrends: parseLapTrends(data?.lapTrends),
    topStats: parseTopStats(data?.topStats),
    mainDistribution: parseBoxStats(data?.mainDistribution) ?? null,
    primeDistributions: parseBoxCollection(data?.primeDistributions),
    assignedPlayers: parseAssignedPlayers(data?.assignedPlayers),
    hasPrimeData: Boolean(data?.hasPrimeData),
    hasCluster: Boolean(data?.hasCluster)
  }
}

export interface UseBossPerformanceDataResult {
  loading: boolean
  error: string | null
  bossName: string
  bossType: string
  displayBossName: string
  hasCluster: boolean
  topStats: TopStats
  playerBossStats: PlayerBossStats[]
  primeBossStats: PrimeBossStats[]
  primeStats: PrimeStats[]
  lapTrends: LapTrend[]
  assignedPlayers: AssignedPlayers
  mainDamageDistribution: BoxWhiskerStats | null
  primeDamageDistributions: BoxWhiskerStats[]
  hasPrimeData: boolean
  avgDamagePage: number
  totalDamagePage: number
  setAvgDamagePage: (page: number) => void
  setTotalDamagePage: (page: number) => void
  playersPerPage: number
}

interface BossPerformanceContextValue
  extends UseBossPerformanceDataResult, BossPerformanceParams {}

const BossPerformanceDataContext =
  createContext<BossPerformanceContextValue | null>(null)

export interface BossPerformanceDataProviderProps extends BossPerformanceParams {
  children: ReactNode
}

export function BossPerformanceDataProvider({
  children,
  ...params
}: BossPerformanceDataProviderProps) {
  const data = useBossPerformanceDataInternal(params)
  const contextValue: BossPerformanceContextValue = {
    ...data,
    ...params
  }

  return (
    <BossPerformanceDataContext.Provider value={contextValue}>
      {children}
    </BossPerformanceDataContext.Provider>
  )
}

export function useBossPerformanceContext(): BossPerformanceContextValue {
  const context = useContext(BossPerformanceDataContext)
  if (!context) {
    throw new Error(
      'Boss performance hooks must be used within BossPerformanceDataProvider'
    )
  }
  return context
}

export function useBossPerformanceOverview() {
  return useBossPerformanceContext()
}

export function useBossHeaderStats() {
  const {
    bossName: bossSlug,
    displayBossName,
    level,
    topStats
  } = useBossPerformanceContext()
  return {
    bossName: displayBossName,
    bossSlug,
    level,
    averageDamage: topStats.overallAvgDamage
  }
}

export function useBossTopStats() {
  const { topStats, loading, error } = useBossPerformanceContext()
  return { topStats, loading, error }
}

export function useBossRankings() {
  const {
    playerBossStats,
    avgDamagePage,
    totalDamagePage,
    setAvgDamagePage,
    setTotalDamagePage,
    playersPerPage,
    loading,
    error
  } = useBossPerformanceContext()

  return {
    playerBossStats,
    avgDamagePage,
    totalDamagePage,
    setAvgDamagePage,
    setTotalDamagePage,
    playersPerPage,
    loading,
    error
  }
}

export function useBossLapTrends() {
  const {
    lapTrends,
    loading,
    error,
    selectedGuild,
    selectedSeason,
    bossName,
    level
  } = useBossPerformanceContext()
  return {
    lapTrends,
    loading,
    error,
    selectedGuild,
    selectedSeason,
    bossName,
    level
  }
}

export function usePrimeBossStats() {
  const { primeBossStats, loading, error } = useBossPerformanceContext()
  return { primeBossStats, loading, error }
}

export function useBossDistributions() {
  const {
    displayBossName,
    mainDamageDistribution,
    primeDamageDistributions,
    hasPrimeData,
    primeStats,
    loading,
    error
  } = useBossPerformanceContext()

  return {
    bossName: displayBossName,
    mainDistribution: mainDamageDistribution,
    primeDamageDistributions,
    hasPrimeData,
    primeParticipantCount: primeStats.length,
    loading,
    error
  }
}

async function fetchBossPerformanceOverview(
  selectedGuild: string,
  selectedSeason: string,
  level: string
): Promise<BossPerformanceOverview> {
  const { dbClient } = await import('@/app/lib/db/client')
  const supabase = dbClient()
  logQuery('BossPerformance', 'get_boss_performance_overview')

  const { data, error } = await supabase.rpc('get_boss_performance_overview', {
    p_guild_code: selectedGuild,
    p_season: selectedSeason,
    p_level: level
  })

  if (error) {
    logger.error({ err: error }, 'Error calling get_boss_performance_overview:')
    throw new Error('Unable to load boss performance data. Please try again.')
  }

  return normalizeOverview((data ?? null) as RpcOverview, level)
}

function useBossPerformanceDataInternal({
  selectedGuild,
  selectedSeason,
  level
}: BossPerformanceParams): UseBossPerformanceDataResult {
  const [avgDamagePage, setAvgDamagePage] = useState(0)
  const [totalDamagePage, setTotalDamagePage] = useState(0)

  const [prevParams, setPrevParams] = useState({
    selectedGuild,
    selectedSeason,
    level
  })
  const paramsChanged =
    prevParams.selectedGuild !== selectedGuild ||
    prevParams.selectedSeason !== selectedSeason ||
    prevParams.level !== level

  // Reset during render (React docs pattern).
  if (paramsChanged) {
    setPrevParams({ selectedGuild, selectedSeason, level })
    if (avgDamagePage !== 0) {
      setAvgDamagePage(0)
    }
    if (totalDamagePage !== 0) {
      setTotalDamagePage(0)
    }
  }

  const enabled =
    Boolean(selectedGuild) && Boolean(selectedSeason) && Boolean(level)

  const {
    data: overview,
    isLoading: loading,
    error: queryError
  } = useQuery({
    queryKey: [
      'boss-performance-overview',
      selectedGuild,
      selectedSeason,
      level
    ],
    queryFn: () =>
      fetchBossPerformanceOverview(selectedGuild, selectedSeason, level),
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: (previousData) => previousData
  })

  const error = useMemo(() => {
    if (!enabled) {
      return 'Select a guild, season, and boss level to load performance data.'
    }
    if (queryError) {
      return queryError instanceof Error
        ? queryError.message
        : 'An error occurred'
    }
    return null
  }, [enabled, queryError])

  return {
    loading: enabled && loading,
    error,
    bossName: overview?.bossName ?? `Boss ${level}`,
    bossType: overview?.bossType ?? '',
    displayBossName:
      overview?.displayBossName ??
      getBossDisplayName(overview?.bossName ?? `Boss ${level}`),
    hasCluster: overview?.hasCluster ?? false,
    topStats: overview?.topStats ?? DEFAULT_TOP_STATS,
    playerBossStats: overview?.playerStats ?? [],
    primeBossStats: overview?.primeBossStats ?? [],
    primeStats: overview?.primeStats ?? [],
    lapTrends: overview?.lapTrends ?? [],
    assignedPlayers: overview?.assignedPlayers ?? EMPTY_ASSIGNED_PLAYERS,
    mainDamageDistribution: overview?.mainDistribution ?? null,
    primeDamageDistributions: overview?.primeDistributions ?? [],
    hasPrimeData: overview?.hasPrimeData ?? false,
    avgDamagePage,
    totalDamagePage,
    setAvgDamagePage,
    setTotalDamagePage,
    playersPerPage: PLAYERS_PER_PAGE
  }
}
