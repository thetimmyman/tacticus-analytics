'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BossAssignmentsHeader } from '../../boss-assignments/components/BossAssignmentsHeader'
import type { UpcomingAssignmentsClientProps } from './types'
import {
  useAssignmentState,
  useComputedValues
} from './hooks/useAssignmentState'
import { useBossData } from './hooks/useBossData'
import { usePlayerData, useSavedAssignmentsLoader } from './hooks/usePlayerData'
import { useCurrentBossStatus } from './hooks/useCurrentBossStatus'
import { useCurrentBossAttacks } from './hooks/useCurrentBossAttacks'
import { useGuildTokenAvailability } from './hooks/useGuildTokenAvailability'
import { useAutoSave } from './hooks/useAutoSave'
import { useQueueData } from './hooks/useQueueData'
import { useCurrentBossRows } from './hooks/useCurrentBossRows'
import { useLiveAttackReconciliation } from './hooks/useLiveAttackReconciliation'
import { useAllocationMigration } from './hooks/useAllocationMigration'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import {
  CurrentBossAssignmentsPanel,
  type CurrentBossAssignmentRow
} from './components/CurrentBossAssignmentsPanel'
import { QueueViewPanel } from './components/QueueViewPanel'
import { AssignmentFAQ } from './components/AssignmentFAQ'
import { InlineAlert } from '@/app/components/ui/InlineAlert'
import { EmptyState } from '@tacticus/ui-kit'
import { Spinner } from '@tacticus/ui-kit'
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog'
import { Radio } from 'lucide-react'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import './upcoming-assignments.css'

export type { UpcomingAssignmentsClientProps }

// Only save transitions toast; `saveMessage` also carries load provenance ("Loaded from ...").
function isSaveResultMessage(message: string): boolean {
  if (!message) return false
  return !/^Loaded from /i.test(message)
}

