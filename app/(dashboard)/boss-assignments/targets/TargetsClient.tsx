'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { isSkipUnion } from '@/app/lib/boss-ops/skip-union'
import { AssignmentSeasonWindow } from '@/app/(dashboard)/boss-assignments/_components/AssignmentSeasonWindow'
import { TargetsAccordion } from './_components/TargetsAccordion'
import { OpsSurface } from './_components/OpsSurface'
import type { SeasonOption } from '@/app/components/ui/SeasonSelectorPills'
import type { EncounterOpsSlice } from '@/app/lib/boss-ops/encounter-ops-merge'
import { useTargetMutations } from './useTargetMutations'
import {
  deriveSeedState,
  encounterLabel,
  filterAndSortTargetRows,
  levelLabel,
  mergeTargetRows,
  targetRowKey,
  type MergedRow,
  type SlotEntry,
  type TargetRow,
  type TargetSortKey
} from './model'

export { deriveSeedState, encounterLabel, levelLabel } from './model'
export type { MergedRow, TargetRow } from './model'

interface TargetsResponse {
  rows: TargetRow[]
}

interface ScheduleResponse {
  current: { config_id: string; season_number: number; slots: SlotEntry[] }
  upcoming: { config_id: string; season_number: number; slots: SlotEntry[] }
  selected: {
    config_id: string
    season_number: number
    slots: SlotEntry[]
  } | null
  all: { slots: SlotEntry[]; config_ids: string[] }
}

interface PerBossActual {
  season: string
  tokensToKill: number
  sampleCount: number
}

interface TargetsClientProps {
  guildCode: string
  /** Recent tokens-to-kill keyed `${bossType}__${rarity}__${set}__${encounter_id}`. */
  perBossActuals?: Record<string, PerBossActual>
  /** When false, mutation controls are hidden and handlers no-op. */
  canEdit?: boolean
  /** Narrower than `canEdit`: the seed endpoint is app-admin-only. */
  canSeed?: boolean
  /**
   * Keyed like `mergedRows`. `loadFailed` must disable every ops control: a failed read looks
   * empty, and saving the default "kill" would silently un-skip a prime.
   */
  opsSlice?: EncounterOpsSlice
  /** Own-guild officer/leader; the herald routes lack `canEdit`'s app-admin bypass. */
  canManageHerald?: boolean
  /** Writing season-blind Herald snapshot columns for a future season corrupts the current one. */
  isCurrentSeason?: boolean
  seasonOptions: SeasonOption[]
  /** URL `?season` (default: cluster live). Reads and writes are scoped to it. */
  selectedSeason: string
}

type Mode = 'current' | 'upcoming' | 'all'

