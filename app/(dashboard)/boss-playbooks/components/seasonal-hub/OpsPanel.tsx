'use client'

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Link from 'next/link'
import {
  CORNER_STACK_MOBILE_CLEARANCE_CLASS,
  CORNER_STACK_RIGHT_GUTTER_CLASS
} from '@/app/components/ui/corner-stack'
import { Activity, ArrowUpRight, Loader2, Save } from 'lucide-react'
import clsx from 'clsx'
import {
  clampThreshold,
  persistBossSettings,
  type SideSettingsBaseline
} from '@/app/lib/boss-ops/persistence'
import {
  BehaviourToggle,
  NotesInput,
  OpsCard,
  RoleListInput,
  ThresholdPicker
} from '@/app/components/boss-ops'
import { hasIncompleteRoleRows, primaryRoleId } from '@/app/lib/boss-ops/roles'
import type {
  PingMode,
  SaveStatus,
  SideBehaviour,
  SideState
} from '@/app/lib/boss-ops/encounter-ops-types'
import type {
  SeasonalBossCardData,
  SeasonalBossHubData,
  SeasonalHubRoleEntry
} from '../../seasonal-hub-utils'
import type {
  EncounterMessageState,
  HubBossState,
  MessageIncludeOption,
  ReusableHeraldRole
} from './types'
import { previewCombinedPrimeNotes } from '@/app/lib/boss-ops/combined-prime-notes'
import {
  encounterSectionId,
  extraLinksForMessage,
  linkTargetsFor,
  roleEntriesFromEncounter,
  syncNarrativeInclude,
  targetLabel,
  toggleMessageOption
} from './message-state'
import {
  applyPingModeChange,
  buildHeraldSummary,
  buildInitialBossState,
  deriveInitialPingMode,
  sideFromEncounter
} from './boss-state'
import { OpsSummaryRow, StatusPill } from './encounter-blocks'
import {
  EncounterCommandRow,
  MessageIncludePicker,
  PingModeToggle,
  TargetTokenControl
} from './controls'

