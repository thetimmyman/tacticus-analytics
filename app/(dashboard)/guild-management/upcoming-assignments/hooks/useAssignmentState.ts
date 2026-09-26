import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import type { Rarity } from '@/app/lib/config'
import type {
  BossOption,
  BossMapping,
  PlayerAssignment,
  PerformanceData,
  HistoricalPerformance,
  PlayerTokenAllocations,
  GuildConfig,
  MetaTeamData,
  TokenPerformanceData
} from '../types'

export interface AssignmentState {
  loading: boolean
  saving: boolean
  clearing: boolean
  allBosses: BossOption[]
  allSubBosses: BossOption[]
  bossMappings: BossMapping[]
  availableLevels: string[]
  selectedBosses: Record<string, string>
  selectedSubBosses: Record<string, string>
  skippedPrimes: Record<string, boolean>
  primeHpData: Record<string, number>
  players: PlayerAssignment[]
  saveMessage: string
  performanceData: PerformanceData
  latestSeason: string
  showClearConfirm: boolean
  useBalancedAssignment: boolean
  useEnhancedAssignment: boolean
  selectedRarities: Rarity[]
  playerTokenAllocations: PlayerTokenAllocations
  assignmentReasons: Record<string, Record<string, string>>
  historicalPerformance: HistoricalPerformance
  tokenPerformance: TokenPerformanceData
  reliabilityScores: Record<string, number>
  metaTeamData: MetaTeamData
  teamCompositions: Record<string, unknown>[]
  subBossesLoadedFromDB: boolean
  autoSaveTimeout: NodeJS.Timeout | null
}

export interface AssignmentActions {
  setLoading: (loading: boolean) => void
  setSaving: (saving: boolean) => void
  setClearing: (clearing: boolean) => void
  setAllBosses: (bosses: BossOption[]) => void
  setAllSubBosses: (subBosses: BossOption[]) => void
  setBossMappings: (mappings: BossMapping[]) => void
  setAvailableLevels: (levels: string[]) => void
  setSelectedBosses: (
    bosses:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>)
  ) => void
  setSelectedSubBosses: (
    subBosses:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>)
  ) => void
  setSkippedPrimes: (
    primes:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>)
  ) => void
  setPrimeHpData: (data: Record<string, number>) => void
  setPlayers: (
    players:
      PlayerAssignment[] | ((prev: PlayerAssignment[]) => PlayerAssignment[])
  ) => void
  setSaveMessage: (message: string) => void
  setPerformanceData: (data: PerformanceData) => void
  setLatestSeason: (season: string) => void
  setShowClearConfirm: (show: boolean) => void
  setUseBalancedAssignment: (use: boolean) => void
  setUseEnhancedAssignment: (use: boolean) => void
  setSelectedRarities: (rarities: Rarity[]) => void
  setPlayerTokenAllocations: (
    allocations:
      | PlayerTokenAllocations
      | ((prev: PlayerTokenAllocations) => PlayerTokenAllocations)
  ) => void
  setAssignmentReasons: (
    reasons: Record<string, Record<string, string>>
  ) => void
  setHistoricalPerformance: (data: HistoricalPerformance) => void
  setTokenPerformance: (data: TokenPerformanceData) => void
  setReliabilityScores: (scores: Record<string, number>) => void
  setMetaTeamData: (data: MetaTeamData) => void
  setTeamCompositions: (compositions: Record<string, unknown>[]) => void
  setSubBossesLoadedFromDB: (loaded: boolean) => void
  setAutoSaveTimeout: (timeout: NodeJS.Timeout | null) => void
  getLatestState: () => AssignmentState
}

