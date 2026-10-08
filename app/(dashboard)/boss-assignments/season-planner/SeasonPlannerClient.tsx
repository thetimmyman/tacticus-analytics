'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { useMemberLabels } from '@/app/hooks/useMemberLabels'
import type { PlanFromNowSnapshot } from '@/app/lib/boss-assignments/season-planner/snapshot-types'
import { summarizeSequenceBudget } from '@/app/lib/season-forecast/boss-feasibility-math'
import type { SeasonConfigInfo } from '@/app/(dashboard)/boss-playbooks/types'
import {
  IANA_TIME_ZONES,
  STAGE_TIMELINE_PAGE_SIZE,
  fetchJson,
  resolveBrowserTimeZone,
  sumSessionTokens
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type {
  GeneratedSeasonPlanPayload,
  RosterEntry,
  RosterStrategyPayload,
  SavedPlanRow,
  SavedPlanSummary,
  ScheduleWindow,
  StrategyRequestBody
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'
import {
  buildGuildPresentationByCode,
  buildLoopTimelineWindow,
  buildPerPlayerTotals,
  buildRawPlanJson,
  buildRosterNameById,
  buildSeasonConfigByNumber,
  buildStageTimelineWindow,
  buildStrategyIncomingGuildOptions,
  filterSessionsWindow,
  filterStrategyAllIncomingMembers,
  filterStrategyIncomingMembers,
  filterStrategyTargetMembers,
  selectDisplayedPlan
} from './planner-derive'
import PlannerHeaderCard from './PlannerHeaderCard'
import PlannerInputsSection from '@/app/(dashboard)/boss-assignments/season-planner/PlannerInputsSection'
import RosterStrategySection from '@/app/(dashboard)/boss-assignments/season-planner/RosterStrategySection'
import SavedPlansCard from '@/app/(dashboard)/boss-assignments/season-planner/SavedPlansCard'
import PlanOutputSection from '@/app/(dashboard)/boss-assignments/season-planner/PlanOutputSection'

interface SeasonPlannerClientProps {
  currentSeasonIndex: number
  allSeasons: SeasonConfigInfo[]
  seasonConfigResolutions?: Array<{
    seasonNumber: number
    configId: string
  }>
  initialSeason?: string
  initialConfigId?: string | null
  /** `config_id` is sent only when the target differs from this, not the detected config. */
  liveConfigId?: string | null
  /** Edit access. When false "Save Plan" is hidden and savePlan no-ops. */
  canEdit?: boolean
  desktopMode?: boolean
  savedSeasons?: string[]
}

export default function SeasonPlannerClient({
  allSeasons,
  seasonConfigResolutions = [],
  initialSeason,
  initialConfigId,
  liveConfigId,
  canEdit = false,
  desktopMode = false,
  savedSeasons = []
}: SeasonPlannerClientProps) {
  const hasMounted = useHasMounted()
  const { labelFor } = useMemberLabels()
  const [selectedSeasonConfig, setSelectedSeasonConfig] = useState<string>(
    initialConfigId ?? 'current'
  )
  const [detectedConfigId, setDetectedConfigId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<PlanFromNowSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(true)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterEntry[]>([])

  const [season, setSeason] = useState<string>(initialSeason ?? '')
  const [planningSnapshotAt, setPlanningSnapshotAt] = useState('')
  const planningSnapshotAtRef = useRef('')
  const setSnapshotAt = useCallback((value: string) => {
    planningSnapshotAtRef.current = value
    setPlanningSnapshotAt(value)
  }, [])
  const [lookbackDays, setLookbackDays] = useState(30)
  const [sessionsPerDay, setSessionsPerDay] = useState(1)
  const [timeZone, setTimeZone] = useState('UTC')
  const seasonConfigByNumber = useMemo(
    () => buildSeasonConfigByNumber(seasonConfigResolutions),
    [seasonConfigResolutions]
  )

  const [plan, setPlan] = useState<GeneratedSeasonPlanPayload | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const [savedPlans, setSavedPlans] = useState<SavedPlanSummary[]>([])
  const [savedPlansLoading, setSavedPlansLoading] = useState(false)
  const [savedPlansError, setSavedPlansError] = useState<string | null>(null)
  const [activeSavedPlanId, setActiveSavedPlanId] = useState<string | null>(
    null
  )
  const [activeSavedPlan, setActiveSavedPlan] = useState<SavedPlanRow | null>(
    null
  )
  const [loadingSavedPlanId, setLoadingSavedPlanId] = useState<string | null>(
    null
  )

  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  const [showRaw, setShowRaw] = useState(false)
  const [scheduleWindow, setScheduleWindow] = useState<ScheduleWindow>('48h')
  const [showFullStageTimeline, setShowFullStageTimeline] = useState(false)
  const [strategySeasonCount, setStrategySeasonCount] = useState(1)
  const [strategy, setStrategy] = useState<RosterStrategyPayload | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [strategyError, setStrategyError] = useState<string | null>(null)
  const [swapOutgoingPlayerId, setSwapOutgoingPlayerId] = useState('')
  const [swapIncomingPlayerId, setSwapIncomingPlayerId] = useState('')
  const [swapIncomingGuildFilter, setSwapIncomingGuildFilter] = useState('all')
  const [strategyOptimizerRequested, setStrategyOptimizerRequested] =
    useState(false)
  const planRequestIdRef = useRef(0)
  const snapshotRequestIdRef = useRef(0)
  const savedPlansRequestIdRef = useRef(0)
  const savedPlanRequestIdRef = useRef(0)
  const strategyRequestIdRef = useRef(0)

  const clearGeneratedPlanState = useCallback(
    (options?: { clearSnapshot?: boolean }) => {
      planRequestIdRef.current += 1
      savedPlansRequestIdRef.current += 1
      savedPlanRequestIdRef.current += 1
      strategyRequestIdRef.current += 1
      if (options?.clearSnapshot) {
        setEditingPlanId(null)
        snapshotRequestIdRef.current += 1
        setSnapshotLoading(false)
      }
      setSavedPlansLoading(false)
      if (options?.clearSnapshot) {
        setSnapshot(null)
        setRoster([])
      }
      setPlan(null)
      setPlanError(null)
      setPlanLoading(false)
      setActiveSavedPlanId(null)
      setActiveSavedPlan(null)
      setLoadingSavedPlanId(null)
      setSaveError(null)
      setSaveSuccess(null)
      setStrategy(null)
      setStrategyError(null)
      setStrategyLoading(false)
      setSwapOutgoingPlayerId('')
      setSwapIncomingPlayerId('')
      setSwapIncomingGuildFilter('all')
    },
    []
  )

  const loadSnapshot = useCallback(
    async (options?: { configId?: string | null; selectedConfig?: string }) => {
      clearGeneratedPlanState({ clearSnapshot: true })
      const requestId = snapshotRequestIdRef.current + 1
      snapshotRequestIdRef.current = requestId
      savedPlansRequestIdRef.current += 1
      const isCurrentRequest = () => snapshotRequestIdRef.current === requestId
      const selectedConfigForRequest =
        options?.selectedConfig ?? selectedSeasonConfig

      try {
        setSnapshotLoading(true)
        setSnapshotError(null)
        setSavedPlans([])
        setSavedPlansError(null)
        setSavedPlansLoading(false)

        const params = new URLSearchParams()
        if (season) params.set('season', season)
        if (desktopMode && planningSnapshotAtRef.current)
          params.set('snapshot_at', planningSnapshotAtRef.current)
        const configToUse =
          options && 'configId' in options
            ? options.configId
            : selectedConfigForRequest !== 'current'
              ? selectedConfigForRequest
              : null
        if (configToUse) params.set('config_id', configToUse)
        const query = params.toString() ? `?${params.toString()}` : ''

        const data = await fetchJson<{
          snapshot: PlanFromNowSnapshot
          roster?: RosterEntry[]
          detectedConfigId?: string
        }>(`/api/guild-raid/season-plan/snapshot${query}`)

        if (!isCurrentRequest()) return
        setSnapshot(data.snapshot)
        setSeason(data.snapshot.season || '')
        setRoster(Array.isArray(data.roster) ? data.roster : [])

        if (data.detectedConfigId && selectedConfigForRequest === 'current') {
          setDetectedConfigId(data.detectedConfigId)
          setSelectedSeasonConfig(data.detectedConfigId)
        }
      } catch (err) {
        if (!isCurrentRequest()) return
        setSnapshotError(
          err instanceof Error ? err.message : 'Failed to load snapshot'
        )
        setSnapshot(null)
        setRoster([])
      } finally {
        if (isCurrentRequest()) {
          setSnapshotLoading(false)
        }
      }
    },
    [clearGeneratedPlanState, season, selectedSeasonConfig, desktopMode]
  )

  const loadSavedPlans = useCallback(
    async (seasonId: string) => {
      const requestId = savedPlansRequestIdRef.current + 1
      savedPlansRequestIdRef.current = requestId
      const isCurrentRequest = () =>
        savedPlansRequestIdRef.current === requestId

      try {
        setSavedPlansLoading(true)
        setSavedPlansError(null)

        const data = await fetchJson<{ plans: SavedPlanSummary[] }>(
          `/api/guild-raid/season-plan?season_id=${encodeURIComponent(seasonId)}${desktopMode ? `&season=${encodeURIComponent(season)}` : ''}`
        )
        if (!isCurrentRequest()) return
        setSavedPlans(Array.isArray(data.plans) ? data.plans : [])
      } catch (err) {
        if (!isCurrentRequest()) return
        setSavedPlansError(
          err instanceof Error ? err.message : 'Failed to load saved plans'
        )
        setSavedPlans([])
      } finally {
        if (isCurrentRequest()) {
          setSavedPlansLoading(false)
        }
      }
    },
    [desktopMode, season]
  )

  const loadSavedPlan = useCallback(
    async (planId: string, edit = false) => {
      const requestId = savedPlanRequestIdRef.current + 1
      savedPlanRequestIdRef.current = requestId
      const isCurrentRequest = () => savedPlanRequestIdRef.current === requestId

      try {
        planRequestIdRef.current += 1
        setLoadingSavedPlanId(planId)
        setActiveSavedPlanId(null)
        setActiveSavedPlan(null)
        setPlan(null)
        setPlanError(null)
        setPlanLoading(false)
        setSaveError(null)
        setSaveSuccess(null)
        strategyRequestIdRef.current += 1
        setStrategy(null)
        setStrategyError(null)
        setStrategyLoading(false)
        setSwapOutgoingPlayerId('')
        setSwapIncomingPlayerId('')
        setSwapIncomingGuildFilter('all')
        const data = await fetchJson<{ plan: SavedPlanRow }>(
          `/api/guild-raid/season-plan?id=${encodeURIComponent(planId)}`
        )
        if (!isCurrentRequest()) return
        if (desktopMode && edit && data.plan && canEdit) {
          const generated = selectDisplayedPlan(data.plan.plan, null)
          if (!generated) throw new Error('Saved plan payload is unavailable')
          setPlan(generated)
          setEditingPlanId(planId)
          setLookbackDays(generated.lookback_days)
          setSessionsPerDay(generated.sessions_per_day)
          setTimeZone(generated.time_zone)
          setSnapshotAt(generated.snapshot_at)
        } else {
          setEditingPlanId(null)
          setActiveSavedPlan(data.plan ?? null)
          setActiveSavedPlanId(data.plan ? planId : null)
        }
      } catch (err) {
        if (!isCurrentRequest()) return
        setSavedPlansError(
          err instanceof Error ? err.message : 'Failed to load plan details'
        )
        setActiveSavedPlan(null)
        setActiveSavedPlanId(null)
      } finally {
        if (isCurrentRequest()) {
          setLoadingSavedPlanId(null)
        }
      }
    },
    [desktopMode, canEdit, setSnapshotAt]
  )

  const generatePlan = useCallback(async () => {
    if (desktopMode && !canEdit) return
    const requestId = planRequestIdRef.current + 1
    planRequestIdRef.current = requestId
    const isCurrentRequest = () => planRequestIdRef.current === requestId

    try {
      savedPlanRequestIdRef.current += 1
      setPlanLoading(true)
      setPlanError(null)
      setPlan(null)
      setActiveSavedPlanId(null)
      setActiveSavedPlan(null)
      setLoadingSavedPlanId(null)
      setSaveError(null)
      setSaveSuccess(null)
      strategyRequestIdRef.current += 1
      setStrategy(null)
      setStrategyError(null)
      setStrategyLoading(false)
      setSwapOutgoingPlayerId('')
      setSwapIncomingPlayerId('')
      setSwapIncomingGuildFilter('all')

      const params = new URLSearchParams()
      if (season) params.set('season', season)
      if (desktopMode && planningSnapshotAtRef.current)
        params.set('snapshot_at', planningSnapshotAtRef.current)
      params.set('lookback_days', String(lookbackDays))
      params.set('sessions_per_day', String(sessionsPerDay))
      if (timeZone) params.set('time_zone', timeZone)
      // /season has no live anchor, so compare against the detected config there.
      const liveConfigForCompare = liveConfigId ?? detectedConfigId
      if (
        selectedSeasonConfig !== 'current' &&
        selectedSeasonConfig !== liveConfigForCompare
      ) {
        params.set('config_id', selectedSeasonConfig)
      }

      const data = await fetchJson<GeneratedSeasonPlanPayload>(
        `/api/guild-raid/season-plan/generate?${params.toString()}`
      )
      if (!isCurrentRequest()) return
      setPlan(data)
      setTimeZone(data.time_zone || timeZone)
    } catch (err) {
      if (!isCurrentRequest()) return
      setPlanError(
        err instanceof Error ? err.message : 'Failed to generate plan'
      )
      setPlan(null)
    } finally {
      if (isCurrentRequest()) {
        setPlanLoading(false)
      }
    }
  }, [
    lookbackDays,
    season,
    sessionsPerDay,
    timeZone,
    selectedSeasonConfig,
    detectedConfigId,
    liveConfigId,
    desktopMode,
    canEdit
  ])

  const displayedPlanSnapshotAt =
    (activeSavedPlan?.plan as GeneratedSeasonPlanPayload | undefined)
      ?.snapshot_at ||
    plan?.snapshot_at ||
    snapshot?.snapshotAt ||
    null

  const runRosterStrategy = useCallback(
    async (options: { includeOptimizer: boolean }) => {
      if (!displayedPlanSnapshotAt) {
        setStrategyError(
          'Load a roster snapshot before running roster strategy.'
        )
        setStrategy(null)
        return
      }
      const requestId = strategyRequestIdRef.current + 1
      strategyRequestIdRef.current = requestId
      const isCurrentRequest = () => strategyRequestIdRef.current === requestId
      const selectedSwap =
        strategy &&
        !options.includeOptimizer &&
        swapOutgoingPlayerId &&
        swapIncomingPlayerId
          ? {
              outgoingPlayerId: swapOutgoingPlayerId,
              incomingPlayerId: swapIncomingPlayerId
            }
          : null
      const keepRosterVisibleForSwap =
        Boolean(strategy) && Boolean(selectedSwap) && !options.includeOptimizer

      try {
        setStrategyLoading(true)
        setStrategyError(null)
        setStrategyOptimizerRequested(options.includeOptimizer)
        if (keepRosterVisibleForSwap) {
          setStrategy((current) =>
            current?.swap
              ? {
                  ...current,
                  swap: null
                }
              : current
          )
        } else {
          setStrategy(null)
          setSwapOutgoingPlayerId('')
          setSwapIncomingPlayerId('')
          setSwapIncomingGuildFilter('all')
        }

        const configId =
          selectedSeasonConfig !== 'current' ? selectedSeasonConfig : null

        const buildBody = (
          swap: {
            outgoingPlayerId: string
            incomingPlayerId: string
          } | null
        ): StrategyRequestBody => {
          const body: StrategyRequestBody = {
            season: season || undefined,
            snapshot_at: displayedPlanSnapshotAt || undefined,
            lookback_days: lookbackDays,
            sessions_per_day: sessionsPerDay,
            time_zone: timeZone,
            season_count: strategySeasonCount,
            include_optimizer: options.includeOptimizer,
            include_investments: true
          }
          if (configId) body.config_id = configId
          if (swap) {
            body.swap = {
              outgoing_player_id: swap.outgoingPlayerId,
              incoming_player_id: swap.incomingPlayerId
            }
          }
          return body
        }

        const postStrategy = (body: StrategyRequestBody) =>
          fetchJson<RosterStrategyPayload>(
            '/api/guild-raid/season-plan/roster-strategy',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
          )

        const data = await postStrategy(buildBody(selectedSwap))
        if (!isCurrentRequest()) return
        setStrategy(data)
      } catch (err) {
        if (!isCurrentRequest()) return
        setStrategyError(
          err instanceof Error
            ? err.message
            : 'Failed to generate roster strategy'
        )
        setStrategy(null)
      } finally {
        if (isCurrentRequest()) {
          setStrategyLoading(false)
        }
      }
    },
    [
      displayedPlanSnapshotAt,
      lookbackDays,
      season,
      selectedSeasonConfig,
      sessionsPerDay,
      strategy,
      strategySeasonCount,
      swapIncomingPlayerId,
      swapOutgoingPlayerId,
      timeZone
    ]
  )

  const clearSwapResult = useCallback(() => {
    strategyRequestIdRef.current += 1
    setStrategyLoading(false)
    setStrategyError(null)
    setStrategy((current) =>
      current?.swap
        ? {
            ...current,
            swap: null
          }
        : current
    )
  }, [])

  const savePlan = useCallback(async () => {
    // AUTH-CRITICAL read-only gate: members never persist saved plans.
    if (!canEdit) return
    try {
      setSaveLoading(true)
      setSaveError(null)
      setSaveSuccess(null)

      if (!plan?.season_id) {
        throw new Error('Missing season_id; generate a plan first.')
      }

      const res = await fetchJson<{ success: boolean; id: string }>(
        '/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(desktopMode && editingPlanId ? { id: editingPlanId } : {}),
            season_id: plan.season_id,
            start_at: plan.season_start_at,
            end_at: plan.season_end_at,
            snapshot_at: plan.snapshot_at,
            kind: 'replan',
            trigger: 'ui_generate',
            plan
          })
        }
      )

      setSaveSuccess(`Saved plan ${res.id}`)
      if (snapshot?.seasonId) {
        await loadSavedPlans(snapshot.seasonId)
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save plan')
    } finally {
      setSaveLoading(false)
    }
  }, [
    canEdit,
    desktopMode,
    editingPlanId,
    loadSavedPlans,
    plan,
    snapshot?.seasonId
  ])

  const deleteSavedPlan = useCallback(
    async (id: string) => {
      if (!canEdit) return
      setDeletingPlanId(id)
      setSavedPlansError(null)
      try {
        await fetchJson(
          `/api/guild-raid/season-plan?id=${encodeURIComponent(id)}`,
          { method: 'DELETE' }
        )
        setSavedPlans((current) => current.filter((row) => row.id !== id))
        if (activeSavedPlanId === id) {
          setActiveSavedPlanId(null)
          setActiveSavedPlan(null)
        }
        if (editingPlanId === id) {
          setEditingPlanId(null)
          setPlan(null)
        }
      } catch (error) {
        setSavedPlansError(
          error instanceof Error ? error.message : 'Plan deletion refused'
        )
      } finally {
        setDeletingPlanId(null)
      }
    },
    [canEdit, activeSavedPlanId, editingPlanId]
  )

  // Seed from the browser zone once; guild_config.timezone takes over after a plan is generated.
  useEffect(() => {
    const browserZone = resolveBrowserTimeZone()
    if (browserZone) setTimeZone(browserZone)
  }, [])

  useEffect(() => {
    if (desktopMode && !canEdit) {
      setSnapshotLoading(false)
      return
    }
    void loadSnapshot()
  }, [loadSnapshot, desktopMode, canEdit])

  // Keep the active zone selectable even if the runtime does not list it.
  const timeZoneOptions = useMemo(
    () => Array.from(new Set([timeZone, ...IANA_TIME_ZONES])).filter(Boolean),
    [timeZone]
  )

  const strategyTargetMembers = useMemo(
    () => filterStrategyTargetMembers(strategy),
    [strategy]
  )

  const strategyAllIncomingMembers = useMemo(
    () => filterStrategyAllIncomingMembers(strategy),
    [strategy]
  )

  const guildPresentationByCode = useMemo(
    () => buildGuildPresentationByCode(strategy),
    [strategy]
  )

  const guildLabel = useCallback(
    (guildCode: string): string =>
      guildPresentationByCode.get(guildCode)?.label ?? 'Cluster guild',
    [guildPresentationByCode]
  )

  const strategyIncomingGuildOptions = useMemo(
    () =>
      buildStrategyIncomingGuildOptions(
        strategy,
        strategyAllIncomingMembers,
        guildPresentationByCode
      ),
    [guildPresentationByCode, strategy, strategyAllIncomingMembers]
  )

  const strategyIncomingMembers = useMemo(
    () =>
      filterStrategyIncomingMembers(
        strategyAllIncomingMembers,
        swapIncomingGuildFilter
      ),
    [strategyAllIncomingMembers, swapIncomingGuildFilter]
  )

  useEffect(() => {
    if (!strategy) return
    if (
      swapIncomingGuildFilter !== 'all' &&
      !strategyIncomingGuildOptions.some(
        (option) => option.guildCode === swapIncomingGuildFilter
      )
    ) {
      setSwapIncomingGuildFilter('all')
      return
    }

    if (
      strategyTargetMembers[0] &&
      !strategyTargetMembers.some(
        (member) => member.playerId === swapOutgoingPlayerId
      )
    ) {
      setSwapOutgoingPlayerId(strategyTargetMembers[0].playerId)
    }
    if (
      strategyIncomingMembers[0] &&
      !strategyIncomingMembers.some(
        (member) => member.playerId === swapIncomingPlayerId
      )
    ) {
      setSwapIncomingPlayerId(strategyIncomingMembers[0].playerId)
    }
    if (strategyIncomingMembers.length === 0 && swapIncomingPlayerId) {
      setSwapIncomingPlayerId('')
    }
  }, [
    strategy,
    strategyIncomingGuildOptions,
    strategyIncomingMembers,
    strategyTargetMembers,
    swapIncomingGuildFilter,
    swapIncomingPlayerId,
    swapOutgoingPlayerId
  ])

  const swapSimulationUnavailable =
    Boolean(strategy) &&
    (strategyTargetMembers.length === 0 ||
      strategyIncomingMembers.length === 0 ||
      !swapOutgoingPlayerId ||
      !swapIncomingPlayerId)

  useEffect(() => {
    const seasonId = desktopMode
      ? seasonConfigByNumber.get(Number(season))
      : snapshot?.seasonId
    if (seasonId) void loadSavedPlans(seasonId)
  }, [
    loadSavedPlans,
    snapshot?.seasonId,
    desktopMode,
    seasonConfigByNumber,
    season
  ])

  const displayedPlan = useMemo(
    () => selectDisplayedPlan(activeSavedPlan?.plan, plan),
    [activeSavedPlan?.plan, plan]
  )

  const metrics = displayedPlan?.plan?.metrics ?? null
  // Officer-budget rollup; null unless some stage has an officer target.
  const sequenceBudget = useMemo(
    () =>
      displayedPlan?.remainingBossSequence
        ? summarizeSequenceBudget(displayedPlan.remainingBossSequence)
        : null,
    [displayedPlan?.remainingBossSequence]
  )
  const warnings = displayedPlan?.plan?.warnings ?? []
  const sessions = useMemo(
    () => displayedPlan?.plan?.sessions ?? [],
    [displayedPlan?.plan?.sessions]
  )

  const rosterNameById = useMemo(() => buildRosterNameById(roster), [roster])

  const sessionsWindow = useMemo(
    () => filterSessionsWindow(displayedPlan, scheduleWindow, sessions),
    [displayedPlan, scheduleWindow, sessions]
  )

  const stageTimelineWindow = useMemo(
    () =>
      buildStageTimelineWindow(
        displayedPlan,
        sessions,
        rosterNameById,
        scheduleWindow
      ),
    [displayedPlan, rosterNameById, scheduleWindow, sessions]
  )

  const loopTimelineWindow = useMemo(
    () => buildLoopTimelineWindow(stageTimelineWindow),
    [stageTimelineWindow]
  )

  const visibleStageTimeline = useMemo(() => {
    if (scheduleWindow !== 'all') return stageTimelineWindow
    if (showFullStageTimeline) return stageTimelineWindow
    return stageTimelineWindow.slice(0, STAGE_TIMELINE_PAGE_SIZE)
  }, [scheduleWindow, showFullStageTimeline, stageTimelineWindow])

  const stageTimelineTruncated =
    scheduleWindow === 'all' &&
    !showFullStageTimeline &&
    stageTimelineWindow.length > visibleStageTimeline.length

  const perPlayer = useMemo(
    () => buildPerPlayerTotals(sessions, rosterNameById),
    [rosterNameById, sessions]
  )

  const totalTokens = useMemo(() => sumSessionTokens(sessions), [sessions])

  const rawPlanJson = useMemo(
    () => buildRawPlanJson(showRaw, displayedPlan, rosterNameById),
    [displayedPlan, rosterNameById, showRaw]
  )

  const investmentRows = useMemo(
    () => strategy?.investments.slice(0, 40) ?? [],
    [strategy]
  )

  return (
    <div className="space-y-6">
      <PlannerHeaderCard />
      {desktopMode && (
        <p role="status" className="text-sm text-secondary-wh40k">
          Saved season inputs and captured boss configuration. Calculations run
          locally; no live API request.
          {!canEdit &&
            ' Members can load saved plans. Current officers and leaders can generate and edit plans.'}
        </p>
      )}

      <PlannerInputsSection
        desktopMode={desktopMode}
        savedSeasons={savedSeasons}
        editingPlanId={editingPlanId}
        planningSnapshotAt={planningSnapshotAt}
        setSnapshotAt={setSnapshotAt}
        snapshot={snapshot}
        snapshotLoading={snapshotLoading}
        snapshotError={snapshotError}
        loadSnapshot={loadSnapshot}
        clearGeneratedPlanState={clearGeneratedPlanState}
        selectedSeasonConfig={selectedSeasonConfig}
        setSelectedSeasonConfig={setSelectedSeasonConfig}
        allSeasons={allSeasons}
        detectedConfigId={detectedConfigId}
        season={season}
        setSeason={setSeason}
        liveConfigId={liveConfigId}
        seasonConfigByNumber={seasonConfigByNumber}
        lookbackDays={lookbackDays}
        setLookbackDays={setLookbackDays}
        sessionsPerDay={sessionsPerDay}
        setSessionsPerDay={setSessionsPerDay}
        timeZone={timeZone}
        setTimeZone={setTimeZone}
        timeZoneOptions={timeZoneOptions}
        generatePlan={generatePlan}
        planLoading={planLoading}
        loadingSavedPlanId={loadingSavedPlanId}
        canEdit={canEdit}
        savePlan={savePlan}
        saveLoading={saveLoading}
        plan={plan}
        showRaw={showRaw}
        setShowRaw={setShowRaw}
        planError={planError}
        saveError={saveError}
        saveSuccess={saveSuccess}
      />

      {canEdit && !desktopMode && (
        <RosterStrategySection
          strategySeasonCount={strategySeasonCount}
          setStrategySeasonCount={setStrategySeasonCount}
          strategyRequestIdRef={strategyRequestIdRef}
          setStrategy={setStrategy}
          setStrategyError={setStrategyError}
          setStrategyLoading={setStrategyLoading}
          setSwapOutgoingPlayerId={setSwapOutgoingPlayerId}
          setSwapIncomingPlayerId={setSwapIncomingPlayerId}
          setSwapIncomingGuildFilter={setSwapIncomingGuildFilter}
          runRosterStrategy={runRosterStrategy}
          strategyLoading={strategyLoading}
          snapshotLoading={snapshotLoading}
          displayedPlanSnapshotAt={displayedPlanSnapshotAt}
          swapSimulationUnavailable={swapSimulationUnavailable}
          loadingSavedPlanId={loadingSavedPlanId}
          strategyOptimizerRequested={strategyOptimizerRequested}
          strategy={strategy}
          strategyError={strategyError}
          guildLabel={guildLabel}
          labelFor={labelFor}
          strategyTargetMembers={strategyTargetMembers}
          strategyAllIncomingMembers={strategyAllIncomingMembers}
          strategyIncomingGuildOptions={strategyIncomingGuildOptions}
          strategyIncomingMembers={strategyIncomingMembers}
          swapOutgoingPlayerId={swapOutgoingPlayerId}
          swapIncomingPlayerId={swapIncomingPlayerId}
          swapIncomingGuildFilter={swapIncomingGuildFilter}
          clearSwapResult={clearSwapResult}
          investmentRows={investmentRows}
        />
      )}

      <SavedPlansCard
        canEdit={desktopMode && canEdit}
        deleteSavedPlan={deleteSavedPlan}
        deletingPlanId={deletingPlanId}
        editSavedPlan={(id) => loadSavedPlan(id, true)}
        savedPlans={savedPlans}
        savedPlansLoading={savedPlansLoading}
        savedPlansError={savedPlansError}
        snapshotSeasonId={
          snapshot?.seasonId ??
          (desktopMode
            ? (seasonConfigByNumber.get(Number(season)) ?? null)
            : null)
        }
        loadSavedPlans={loadSavedPlans}
        loadSavedPlan={loadSavedPlan}
        loadingSavedPlanId={loadingSavedPlanId}
        activeSavedPlanId={activeSavedPlanId}
        timeZone={timeZone}
        hasMounted={hasMounted}
      />

      <PlanOutputSection
        scheduleWindow={scheduleWindow}
        setScheduleWindow={setScheduleWindow}
        displayedPlan={displayedPlan}
        metrics={metrics}
        sequenceBudget={sequenceBudget}
        warnings={warnings}
        totalTokens={totalTokens}
        loopTimelineWindow={loopTimelineWindow}
        stageTimelineWindow={stageTimelineWindow}
        visibleStageTimeline={visibleStageTimeline}
        stageTimelineTruncated={stageTimelineTruncated}
        showFullStageTimeline={showFullStageTimeline}
        setShowFullStageTimeline={setShowFullStageTimeline}
        perPlayer={perPlayer}
        sessionsWindow={sessionsWindow}
        rosterNameById={rosterNameById}
        rawPlanJson={rawPlanJson}
        showRaw={showRaw}
        timeZone={timeZone}
        hasMounted={hasMounted}
        labelFor={labelFor}
      />
    </div>
  )
}