export function OpsPanel({
  card,
  data,
  reusableRoles,
  onRememberRoles,
  onDirtyChange
}: {
  card: SeasonalBossCardData
  data: SeasonalBossHubData
  reusableRoles: ReusableHeraldRole[]
  onRememberRoles: (roles: SeasonalHubRoleEntry[]) => void
  /** Lets the hub confirm a remounting switch that would drop edits; `false` on unmount. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [state, setState] = useState<HubBossState>(() =>
    buildInitialBossState(card, data.guildReplayLinkMode ?? 'off')
  )

  // Warn on tab close while edits are unsaved.
  useEffect(() => {
    if (!state.dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [state.dirty])

  useEffect(() => {
    onDirtyChange?.(state.dirty)
  }, [state.dirty, onDirtyChange])
  useEffect(() => {
    return () => onDirtyChange?.(false)
  }, [onDirtyChange])
  // A failed ops read looks empty; saving over it would blank real config, so go read-only.
  const opsLoadFailed = data.opsLoadFailed === true
  const canManageHerald = data.canManageHerald === true && !opsLoadFailed
  const canManageTargets = data.canManageTargets === true && !opsLoadFailed
  // Preview only; `side1_notes` / `side2_notes` stay the source of truth.
  const combinedPrimeNotesPreview = previewCombinedPrimeNotes(
    state.side1?.notes,
    state.side2?.notes
  )

  const patchBoss = (patch: Partial<HubBossState>) => {
    setState((prev) => ({
      ...prev,
      ...patch,
      dirty: true,
      saveStatus: prev.saveStatus === 'error' ? 'idle' : prev.saveStatus,
      editVersion: prev.editVersion + 1
    }))
  }

  const patchSide = (sideKey: 'side1' | 'side2', patch: Partial<SideState>) => {
    setState((prev) => {
      const current = prev[sideKey]
      if (!current) return prev
      const next = { ...current, ...patch }
      const side1 = sideKey === 'side1' ? next : prev.side1
      const side2 = sideKey === 'side2' ? next : prev.side2
      const allSidesSkipped =
        (!side1 || side1.behaviour === 'skip') &&
        (!side2 || side2.behaviour === 'skip')
      const pingMode: PingMode = patch.behaviour
        ? allSidesSkipped
          ? 'skip_all'
          : prev.pingMode === 'skip_all'
            ? 'per_side'
            : prev.pingMode
        : prev.pingMode
      return {
        ...prev,
        [sideKey]: next,
        pingMode,
        dirty: true,
        saveStatus: prev.saveStatus === 'error' ? 'idle' : prev.saveStatus,
        editVersion: prev.editVersion + 1
      }
    })
  }

  const setMainRoles = (roles: SeasonalHubRoleEntry[]) => {
    patchBoss({
      mainRoles: roles,
      mainRole: primaryRoleId(roles)
    })
  }

  const setSideRoles = (
    sideKey: 'side1' | 'side2',
    roles: SeasonalHubRoleEntry[]
  ) => {
    setState((prev) => {
      const current = prev[sideKey]
      if (!current) return prev
      const roleKey = sideKey === 'side1' ? 'side1Roles' : 'side2Roles'
      return {
        ...prev,
        [sideKey]: {
          ...current,
          role: primaryRoleId(roles)
        },
        [roleKey]: roles,
        dirty: true,
        saveStatus: prev.saveStatus === 'error' ? 'idle' : prev.saveStatus,
        editVersion: prev.editVersion + 1
      }
    })
  }

  const setPingMode = (pingMode: PingMode) => {
    setState((prev) => applyPingModeChange(prev, pingMode))
  }

  // Notes persist on "Apply" so edits cannot be lost by skipping "Save ops".
  const setMainNotes = (notes: string) =>
    applyNotesAndSave((prev) => ({
      ...prev,
      mainNotes: notes,
      mainMessage: syncNarrativeInclude(prev.mainMessage, notes)
    }))

  // No combined setter: one box writing both notes would merge two narratives.

  const setSideNotes = (sideKey: 'side1' | 'side2', notes: string) =>
    applyNotesAndSave((prev) => {
      const side = prev[sideKey]
      const message =
        sideKey === 'side1' ? prev.side1Message : prev.side2Message
      if (!side || !message) return prev
      const messagePatch = syncNarrativeInclude(message, notes)
      return {
        ...prev,
        side1: sideKey === 'side1' ? { ...side, notes } : prev.side1,
        side2: sideKey === 'side2' ? { ...side, notes } : prev.side2,
        side1Message: sideKey === 'side1' ? messagePatch : prev.side1Message,
        side2Message: sideKey === 'side2' ? messagePatch : prev.side2Message
      }
    })

  const patchMessage = (
    key: 'mainMessage' | 'side1Message' | 'side2Message',
    patch: Partial<EncounterMessageState>
  ) => {
    setState((prev) => {
      const current = prev[key]
      if (!current) return prev
      const next = { ...current, ...patch }
      return {
        ...prev,
        mainMessage: key === 'mainMessage' ? next : prev.mainMessage,
        side1Message: key === 'side1Message' ? next : prev.side1Message,
        side2Message: key === 'side2Message' ? next : prev.side2Message,
        dirty: true,
        saveStatus: prev.saveStatus === 'error' ? 'idle' : prev.saveStatus,
        editVersion: prev.editVersion + 1
      }
    })
  }

  const toggleMessageInclude = (
    key: 'mainMessage' | 'side1Message' | 'side2Message',
    option: MessageIncludeOption
  ) => {
    setState((prev) => {
      const current = prev[key]
      if (!current) return prev
      const next = toggleMessageOption(current, option)
      const patch: Partial<HubBossState> = {}
      if (key === 'mainMessage') {
        patch.mainMessage = next
      } else if (key === 'side1Message') {
        patch.side1Message = next
      } else {
        patch.side2Message = next
      }
      if (option === 'narrative' && !next.include.includes('narrative')) {
        if (key === 'mainMessage') {
          patch.mainNotes = ''
        } else if (key === 'side1Message' && prev.side1) {
          patch.side1 = { ...prev.side1, notes: '' }
        } else if (key === 'side2Message' && prev.side2) {
          patch.side2 = { ...prev.side2, notes: '' }
        }
      }
      return {
        ...prev,
        ...patch,
        dirty: true,
        saveStatus: prev.saveStatus === 'error' ? 'idle' : prev.saveStatus,
        editVersion: prev.editVersion + 1
      }
    })
  }

  // Side baseline from server truth, advanced after each save. A mount-time baseline
  // would make Skip → Save → Kill → Save compare 'kill' to 'kill' and drop the revert.
  const sideBaselineRef = useRef<SideSettingsBaseline>({
    side1Behaviour: card.seasonOps?.side1Behaviour ?? null,
    side2Behaviour: card.seasonOps?.side2Behaviour ?? null,
    side1ThresholdHpPct: card.seasonOps?.side1ThresholdHpPct ?? null,
    side2ThresholdHpPct: card.seasonOps?.side2ThresholdHpPct ?? null,
    // Same resolved values buildInitialBossState seeds, so untouched fields are omitted; the raw
    // season row would persist herald-fallback notes into the season store.
    mainNotes: card.mainEncounter.notes ?? null,
    side1Notes: card.sideEncounters[0]?.notes ?? null,
    side2Notes: card.sideEncounters[1]?.notes ?? null,
    pingMode: deriveInitialPingMode(
      card,
      sideFromEncounter(card.sideEncounters[0] ?? null),
      sideFromEncounter(card.sideEncounters[1] ?? null)
    ),
    mainRoles: roleEntriesFromEncounter(card.mainEncounter),
    side1Roles: card.sideEncounters[0]
      ? roleEntriesFromEncounter(card.sideEncounters[0])
      : [],
    side2Roles: card.sideEncounters[1]
      ? roleEntriesFromEncounter(card.sideEncounters[1])
      : [],
    // Real stored targets, so skipping never writes the `1` placeholder over one.
    side1TargetTokens:
      card.sideEncounters[0]?.targetToken?.targetTokens ?? null,
    side2TargetTokens: card.sideEncounters[1]?.targetToken?.targetTokens ?? null
  })

  const setSaveStatus = (saveStatus: SaveStatus) => {
    setState((prev) => ({ ...prev, saveStatus }))
  }

  const resetDirtyIfUnchanged = (editVersion: number) => {
    setState((prev) =>
      prev.editVersion === editVersion ? { ...prev, dirty: false } : prev
    )
  }

  const hasInvalidRoleRows =
    hasIncompleteRoleRows(state.mainRoles) ||
    hasIncompleteRoleRows(state.side1Roles) ||
    hasIncompleteRoleRows(state.side2Roles)

  /** True once the authoritative writes landed; `saveStatus` says whether fully clean. */
  const persistState = async (source: HubBossState): Promise<boolean> => {
    if (!data.guildCode || !canManageHerald || hasInvalidRoleRows) {
      if (hasInvalidRoleRows) setSaveStatus('error')
      return false
    }
    const stateForSave: HubBossState = {
      ...source,
      mainMessage: {
        ...source.mainMessage,
        extraLinks: extraLinksForMessage(
          source.mainMessage,
          linkTargetsFor(card, card.mainEncounter)
        )
      },
      side1Message:
        source.side1Message && card.sideEncounters[0]
          ? {
              ...source.side1Message,
              extraLinks: extraLinksForMessage(
                source.side1Message,
                linkTargetsFor(card, card.sideEncounters[0])
              )
            }
          : source.side1Message,
      side2Message:
        source.side2Message && card.sideEncounters[1]
          ? {
              ...source.side2Message,
              extraLinks: extraLinksForMessage(
                source.side2Message,
                linkTargetsFor(card, card.sideEncounters[1])
              )
            }
          : source.side2Message
    }
    let ok = false
    // `saved-stale`: only the mirror lags; `ok` stays false so the baseline holds and it retries.
    let wrote = false
    await persistBossSettings(
      buildHeraldSummary(card),
      stateForSave,
      data.guildCode,
      String(card.seasonNumber),
      String(data.currentSeasonNumber ?? data.seasonNumber),
      (status) => {
        setSaveStatus(status)
        if (status === 'saved') ok = true
        if (status === 'saved' || status === 'saved-stale') wrote = true
      },
      () => resetDirtyIfUnchanged(stateForSave.editVersion),
      // Untouched primes are left alone, so an edit here cannot revert a skip set elsewhere.
      sideBaselineRef.current
    )
    if (ok) {
      // skip_all forces 'skip'; advancing to the un-forced state would drop the un-skip on leaving it.
      const forcedSkip = stateForSave.pingMode === 'skip_all'
      const side1Written: SideBehaviour | null = stateForSave.side1
        ? forcedSkip
          ? 'skip'
          : stateForSave.side1.behaviour
        : null
      const side2Written: SideBehaviour | null = stateForSave.side2
        ? forcedSkip
          ? 'skip'
          : stateForSave.side2.behaviour
        : null
      const prev = sideBaselineRef.current
      // Skipping a side with no stored token creates the `1` placeholder; track it so un-skip clears
      // it. No baseline (`!= null`) means no mirror fired, so claiming one would write tokens=1.
      const side1Tokens =
        side1Written === 'skip' &&
        prev.side1Behaviour != null &&
        prev.side1Behaviour !== 'skip' &&
        !(prev.side1TargetTokens != null && prev.side1TargetTokens > 0)
          ? 1
          : prev.side1TargetTokens
      const side2Tokens =
        side2Written === 'skip' &&
        prev.side2Behaviour != null &&
        prev.side2Behaviour !== 'skip' &&
        !(prev.side2TargetTokens != null && prev.side2TargetTokens > 0)
          ? 1
          : prev.side2TargetTokens
      sideBaselineRef.current = {
        // Spread first to keep token counts.
        ...prev,
        side1TargetTokens: side1Tokens,
        side2TargetTokens: side2Tokens,
        side1Behaviour: side1Written,
        side2Behaviour: side2Written,
        side1ThresholdHpPct:
          !forcedSkip && stateForSave.side1?.behaviour === 'threshold'
            ? clampThreshold(stateForSave.side1.threshold)
            : null,
        side2ThresholdHpPct:
          !forcedSkip && stateForSave.side2?.behaviour === 'threshold'
            ? clampThreshold(stateForSave.side2.threshold)
            : null,
        // Advance gated fields to what was persisted, so the next save omits them.
        mainNotes: stateForSave.mainNotes,
        side1Notes: stateForSave.side1?.notes ?? null,
        side2Notes: stateForSave.side2?.notes ?? null,
        pingMode: stateForSave.pingMode,
        mainRoles: stateForSave.mainRoles,
        side1Roles: stateForSave.side1Roles,
        side2Roles: stateForSave.side2Roles
      }
    }
    return wrote
  }

  const saveHerald = () => persistState(state)

  // `flushSync` commits first so we save exactly that (safe after an await); rejects on failure
  // so the modal stays open.
  const applyNotesAndSave = async (
    compute: (prev: HubBossState) => HubBossState
  ) => {
    let next: HubBossState | null = null
    flushSync(() => {
      setState((prev) => {
        next = {
          ...compute(prev),
          dirty: true,
          saveStatus: 'saving',
          editVersion: prev.editVersion + 1
        }
        return next
      })
    })
    if (!next) return
    const wrote = await persistState(next)
    if (!wrote) throw new Error('Failed to save notes')
  }

  const saveFooter = canManageHerald ? (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] px-4 py-3 backdrop-blur-md">
      <div
        className={
          state.saveStatus === 'saved-stale'
            ? 'text-xs text-[var(--warning)]'
            : 'text-xs text-[var(--text-tertiary)]'
        }
      >
        {hasInvalidRoleRows
          ? 'Add a valid Discord role ID for every role row.'
          : state.saveStatus === 'error'
            ? 'Save failed'
            : state.saveStatus === 'saved-stale'
              ? // The mirror lagged; dirty stays set so the officer can retry.
                'Saved, but target sync failed — save again to retry'
              : state.saveStatus === 'saved' && !state.dirty
                ? 'Saved'
                : state.dirty
                  ? 'Unsaved Herald changes'
                  : 'Ready'}
      </div>
      <button
        type="button"
        onClick={() => void saveHerald()}
        disabled={
          state.saveStatus === 'saving' || !state.dirty || hasInvalidRoleRows
        }
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3 text-sm font-semibold text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] disabled:cursor-not-allowed disabled:border-[var(--card-border)] disabled:bg-black/10 disabled:text-[color-mix(in_srgb,var(--text-secondary)_40%,transparent)]"
      >
        {state.saveStatus === 'saving' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Save ops
      </button>
    </div>
  ) : null

  // Main is kill-only, so its indicator never varies.
  const mainOpsSummary = (
    <OpsSummaryRow
      targetTokens={card.mainEncounter.targetToken?.targetTokens ?? null}
      roleSet={state.mainRoles.length > 0}
      behaviour="kill"
    />
  )
  const canExpandOps = canManageHerald || canManageTargets

  const mainSubtitle = (
    <div className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
      {card.boardId}
    </div>
  )

  const mainActions = (
    <>
      <Link
        href={card.playbookHref}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-[var(--accent)]"
      >
        Playbook
        <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
      <Link
        href={`/boss?season=${card.seasonNumber}&level=${card.difficultyCode}`}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 text-sm font-semibold text-[var(--text-secondary)] hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-[var(--accent)]"
      >
        <Activity className="h-3.5 w-3.5" />
        Boss Performance
      </Link>
    </>
  )

  const mainOps = (
    <OpsCard
      title="Main Ops"
      description="Main stays kill-only. Prime behavior is configured per side."
      status={<StatusPill card={card} />}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            Main encounter
          </div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {card.mainEncounter.bossName}
          </div>
        </div>
        {canManageTargets ? (
          <TargetTokenControl
            key={card.mainEncounter.key}
            card={card}
            encounter={card.mainEncounter}
            canManage={canManageTargets}
          />
        ) : (
          <span className="rounded-md border border-[var(--card-border)] bg-black/20 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]">
            {targetLabel(card.mainEncounter)}
          </span>
        )}
      </div>

      <RoleListInput
        label="Main roles"
        roles={state.mainRoles}
        reusableRoles={reusableRoles}
        disabled={!canManageHerald}
        onRememberRoles={onRememberRoles}
        onChange={setMainRoles}
      />
      <NotesInput
        label="Main notes"
        value={state.mainNotes}
        disabled={!canManageHerald}
        placeholder="Optional narrative shown in the main-boss ping..."
        onChange={setMainNotes}
      />
      <MessageIncludePicker
        settings={state.mainMessage}
        links={linkTargetsFor(card, card.mainEncounter)}
        disabled={!canManageHerald}
        onToggle={(option) => toggleMessageInclude('mainMessage', option)}
        onCustomLinkChange={(patch) => patchMessage('mainMessage', patch)}
      />
      {card.sideEncounters.length > 0 && (
        <div className="space-y-2 rounded-md border border-[var(--card-border)] bg-black/15 p-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              Prime ping mode
            </div>
            <div className="mt-1 text-xs text-[var(--text-tertiary)]">
              Combined sends one prime ping. Per-side keeps side pings separate.
            </div>
          </div>
          <PingModeToggle
            value={state.pingMode}
            disabled={!canManageHerald}
            onChange={setPingMode}
          />
          {state.pingMode === 'skip_all' && (
            <div className="text-xs italic text-[color-mix(in_srgb,var(--text-secondary)_75%,transparent)]">
              Side roles will not ping. Main still fires independently.
            </div>
          )}
          {state.pingMode === 'combined' && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                Combined prime ping — preview
              </div>
              {combinedPrimeNotesPreview.length > 0 ? (
                <p className="whitespace-pre-wrap rounded-md border border-[var(--card-border)] bg-black/20 px-3 py-2 text-xs text-[var(--text-secondary)]">
                  {combinedPrimeNotesPreview}
                </p>
              ) : (
                <p className="rounded-md border border-[var(--card-border)] bg-black/15 px-3 py-2 text-xs italic text-[var(--text-tertiary)]">
                  No prime notes yet. Whatever you write in the Prime 1 and
                  Prime 2 notes below appears here.
                </p>
              )}
              <p className="text-[10px] text-[var(--text-tertiary)]">
                Built from the Prime 1 and Prime 2 notes below — edit those.
                Matching notes post once; different ones get side headings.
              </p>
            </div>
          )}
        </div>
      )}
      {opsLoadFailed ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--warning)]/40 bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-3 py-2 text-xs text-[var(--warning)]"
        >
          Herald settings could not be loaded, so the fields below may be blank
          even where you have things configured. Editing is disabled to stop a
          save overwriting your real settings — reload the page to try again.
        </div>
      ) : (
        !canManageHerald && (
          <div className="rounded-md border border-[var(--card-border)] bg-black/15 px-3 py-2 text-xs text-[var(--text-tertiary)]">
            Herald settings are read-only for members.
          </div>
        )
      )}
    </OpsCard>
  )

  return (
    <div className="space-y-4">
      <EncounterCommandRow
        encounter={card.mainEncounter}
        title={card.bossName}
        subtitle={mainSubtitle}
        href={card.playbookHref}
        actions={mainActions}
        ops={mainOps}
        mobileOpsFooter={saveFooter}
        mobileSummary={mainOpsSummary}
        canExpandOps={canExpandOps}
        sectionId={encounterSectionId(card.key)}
      >
        <span
          className={clsx(
            'rounded-md border px-2 py-1 text-xs font-semibold',
            card.rarity === 'Mythic'
              ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
              : 'border-sky-300/40 bg-sky-300/10 text-sky-200'
          )}
        >
          {card.difficultyCode}
        </span>
        <StatusPill card={card} />
      </EncounterCommandRow>

      {card.sideEncounters.map((encounter, index) => {
        const sideKey = index === 0 ? 'side1' : 'side2'
        const side = state[sideKey]
        const sideMessage =
          sideKey === 'side1' ? state.side1Message : state.side2Message
        const primeOps =
          side && sideMessage ? (
            <OpsCard
              title={`Prime ${index + 1} Ops`}
              description={
                state.pingMode === 'skip_all'
                  ? 'Prime ping is skipped for this encounter.'
                  : 'Configure this prime encounter independently.'
              }
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                    Prime {index + 1}
                  </div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {encounter.bossName}
                  </div>
                </div>
                {canManageTargets ? (
                  <TargetTokenControl
                    key={encounter.key}
                    card={card}
                    encounter={encounter}
                    canManage={canManageTargets}
                  />
                ) : (
                  <span className="rounded-md border border-[var(--card-border)] bg-black/20 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                    {targetLabel(encounter)}
                  </span>
                )}
              </div>

              <RoleListInput
                label={`Prime ${index + 1} roles`}
                roles={
                  sideKey === 'side1' ? state.side1Roles : state.side2Roles
                }
                reusableRoles={reusableRoles}
                disabled={!canManageHerald || state.pingMode === 'skip_all'}
                onRememberRoles={onRememberRoles}
                onChange={(roles) => setSideRoles(sideKey, roles)}
              />
              {/* Visible in every ping mode so per-prime notes stay editable in combined mode. */}
              <NotesInput
                label={`Prime ${index + 1} notes`}
                value={side.notes}
                disabled={!canManageHerald || state.pingMode === 'skip_all'}
                placeholder={
                  state.pingMode === 'combined'
                    ? `Optional narrative for prime ${index + 1} in the combined ping...`
                    : `Optional narrative shown in the prime ${index + 1} ping...`
                }
                onChange={(value) => setSideNotes(sideKey, value)}
              />
              <MessageIncludePicker
                settings={sideMessage}
                links={linkTargetsFor(card, encounter)}
                disabled={!canManageHerald || state.pingMode === 'skip_all'}
                onToggle={(option) =>
                  toggleMessageInclude(
                    sideKey === 'side1' ? 'side1Message' : 'side2Message',
                    option
                  )
                }
                onCustomLinkChange={(patch) =>
                  patchMessage(
                    sideKey === 'side1' ? 'side1Message' : 'side2Message',
                    patch
                  )
                }
              />
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                  Behavior
                </div>
                <BehaviourToggle
                  value={side.behaviour}
                  disabled={!canManageHerald || state.pingMode === 'skip_all'}
                  onChange={(value) => patchSide(sideKey, { behaviour: value })}
                />
              </div>
              {side.behaviour === 'threshold' && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                    Threshold HP remaining
                  </div>
                  <ThresholdPicker
                    value={side.threshold}
                    disabled={!canManageHerald}
                    onChange={(value) =>
                      patchSide(sideKey, { threshold: value })
                    }
                  />
                </div>
              )}
              {!canManageHerald && (
                <div className="rounded-md border border-[var(--card-border)] bg-black/15 px-3 py-2 text-xs text-[var(--text-tertiary)]">
                  Prime ops are read-only for members.
                </div>
              )}
            </OpsCard>
          ) : null

        return (
          <EncounterCommandRow
            key={encounter.key}
            encounter={encounter}
            title={encounter.bossName}
            sectionId={encounterSectionId(card.key, encounter.key)}
            subtitle={
              <div className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">
                {encounter.boardId}
              </div>
            }
            ops={primeOps}
            href={card.playbookHref}
            mobileOpsFooter={saveFooter}
            mobileSummary={
              side ? (
                <OpsSummaryRow
                  targetTokens={encounter.targetToken?.targetTokens ?? null}
                  roleSet={
                    (sideKey === 'side1' ? state.side1Roles : state.side2Roles)
                      .length > 0
                  }
                  behaviour={side.behaviour}
                  threshold={side.threshold}
                />
              ) : undefined
            }
            canExpandOps={canExpandOps}
          >
            <span className="rounded-md border border-[var(--card-border)] px-2 py-1 text-[10px] font-semibold uppercase text-[var(--text-tertiary)]">
              {targetLabel(encounter)}
            </span>
          </EncounterCommandRow>
        )
      })}

      {/* Sticky save bar, kept clear of the bottom-right widget stack (corner-stack.ts). */}
      {saveFooter && (
        <div
          className={`sticky ${CORNER_STACK_MOBILE_CLEARANCE_CLASS} z-30 mt-2 flex sm:bottom-4 ${CORNER_STACK_RIGHT_GUTTER_CLASS}`}
        >
          <div className="w-full rounded-lg shadow-lg shadow-black/40">
            {saveFooter}
          </div>
        </div>
      )}
    </div>
  )
}