export function useAssignmentState(
  initialPerformanceData: PerformanceData,
  initialLatestSeason: string,
  initialPrimeHpData: Record<string, number>,
  initialBossHpData: { primes?: Record<string, number> },
  initialTokenPerformanceData: TokenPerformanceData = {}
): [AssignmentState, AssignmentActions] {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [allBosses, setAllBosses] = useState<BossOption[]>([])
  const [allSubBosses, setAllSubBosses] = useState<BossOption[]>([])
  const [bossMappings, setBossMappings] = useState<BossMapping[]>([])
  const [availableLevels, setAvailableLevels] = useState<string[]>([])
  const [selectedBosses, setSelectedBosses] = useState<Record<string, string>>(
    {}
  )
  const [selectedSubBosses, setSelectedSubBosses] = useState<
    Record<string, string>
  >({})
  const [skippedPrimes, setSkippedPrimes] = useState<Record<string, boolean>>(
    {}
  )
  const [primeHpData, setPrimeHpData] = useState<Record<string, number>>({
    ...initialPrimeHpData,
    ...(initialBossHpData?.primes || {})
  })
  const [players, setPlayers] = useState<PlayerAssignment[]>([])
  const [saveMessage, setSaveMessage] = useState('')
  const [performanceData, setPerformanceData] = useState<PerformanceData>(
    initialPerformanceData
  )
  const [latestSeason, setLatestSeason] = useState<string>(initialLatestSeason)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [useBalancedAssignment, setUseBalancedAssignment] = useState(true)
  const [useEnhancedAssignment, setUseEnhancedAssignment] = useState(false)
  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([
    'Legendary',
    'Mythic'
  ])
  const [playerTokenAllocations, setPlayerTokenAllocations] =
    useState<PlayerTokenAllocations>({})
  const [assignmentReasons, setAssignmentReasons] = useState<
    Record<string, Record<string, string>>
  >({})
  const [historicalPerformance, setHistoricalPerformance] =
    useState<HistoricalPerformance>({})
  const [tokenPerformance, setTokenPerformance] =
    useState<TokenPerformanceData>(initialTokenPerformanceData)
  const [reliabilityScores, setReliabilityScores] = useState<
    Record<string, number>
  >({})
  const [metaTeamData, setMetaTeamData] = useState<MetaTeamData>({})
  const [teamCompositions, setTeamCompositions] = useState<
    Record<string, unknown>[]
  >([])
  const [subBossesLoadedFromDB, setSubBossesLoadedFromDB] = useState(false)
  const [autoSaveTimeout, setAutoSaveTimeout] = useState<NodeJS.Timeout | null>(
    null
  )

  const stateRef = useRef<AssignmentState>(null!)

  const currentState: AssignmentState = {
    loading,
    saving,
    clearing,
    allBosses,
    allSubBosses,
    bossMappings,
    availableLevels,
    selectedBosses,
    selectedSubBosses,
    skippedPrimes,
    primeHpData,
    players,
    saveMessage,
    performanceData,
    latestSeason,
    showClearConfirm,
    useBalancedAssignment,
    useEnhancedAssignment,
    selectedRarities,
    playerTokenAllocations,
    assignmentReasons,
    historicalPerformance,
    tokenPerformance,
    reliabilityScores,
    metaTeamData,
    teamCompositions,
    subBossesLoadedFromDB,
    autoSaveTimeout
  }

  useEffect(() => {
    stateRef.current = currentState
  })

  const getLatestState = useCallback(() => stateRef.current, [])

  const actions: AssignmentActions = useMemo(
    () => ({
      setLoading,
      setSaving,
      setClearing,
      setAllBosses,
      setAllSubBosses,
      setBossMappings,
      setAvailableLevels,
      setSelectedBosses,
      setSelectedSubBosses,
      setSkippedPrimes,
      setPrimeHpData,
      setPlayers,
      setSaveMessage,
      setPerformanceData,
      setLatestSeason,
      setShowClearConfirm,
      setUseBalancedAssignment,
      setUseEnhancedAssignment,
      setSelectedRarities,
      setPlayerTokenAllocations,
      setAssignmentReasons,
      setHistoricalPerformance,
      setTokenPerformance,
      setReliabilityScores,
      setMetaTeamData,
      setTeamCompositions,
      setSubBossesLoadedFromDB,
      setAutoSaveTimeout,
      getLatestState
    }),
    [getLatestState]
  )

  return [currentState, actions]
}

export function useComputedValues(
  state: AssignmentState,
  _mode: 'current',
  guildConfig: GuildConfig | null
) {
  const computeTargetSeason = useCallback(() => {
    if (!state.latestSeason) return '1'
    const numeric = parseInt(state.latestSeason, 10)
    if (Number.isNaN(numeric)) return '1'
    return numeric.toString()
  }, [state.latestSeason])

  const targetSeason = computeTargetSeason()

  const pageTitle = 'Current Season Assignments'

  const pageSubtitle = 'Manage boss assignments for the current season'

  const seasonDescriptor = 'current season'

  const primaryTokenValue = Math.max(
    1,
    guildConfig?.primary_assignment_tokens || 5
  )
  const secondaryTokenValue = Math.max(
    0,
    guildConfig?.secondary_assignment_tokens || 2
  )

  return {
    computeTargetSeason,
    targetSeason,
    pageTitle,
    pageSubtitle,
    seasonDescriptor,
    primaryTokenValue,
    secondaryTokenValue
  }
}