function UpcomingAssignmentsClient({
  initialProfile,
  initialPerformanceData,
  initialTokenPerformanceData,
  initialLatestSeason,
  initialPrimeHpData,
  initialBossHpData,
  guildConfig,
  mode = 'current',
  canEdit = false,
  lokiCurrentBosses,
  progressionConfig,
  initialHeraldBossConfigs = []
}: UpcomingAssignmentsClientProps) {
  const [state, actions] = useAssignmentState(
    initialPerformanceData,
    initialLatestSeason,
    initialPrimeHpData,
    initialBossHpData,
    initialTokenPerformanceData
  )

  const {
    computeTargetSeason,
    targetSeason,
    pageTitle,
    pageSubtitle,
    seasonDescriptor,
    primaryTokenValue,
    secondaryTokenValue
  } = useComputedValues(state, mode, guildConfig)

  const [showAssignmentFAQ, setShowAssignmentFAQ] = useState(false)

  const {
    data: queueViewData,
    loading: queueLoading,
    error: queueError,
    isStale: queueIsStale,
    fetchQueue
  } = useQueueData()

  const guildCode = initialProfile.guild_code ?? ''

  const avatarMap = useMemo(() => {
    const map = new Map<string, string | null>()
    state.players.forEach((p) => {
      map.set(p.player_id, p.avatar_unit_id ?? null)
    })
    return map
  }, [state.players])

  const currentBossStatusQuery = useCurrentBossStatus({
    guildCode: initialProfile.guild_code ?? '',
    seasonNumber: targetSeason,
    progressionConfig,
    enabled: mode === 'current' && Boolean(initialProfile.guild_code)
  })

  const tokenAvailabilityQuery = useGuildTokenAvailability({
    guildCode: initialProfile.guild_code ?? '',
    seasonNumber: targetSeason,
    enabled: mode === 'current' && Boolean(initialProfile.guild_code)
  })

  const tokenStatusByPlayerId = useMemo(
    () =>
      tokenAvailabilityQuery.data ??
      new Map<
        string,
        {
          tokensAvailable: number
          tokenCooldown: string | null
          nextTokenSeconds: number | null
        }
      >(),
    [tokenAvailabilityQuery.data]
  )

  const currentStageCode =
    mode === 'current' ? (currentBossStatusQuery.data?.stageCode ?? null) : null
  const currentLoopIndex =
    mode === 'current' ? (currentBossStatusQuery.data?.loopIndex ?? null) : null
  const currentBossAdvancedStage =
    mode === 'current'
      ? (currentBossStatusQuery.data?.advancedStage ?? false)
      : false

  const currentBossHp = useMemo(() => {
    if (mode !== 'current' || !currentStageCode) {
      return {
        remainingHp: null as number | null,
        maxHp: null as number | null
      }
    }

    if (!currentBossAdvancedStage) {
      return {
        remainingHp: currentBossStatusQuery.data?.remainingHp ?? null,
        maxHp: currentBossStatusQuery.data?.maxHp ?? null
      }
    }

    const prefix = currentStageCode[0]?.toUpperCase()
    const maxHp =
      prefix === 'M'
        ? typeof initialBossHpData?.mythic?.[currentStageCode] === 'number'
          ? initialBossHpData.mythic[currentStageCode]
          : null
        : typeof initialBossHpData?.legendary?.[currentStageCode] === 'number'
          ? initialBossHpData.legendary[currentStageCode]
          : null

    return { remainingHp: maxHp, maxHp }
  }, [
    currentBossAdvancedStage,
    currentBossStatusQuery.data?.maxHp,
    currentBossStatusQuery.data?.remainingHp,
    currentStageCode,
    initialBossHpData?.legendary,
    initialBossHpData?.mythic,
    mode
  ])

  const lokiMainBoss = useMemo(() => {
    if (mode !== 'current') return null
    const bosses = lokiCurrentBosses ?? []
    const fallback = bosses.find((boss) => boss.encounter_id === 0) ?? null
    if (!currentStageCode) return fallback

    const match =
      bosses.find(
        (boss) =>
          boss.encounter_id === 0 &&
          deriveStageCodeFromSetAndRarity(boss.set, boss.rarity) ===
            currentStageCode
      ) ?? null

    return match ?? fallback
  }, [currentStageCode, lokiCurrentBosses, mode])

  const currentBossName = useMemo(() => {
    if (mode !== 'current' || !currentStageCode) return null
    // Always from Loki rotation data, not state.selectedBosses, so the header is never stale.
    return (
      lokiMainBoss?.boss_type ??
      currentBossStatusQuery.data?.bossNameFromData ??
      null
    )
  }, [
    currentBossStatusQuery.data?.bossNameFromData,
    currentStageCode,
    lokiMainBoss,
    mode
  ])

  // Curated name for the header; currentBossName stays the raw boss_type for lookups.
  const headerTitle =
    mode === 'current' && currentBossName
      ? getBossDisplayName(currentBossName)
      : pageTitle
  const headerSubtitle =
    mode === 'current' && currentBossName && currentStageCode
      ? `Loop ${typeof currentLoopIndex === 'number' ? currentLoopIndex : 0} · ${currentStageCode}`
      : pageSubtitle

  useBossData(
    state,
    actions,
    initialProfile.guild_code ?? '',
    mode,
    targetSeason,
    lokiCurrentBosses
  )
  usePlayerData(
    state,
    actions,
    initialProfile.guild_code ?? '',
    computeTargetSeason,
    mode,
    primaryTokenValue,
    secondaryTokenValue
  )
  useSavedAssignmentsLoader(
    state,
    actions,
    initialProfile.guild_code ?? '',
    computeTargetSeason,
    mode
  )

  const { autoSave, clearAssignments } = useAutoSave(
    state,
    actions,
    initialProfile.guild_code ?? '',
    initialProfile.cluster_code ?? undefined,
    computeTargetSeason,
    primaryTokenValue,
    secondaryTokenValue,
    mode,
    canEdit
  )

  const queueAutoFetchedRef = useRef(false)
  useEffect(() => {
    if (!queueViewData && !queueLoading && !queueAutoFetchedRef.current) {
      queueAutoFetchedRef.current = true
      fetchQueue(mode, targetSeason).catch(() => {})
    }
  }, [queueViewData, queueLoading, fetchQueue, mode, targetSeason])

  const currentBossAttacksQuery = useCurrentBossAttacks({
    guildCode: initialProfile.guild_code ?? '',
    seasonNumber: targetSeason,
    stageCode: currentStageCode ?? 'M1',
    loopIndex: typeof currentLoopIndex === 'number' ? currentLoopIndex : 0,
    enabled:
      mode === 'current' &&
      Boolean(initialProfile.guild_code) &&
      typeof currentStageCode === 'string' &&
      currentStageCode.length > 0 &&
      typeof currentLoopIndex === 'number'
  })

  const currentBossRows: CurrentBossAssignmentRow[] = useCurrentBossRows({
    mode,
    currentStageCode,
    currentLoopIndex,
    currentBossName,
    currentBossHp,
    lokiCurrentBosses,
    currentBossStatusQuery,
    currentBossAttacksQuery,
    tokenStatusByPlayerId,
    state,
    queueViewData,
    initialBossHpData,
    initialHeraldBossConfigs
  })

  useLiveAttackReconciliation({
    canEdit,
    mode,
    currentStageCode,
    actions,
    currentBossRows,
    autoSave
  })

  useAllocationMigration(state, actions)

  if (state.loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Spinner
            size="lg"
            className="mx-auto mb-4 h-12 w-12 text-amber-400"
          />
          <p className="text-amber-100/60">Loading boss data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BossAssignmentsHeader
        pageTitle={headerTitle}
        pageSubtitle={headerSubtitle}
      />

      {/* Queue is computed automatically; point officers to per-boss targets. */}
      <InlineAlert tone="info" role="status">
        {canEdit
          ? 'This assignment queue is computed automatically — adjust per-boss targets and skips on the Targets tab.'
          : 'This assignment queue is computed automatically. Per-boss targets and skips are managed on the Targets tab.'}
      </InlineAlert>

      {mode === 'current' &&
        // Gate on `hasData`: stage/loop fall back to truthy 'M1'/0 on an unsynced guild.
        (currentBossStatusQuery.data?.hasData &&
        currentStageCode &&
        typeof currentLoopIndex === 'number' ? (
          <CurrentBossAssignmentsPanel
            stageCode={currentStageCode}
            loopIndex={currentLoopIndex}
            remainingHp={currentBossHp.remainingHp}
            maxHp={currentBossHp.maxHp}
            rows={currentBossRows}
            snapshotAt={currentBossStatusQuery.data?.snapshotAt ?? null}
            bossName={currentBossName ?? null}
            avatarMap={avatarMap}
            guildCode={guildCode}
          />
        ) : currentBossStatusQuery.isLoading ? (
          <div className="flex items-center justify-center rounded-lg border border-[var(--card-border)] bg-card/40 p-8">
            <Spinner size="md" label="Loading live boss" />
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-8">
            <EmptyState
              icon={Radio}
              title="Waiting for this season's live boss"
            >
              We haven&apos;t seen this season&apos;s live boss data yet. Sync
              your guild to populate the live queue.
            </EmptyState>
          </div>
        ))}

      {/* Excluded bosses come from `boss_target_tokens.skip` on the Targets page. */}
      <QueueViewPanel
        data={queueViewData}
        loading={queueLoading}
        error={queueError}
        isStale={queueIsStale}
        onRefresh={() => fetchQueue(mode, targetSeason)}
        avatarMap={avatarMap}
        guildCode={guildCode}
        tokenPerformance={state.tokenPerformance}
        performanceData={state.performanceData}
        hideCurrentStageCard={mode === 'current' && Boolean(currentStageCode)}
      />

      {/* Edit control: never mounted for read-only members. */}
      {canEdit && (
        <ConfirmDialog
          open={state.showClearConfirm}
          title="Clear All Assignments?"
          description={
            <>
              This will remove all boss selections and player assignments for
              the {seasonDescriptor}. This action cannot be undone.
            </>
          }
          confirmLabel="Clear All Assignments"
          busyLabel="Clearing..."
          busy={state.clearing}
          onCancel={() => actions.setShowClearConfirm(false)}
          onConfirm={clearAssignments}
        />
      )}

      <AssignmentFAQ
        show={showAssignmentFAQ}
        setShow={setShowAssignmentFAQ}
        seasonDescriptor={seasonDescriptor}
      />

      {/* Auto-save status toast; writer-only. */}
      {canEdit && (state.saving || isSaveResultMessage(state.saveMessage)) && (
        <div className="fixed bottom-4 right-4 z-50 max-w-xs">
          <InlineAlert
            tone={
              state.saving
                ? 'info'
                : /fail/i.test(state.saveMessage)
                  ? 'danger'
                  : state.saveMessage.endsWith('...')
                    ? 'info'
                    : 'success'
            }
            role="status"
          >
            {state.saving ? 'Saving…' : state.saveMessage}
          </InlineAlert>
        </div>
      )}
    </div>
  )
}

export default React.memo(UpcomingAssignmentsClient)