export default function TargetsClient({
  guildCode,
  perBossActuals,
  canEdit = false,
  canSeed = false,
  seasonOptions,
  selectedSeason,
  opsSlice,
  canManageHerald = false,
  isCurrentSeason = true
}: TargetsClientProps) {
  const actuals = perBossActuals ?? {}
  const queryClient = useQueryClient()
  // toLocaleDateString needs the hasMounted gate (server vs client TZ).
  const hasMounted = useHasMounted()
  const [mode, setMode] = useState<Mode>('current')
  const [showPrimes, setShowPrimes] = useState(true)
  const [opsRow, setOpsRow] = useState<MergedRow | null>(null)
  const router = useRouter()

  const [nameFilter, setNameFilter] = useState('')
  const [rarityFilter, setRarityFilter] = useState<
    'all' | 'Legendary' | 'Mythic'
  >('all')
  const [sourceFilter, setSourceFilter] = useState<
    'all' | 'unset' | 'officer_manual' | 'historical_seed'
  >('all')
  const [sortKey, setSortKey] = useState<TargetSortKey>('tier')
  const [sortAsc, setSortAsc] = useState(true)
  const {
    editingKey,
    editValue,
    setEditValue,
    seedStatus,
    saveError,
    startEdit,
    cancelEdit,
    saveEdit,
    toggleSkip,
    resetTarget,
    seedFromHistory,
    isSaving,
    isResetting,
    isSeeding
  } = useTargetMutations({ guildCode, selectedSeason, canEdit })

  // Season-scoped key; invalidations use the `['boss-target-tokens', guildCode]` prefix.
  const targetsQuery = useQuery<TargetsResponse>({
    queryKey: ['boss-target-tokens', guildCode, selectedSeason] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/boss-assignments/target-tokens?guild_code=${encodeURIComponent(guildCode)}&season=${encodeURIComponent(selectedSeason)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!guildCode,
    staleTime: 60_000
  })

  const scheduleQuery = useQuery<ScheduleResponse>({
    queryKey: ['target-tokens-schedule', selectedSeason] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/boss-assignments/target-tokens/schedule?season=${encodeURIComponent(selectedSeason)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 10 * 60_000 // schedule changes rarely
  })

  const scopeSlots = useMemo((): SlotEntry[] => {
    const sch = scheduleQuery.data
    if (!sch) return []
    if (mode === 'all') return sch.all.slots
    // The fallback covers older payloads without season data.
    if (sch.selected) return sch.selected.slots
    if (mode === 'current') return sch.current.slots
    return sch.upcoming.slots
  }, [scheduleQuery.data, mode])

  // Every slot renders a row. Key on `slot.boss_type` (raw DB value), not the display `boss_name`.
  const mergedRows = useMemo(
    () => mergeTargetRows(scopeSlots, targetsQuery.data?.rows ?? []),
    [targetsQuery.data, scopeSlots]
  )

  const filteredSortedRows = useMemo(() => {
    return filterAndSortTargetRows(mergedRows, {
      name: nameFilter,
      rarity: rarityFilter,
      source: sourceFilter,
      showPrimes,
      sortKey,
      sortAsc
    })
  }, [
    mergedRows,
    nameFilter,
    rarityFilter,
    sourceFilter,
    showPrimes,
    sortKey,
    sortAsc
  ])

  // Keys skipped via store (b), for the display union.
  const opsSkippedKeys = useMemo(() => {
    const keys = new Set<string>()
    if (!opsSlice) return keys
    for (const [key, entry] of Object.entries(opsSlice.byKey)) {
      if (entry.behaviour === 'skip') keys.add(key)
    }
    return keys
  }, [opsSlice])

  const toggleSort = (key: TargetSortKey) => {
    if (sortKey === key) setSortAsc((p) => !p)
    else {
      setSortKey(key)
      setSortAsc(key === 'boss' || key === 'tier')
    }
  }

  const sortIndicator = (key: TargetSortKey) =>
    sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''

  // Seed is gated on `canSeed`, not `canEdit`.
  const subNav = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-amber-100/60">Editing targets for</span>
        <span className="font-semibold text-[var(--primary)]">
          Season {selectedSeason}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <AssignmentSeasonWindow
          options={seasonOptions}
          value={selectedSeason}
        />
        {canSeed && (
          <button
            onClick={seedFromHistory}
            data-testid="targets-mutation-control"
            disabled={isSeeding}
            className="px-3 py-1.5 text-xs rounded-md border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] disabled:opacity-50"
            title={`Rewrites historical_seed rows for Season ${selectedSeason} from the last full rotations. Primes use tier-cohort averages. Officer-manual rows are preserved.`}
          >
            {isSeeding ? 'Seeding…' : 'Seed from history'}
          </button>
        )}
      </div>
    </div>
  )

  const loadingSched = scheduleQuery.isLoading || targetsQuery.isLoading
  const err = scheduleQuery.error || targetsQuery.error

  if (loadingSched)
    return (
      <div className="space-y-4">
        {subNav}
        <div className="p-8 text-center text-amber-100/60">
          Loading targets…
        </div>
      </div>
    )
  if (err)
    return (
      <div className="space-y-4">
        {subNav}
        <div className="p-8 text-center text-red-400">
          Failed to load: {String(err)}
        </div>
      </div>
    )

  const sch = scheduleQuery.data!

  const modeDescription =
    sch.selected && mode !== 'all'
      ? `Season ${sch.selected.season_number} (${sch.selected.config_id})`
      : mode === 'current'
        ? `Season ${sch.current.season_number} (${sch.current.config_id})`
        : mode === 'upcoming'
          ? `Season ${sch.upcoming.season_number} (${sch.upcoming.config_id})`
          : `All ${sch.all.config_ids.length} rotation configs`

  const unsetCount = mergedRows.filter((r) => !r.target).length
  const setCount = mergedRows.length - unsetCount

  return (
    <div className="space-y-4">
      {subNav}
      <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] overflow-hidden">
        <div className="p-4 border-b border-[color-mix(in_srgb,var(--primary)_20%,transparent)]">
          <h2 className="text-lg font-semibold text-[var(--primary)]">
            Boss Target Tokens
          </h2>
          <p className="text-xs text-amber-100/60 mt-1">
            Officer-set normative target. Overrides the auto-derived historical
            average used by Target Weighting on{' '}
            <Link href="/player-performance" className="underline">
              /player-performance
            </Link>{' '}
            and{' '}
            <Link href="/boss" className="underline">
              /boss
            </Link>
            . Unset bosses keep auto-deriving from guild history.
          </p>
          {seedStatus && (
            <p className="text-xs text-amber-300 mt-2">{seedStatus}</p>
          )}
          {/* Surface mutation failures instead of leaving the editor silent. */}
          {saveError && (
            <p role="alert" className="text-xs text-red-400 mt-2">
              Save failed: {saveError}
            </p>
          )}
        </div>

        {/* Mode tabs */}
        <div className="px-4 py-3 border-b border-[color-mix(in_srgb,var(--primary)_20%,transparent)] flex flex-wrap items-center gap-3">
          <div className="flex rounded-md overflow-hidden border border-[color-mix(in_srgb,var(--primary)_20%,transparent)]">
            {(['current', 'upcoming', 'all'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-[color-mix(in_srgb,var(--primary)_20%,transparent)] text-[var(--primary)]'
                    : 'bg-transparent text-amber-100/50 hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]'
                }`}
              >
                {m === 'current'
                  ? 'Current'
                  : m === 'upcoming'
                    ? 'Upcoming'
                    : 'All'}
              </button>
            ))}
          </div>
          <span className="text-xs text-amber-100/50">{modeDescription}</span>
          <span className="text-xs text-amber-100/50">
            · {setCount}/{mergedRows.length} set
          </span>

          <div className="ml-auto flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1 text-amber-100/70">
              <input
                type="checkbox"
                checked={showPrimes}
                onChange={(e) => setShowPrimes(e.target.checked)}
                className="h-3 w-3"
              />
              Primes
            </label>
            {mode === 'all' && (
              <>
                <input
                  type="text"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  placeholder="Search boss…"
                  className="px-2 py-1 rounded bg-[var(--bg-primary)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-[var(--text-primary)] placeholder-amber-100/40 focus:outline-none focus:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] w-36"
                />
                <select
                  value={rarityFilter}
                  onChange={(e) =>
                    setRarityFilter(
                      e.target.value as 'all' | 'Legendary' | 'Mythic'
                    )
                  }
                  className="px-2 py-1 rounded bg-[var(--bg-primary)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-[var(--text-primary)] focus:outline-none focus:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]"
                >
                  <option value="all">All rarities</option>
                  <option value="Legendary">Legendary</option>
                  <option value="Mythic">Mythic</option>
                </select>
                <select
                  value={sourceFilter}
                  onChange={(e) =>
                    setSourceFilter(e.target.value as typeof sourceFilter)
                  }
                  className="px-2 py-1 rounded bg-[var(--bg-primary)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] text-[var(--text-primary)] focus:outline-none focus:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]"
                >
                  <option value="all">All sources</option>
                  <option value="officer_manual">Manual</option>
                  <option value="historical_seed">Seeded</option>
                  <option value="unset">Unset only</option>
                </select>
              </>
            )}
            <span className="text-amber-100/50">
              {filteredSortedRows.length} rows
            </span>
          </div>
        </div>

        {filteredSortedRows.length === 0 ? (
          <div className="p-8 text-center text-amber-100/60">
            No rows in this view. Try changing mode or filters.
          </div>
        ) : (
          <>
            {/* Accordion below lg; `mode === 'all'` (100+ groups, no virtualisation) stays a table. */}
            {mode !== 'all' && (
              <div className="lg:hidden">
                <TargetsAccordion
                  rows={filteredSortedRows}
                  keyFor={targetRowKey}
                  canEdit={canEdit}
                  canManageHerald={canManageHerald}
                  editingKey={editingKey}
                  onEdit={startEdit}
                  onOpenOps={setOpsRow}
                  opsSkippedKeys={opsSkippedKeys}
                  onReset={resetTarget}
                  renderEditor={(row) => (
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(row)
                        else if (e.key === 'Escape') cancelEdit()
                      }}
                      onBlur={() => saveEdit(row)}
                      className="h-11 w-20 rounded-md border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--bg-primary)] px-2 text-right font-mono text-[var(--text-primary)] focus:outline-none"
                      aria-label={`${row.display_name} target tokens`}
                      autoFocus
                    />
                  )}
                />
              </div>
            )}
            <div
              className={
                mode === 'all'
                  ? 'overflow-auto max-h-[75vh]'
                  : 'hidden lg:block overflow-auto max-h-[75vh]'
              }
            >
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--bg-primary)] border-b border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
                  <tr>
                    <th
                      onClick={() => toggleSort('boss')}
                      className="px-4 py-3 text-left font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                    >
                      Boss{sortIndicator('boss')}
                    </th>
                    <th
                      onClick={() => toggleSort('tier')}
                      className="px-4 py-3 text-center font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                    >
                      Tier{sortIndicator('tier')}
                    </th>
                    <th
                      onClick={() => toggleSort('encounter')}
                      className="px-4 py-3 text-center font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                    >
                      Encounter{sortIndicator('encounter')}
                    </th>
                    <th
                      onClick={() => toggleSort('target')}
                      className="px-4 py-3 text-right font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                    >
                      Target tokens{sortIndicator('target')}
                    </th>
                    <th
                      onClick={() => toggleSort('source')}
                      className="px-4 py-3 text-center font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                    >
                      Source{sortIndicator('source')}
                    </th>
                    <th
                      onClick={() => toggleSort('updated')}
                      className="px-4 py-3 text-left font-medium text-amber-100/80 cursor-pointer hover:text-[var(--primary)]"
                    >
                      Updated{sortIndicator('updated')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-amber-100/80">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSortedRows.map((row) => {
                    const rowKey = targetRowKey(row)
                    const isEditing = editingKey === rowKey
                    const hasTarget = !!row.target
                    const seed = deriveSeedState(row.target ?? null)
                    const {
                      isNoneAvailable,
                      isTierFallback,
                      tierFallbackLabel,
                      isSkipped
                    } = seed
                    // Display-only union of both skip stores; the checkbox writes (a), the ops gear edits (b).
                    const opsSkipped =
                      opsSlice?.byKey[rowKey]?.behaviour === 'skip'
                    const showSkipped = isSkipUnion(isSkipped, opsSkipped)
                    const rowOpacity =
                      showSkipped || isNoneAvailable
                        ? 'opacity-40'
                        : !hasTarget
                          ? 'opacity-70'
                          : ''
                    let updatedLabel = ''
                    if (hasTarget && hasMounted) {
                      updatedLabel = new Date(
                        row.target!.updated_at
                      ).toLocaleDateString()
                    }
                    return (
                      <tr
                        key={rowKey}
                        className={`border-t border-[var(--card-border)] hover:bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)] ${rowOpacity}`}
                      >
                        <td className="px-4 py-2 text-[var(--text-primary)]">
                          {row.display_name}
                        </td>
                        <td className="px-4 py-2 text-center font-mono text-xs text-amber-300">
                          {levelLabel(row.rarity, row.set)}
                        </td>
                        <td
                          className={`px-4 py-2 text-center text-xs ${row.encounter_id === 0 ? 'text-amber-100/70' : 'text-purple-300'}`}
                        >
                          {encounterLabel(row.encounter_id)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {(() => {
                            // Recent guild tokens-to-kill, on hover and as a dim hint.
                            const actualKey = `${row.boss_type}__${row.rarity}__${row.set}__${row.encounter_id}`
                            const actual = actuals[actualKey] ?? null
                            const tooltip = actual
                              ? `Recent guild actual: ${actual.tokensToKill.toFixed(1)} tokens to kill (S${actual.season}, ${actual.sampleCount} attacks)`
                              : undefined
                            const inlineHint =
                              actual && !isEditing ? (
                                <div
                                  className="text-[10px] text-amber-100/40 font-normal"
                                  title={tooltip}
                                >
                                  actual ≈ {actual.tokensToKill.toFixed(1)}
                                </div>
                              ) : null

                            return (
                              <div title={tooltip}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    min="1"
                                    step="0.5"
                                    value={editValue}
                                    onChange={(e) =>
                                      setEditValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveEdit(row)
                                      else if (e.key === 'Escape') cancelEdit()
                                    }}
                                    className="w-20 px-2 py-1 rounded bg-[var(--bg-primary)] border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] text-right text-[var(--text-primary)] focus:outline-none focus:border-[color-mix(in_srgb,var(--primary)_60%,transparent)]"
                                    autoFocus
                                  />
                                ) : isNoneAvailable ? (
                                  <span className="text-red-400/70">—</span>
                                ) : isSkipped ? (
                                  <span className="text-amber-100/40 italic text-xs">
                                    skipped
                                  </span>
                                ) : hasTarget ? (
                                  <span className="font-semibold">
                                    {row.target!.target_tokens}
                                  </span>
                                ) : (
                                  <span className="text-amber-100/30">—</span>
                                )}
                                {inlineHint}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {isNoneAvailable ? (
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/40"
                              title="No historical data at this tier or any tier below. Manual entry recommended."
                            >
                              None available
                            </span>
                          ) : showSkipped ? (
                            <span
                              className="px-2 py-0.5 rounded text-[10px] bg-gray-500/20 text-gray-300 border border-gray-500/30"
                              title={
                                isSkipped
                                  ? undefined
                                  : 'Skipped via the season planner / ops rule — change it from the gear, not the Skip checkbox'
                              }
                            >
                              Skip
                            </span>
                          ) : isTierFallback ? (
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/40"
                              title={`Derived from ${tierFallbackLabel} (same boss, lower tier). ${row.target?.seeded_from_seasons ?? ''}`}
                            >
                              Fallback: {tierFallbackLabel}
                            </span>
                          ) : hasTarget ? (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                row.target!.source === 'officer_manual'
                                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              }`}
                              title={
                                row.target!.source === 'historical_seed' &&
                                row.target!.seeded_from_seasons
                                  ? `Seeded from ${row.target!.seeded_from_seasons}`
                                  : undefined
                              }
                            >
                              {row.target!.source === 'officer_manual'
                                ? 'Manual'
                                : 'Seeded'}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] text-amber-100/40 border border-amber-100/10">
                              Unset
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-amber-100/50">
                          {updatedLabel}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {!canEdit ? (
                            <span className="text-amber-100/20">—</span>
                          ) : isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(row)}
                                data-testid="targets-mutation-control"
                                className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 mr-1"
                                disabled={isSaving}
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                data-testid="targets-mutation-control"
                                className="px-2 py-1 text-xs rounded border border-amber-100/20 text-amber-100/60 hover:bg-amber-100/10"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              {canManageHerald && (
                                <button
                                  onClick={() => setOpsRow(row)}
                                  className="rounded border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2 py-1 text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
                                  aria-label={`Open ops settings for ${row.display_name}`}
                                  data-testid="targets-mutation-control"
                                  title="Ping roles, notes, and the kill/threshold/skip rule"
                                >
                                  <Settings2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {row.encounter_id !== 0 && (
                                <label
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-amber-100/10 hover:border-amber-100/30 cursor-pointer select-none"
                                  title={
                                    isSkipped
                                      ? 'Un-skip this prime (treat as expected again)'
                                      : 'Skip this prime — opt out of expecting attacks'
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={isSkipped}
                                    onChange={() => toggleSkip(row)}
                                    data-testid="targets-mutation-control"
                                    disabled={isSaving}
                                    className="h-3 w-3"
                                  />
                                  Skip
                                </label>
                              )}
                              <button
                                onClick={() => startEdit(row)}
                                data-testid="targets-mutation-control"
                                disabled={isSkipped}
                                className={`px-2 py-1 text-xs rounded border mr-0 ${
                                  isSkipped
                                    ? 'bg-card-bg/20 border-amber-100/10 text-amber-100/30 cursor-not-allowed'
                                    : 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)] border-[color-mix(in_srgb,var(--primary)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]'
                                }`}
                              >
                                {hasTarget ? 'Edit' : 'Add'}
                              </button>
                              {hasTarget &&
                                row.target!.source === 'officer_manual' && (
                                  <button
                                    onClick={() => resetTarget(row)}
                                    data-testid="targets-mutation-control"
                                    disabled={isResetting}
                                    className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                                    title="Remove manual target — falls back to historical average"
                                  >
                                    Reset
                                  </button>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {opsRow &&
        opsSlice?.byKey[targetRowKey(opsRow)] &&
        (() => {
          const entry = opsSlice.byKey[targetRowKey(opsRow)]!
          return (
            <OpsSurface
              // Remount per row so row A's refs and state never leak into row B's writes.
              key={targetRowKey(opsRow)}
              isOpen
              onClose={() => setOpsRow(null)}
              title={`${opsRow.display_name} \u00b7 ${encounterLabel(opsRow.encounter_id)}`}
              ops={entry}
              canManage={canManageHerald}
              loadFailed={opsSlice.loadFailed}
              seasonNumber={selectedSeason}
              isCurrentSeason={isCurrentSeason}
              guildCode={guildCode}
              currentTargetTokens={opsRow.target?.target_tokens ?? 0}
              reusableRoles={[]}
              onSaved={() => {
                // The behaviour mirror writes boss_target_tokens; invalidate or the 60s staleTime shows stale data.
                queryClient.invalidateQueries({
                  queryKey: ['boss-target-tokens', guildCode]
                })
                router.refresh()
              }}
            />
          )
        })()}
    </div>
  )
}
