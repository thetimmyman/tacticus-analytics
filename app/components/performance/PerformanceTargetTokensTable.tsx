'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Minus, Plus, Save } from 'lucide-react'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { formatEncounterLabel } from '@/app/lib/format/encounter-label'
import { formatNumber } from '@/app/lib/utils/number-format'
import {
  saveTargetToken,
  TARGET_TOKENS_ENDPOINT
} from '@/app/lib/boss-ops/persist-target-token'
import { asEncounterId } from '@/app/lib/boss-ops/identity'

/**
 * "Target Tokens by Boss" under Target Weighting: one row per rotation boss/prime with
 * the officer target (`boss_target_tokens`, shared with Boss Playbooks).
 */

interface TargetRow {
  boss_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
  target_tokens: number
  source: 'historical_seed' | 'officer_manual'
  seeded_from_seasons: string | null
  notes: string | null
  skip: boolean
}

interface TargetsResponse {
  rows: TargetRow[]
}

interface SlotEntry {
  boss_type: string
  boss_name: string
  rarity: string
  set: number
  encounter_id: number
}

interface ScheduleResponse {
  current: { config_id: string; season_number: number; slots: SlotEntry[] }
  upcoming: { config_id: string; season_number: number; slots: SlotEntry[] }
  all: { slots: SlotEntry[]; config_ids: string[] }
}

/** Read-only /rotation-stats inputs behind `expected tokens ≈ bossHp / avgDamagePerHit`. */
interface RotationStatEntry {
  bossHp: number | null
  avgDamagePerHit: number | null
  avgTokensPerLoop: number | null
  tokensLastLoop: number | null
}

interface RotationStatsResponse {
  stats: Record<string, RotationStatEntry>
}

interface MergedRow {
  boss_type: string
  display_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
  target: TargetRow | null
  stats: RotationStatEntry | null
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const ROTATION_STATS_ENDPOINT =
  '/api/boss-assignments/target-tokens/rotation-stats'

function levelLabel(rarity: string, set: number) {
  return `${rarity === 'Mythic' ? 'M' : 'L'}${set}`
}

/** Compact K/M/B; "—" when the guild has not fought this slot this rotation. */
function formatStatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'
  return formatNumber(value, { style: 'compact' })
}

function formatTokenStat(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

const encounterLabel = (eid: number) => formatEncounterLabel(eid, 'plain')

function isNoneAvailable(target: TargetRow | null): boolean {
  return (
    !!target &&
    target.source === 'historical_seed' &&
    (target.seeded_from_seasons ?? '').toLowerCase().includes('none available')
  )
}

function isOfficerSkip(target: TargetRow | null): boolean {
  return !!target && target.skip === true && !isNoneAvailable(target)
}

/** Local draft state per row, so saving one boss never resets another's edit. */
function TargetCell({
  row,
  canManage,
  guildCode,
  season,
  onSaved
}: {
  row: MergedRow
  canManage: boolean
  guildCode: string
  /** Stamped into the PUT; without it the target lands on the legacy '' row and does nothing. */
  season: string
  onSaved: () => void
}) {
  const stored = row.target
  const noneAvailable = isNoneAvailable(stored)
  const skipped = isOfficerSkip(stored)
  const storedValue =
    stored && !noneAvailable && !skipped ? stored.target_tokens : null

  const [draft, setDraft] = useState<string>(
    storedValue != null ? String(storedValue) : ''
  )
  const [status, setStatus] = useState<SaveStatus>('idle')

  const parsed = Number.parseFloat(draft)
  const valid = Number.isFinite(parsed) && parsed > 0
  const dirty = valid && parsed !== storedValue

  const mutation = useMutation({
    mutationFn: async (value: number) => {
      // No `skip`: it would un-skip primes on every edit. `guildCode` is required, or
      // the route falls back to the caller's guild and a peer-guild edit overwrites it.
      await saveTargetToken({
        // The bossType slug (EOT_GR_data.Name / boss_mapping.boss_type), not the display label.
        bossType: row.boss_type,
        rarity: row.rarity,
        set: row.set,
        encounterId: asEncounterId(row.encounter_id),
        targetTokens: value,
        seasonNumber: season,
        guildCode
      })
    },
    onMutate: () => setStatus('saving'),
    onSuccess: () => {
      setStatus('saved')
      onSaved()
    },
    onError: () => setStatus('error')
  })

  const setDraftNumber = (value: number) => {
    const next = Math.max(1, Math.round(value * 100) / 100)
    setDraft(
      Number.isInteger(next)
        ? String(next)
        : next.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    )
    setStatus('idle')
  }

  const save = () => {
    if (!valid || !dirty || mutation.isPending) return
    mutation.mutate(parsed)
  }

  const display = noneAvailable ? (
    <span className="text-red-400/70" title="No historical data at any tier">
      none
    </span>
  ) : skipped ? (
    <span className="italic text-amber-100/40">skipped</span>
  ) : storedValue != null ? (
    <span className="font-semibold text-[var(--text-primary)]">
      {storedValue}
    </span>
  ) : (
    <span className="text-amber-100/30">—</span>
  )

  if (!canManage) {
    return <span className="font-mono text-xs">{display}</span>
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="font-mono text-xs group-hover:hidden">{display}</span>
      <div className="hidden items-stretch gap-1 group-hover:flex focus-within:flex">
        <button
          type="button"
          onClick={() =>
            setDraftNumber((valid ? parsed : (storedValue ?? 1)) - 1)
          }
          disabled={mutation.isPending || (valid && parsed <= 1)}
          aria-label={`Decrease target tokens for ${getBossDisplayName(row.display_name)} ${encounterLabel(row.encounter_id)}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-black/20 text-amber-100/70 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setStatus('idle')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
          disabled={mutation.isPending}
          inputMode="decimal"
          placeholder="—"
          aria-label={`${getBossDisplayName(row.display_name)} target tokens`}
          className="h-6 w-14 rounded border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--bg-primary)] px-1 text-center font-mono text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[color-mix(in_srgb,var(--primary)_70%,transparent)]"
        />
        <button
          type="button"
          onClick={() =>
            setDraftNumber((valid ? parsed : (storedValue ?? 0)) + 1)
          }
          disabled={mutation.isPending}
          aria-label={`Increase target tokens for ${getBossDisplayName(row.display_name)} ${encounterLabel(row.encounter_id)}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-black/20 text-amber-100/70 hover:text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || mutation.isPending}
          aria-label={`Save target tokens for ${getBossDisplayName(row.display_name)} ${encounterLabel(row.encounter_id)}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] disabled:cursor-not-allowed disabled:border-[color-mix(in_srgb,var(--primary)_20%,transparent)] disabled:bg-black/10 disabled:text-amber-100/30"
        >
          {status === 'saving' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : status === 'saved' && !dirty ? (
            <Check className="h-3 w-3" />
          ) : (
            <Save className="h-3 w-3" />
          )}
        </button>
      </div>
      {status === 'error' && (
        <span className="text-[10px] text-red-400" role="alert">
          failed
        </span>
      )}
    </div>
  )
}

export function PerformanceTargetTokensTable({
  guildCode,
  canManage,
  selectedSeason,
  showPrimes = true,
  onShowPrimesChange
}: {
  guildCode: string
  canManage: boolean
  /** Targets apply to the current rotation only; a historical season shows a note instead. */
  selectedSeason?: string
  /** Page-level primes toggle, so one control governs score, heatmap and table. */
  showPrimes?: boolean
  onShowPrimesChange?: (next: boolean) => void
}) {
  const queryClient = useQueryClient()

  // Same query keys as TargetsClient so edits invalidate both surfaces.
  const scheduleQuery = useQuery<ScheduleResponse>({
    queryKey: ['target-tokens-schedule'] as const,
    queryFn: async () => {
      const res = await fetch('/api/boss-assignments/target-tokens/schedule')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 10 * 60_000
  })

  // Season-scoped: unscoped, the GET returns both the '' and season rows and
  // `targetByKey` would pick one arbitrarily. Gated on the schedule for that reason.
  const currentRotationSeason = scheduleQuery.data?.current.season_number
  const currentSeasonParam =
    currentRotationSeason != null ? String(currentRotationSeason) : null

  const targetsQuery = useQuery<TargetsResponse>({
    queryKey: ['boss-target-tokens', guildCode, currentSeasonParam] as const,
    queryFn: async () => {
      const res = await fetch(
        `${TARGET_TOKENS_ENDPOINT}?guild_code=${encodeURIComponent(guildCode)}&season=${encodeURIComponent(currentSeasonParam as string)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!guildCode && currentSeasonParam != null,
    staleTime: 60_000
  })

  // Non-essential aids: a failure leaves those columns blank instead of blocking.
  const rotationStatsQuery = useQuery<RotationStatsResponse>({
    queryKey: ['boss-rotation-stats', guildCode, currentSeasonParam] as const,
    queryFn: async () => {
      const res = await fetch(
        `${ROTATION_STATS_ENDPOINT}?guild_code=${encodeURIComponent(guildCode)}&season=${encodeURIComponent(currentSeasonParam as string)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!guildCode && currentSeasonParam != null,
    staleTime: 5 * 60_000
  })

  const currentSlots = scheduleQuery.data?.current.slots
  const targetRows = targetsQuery.data?.rows
  const rotationStats = rotationStatsQuery.data?.stats

  const rows = useMemo((): MergedRow[] => {
    const slots = currentSlots ?? []
    const targetByKey = new Map<string, TargetRow>()
    ;(targetRows ?? []).forEach((r) => {
      targetByKey.set(
        `${r.boss_name}__${r.rarity}__${r.set}__${r.encounter_id}`,
        r
      )
    })

    return slots
      .filter((s) => s.rarity === 'Legendary' || s.rarity === 'Mythic')
      .map<MergedRow>((slot) => {
        const rarity = slot.rarity as 'Legendary' | 'Mythic'
        const key = `${slot.boss_type}__${rarity}__${slot.set}__${slot.encounter_id}`
        return {
          boss_type: slot.boss_type,
          display_name: slot.boss_name,
          rarity,
          set: slot.set,
          encounter_id: slot.encounter_id,
          target: targetByKey.get(key) ?? null,
          stats: rotationStats?.[key] ?? null
        }
      })
      .sort((a, b) => {
        const ra = a.rarity === 'Legendary' ? 0 : 1
        const rb = b.rarity === 'Legendary' ? 0 : 1
        return ra - rb || a.set - b.set || a.encounter_id - b.encounter_id
      })
  }, [currentSlots, targetRows, rotationStats])

  const visibleRows = useMemo(
    () => rows.filter((r) => showPrimes || r.encounter_id === 0),
    [rows, showPrimes]
  )

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: ['boss-target-tokens', guildCode]
    })
    // The target-weighted chart and heatmap use these as their denominator; refresh them.
    queryClient.invalidateQueries({
      queryKey: ['target-weighted-token-performance']
    })
  }

  const loading = scheduleQuery.isLoading || targetsQuery.isLoading
  const errored = scheduleQuery.isError || targetsQuery.isError
  const seasonNumber = scheduleQuery.data?.current.season_number
  const viewingNonCurrentSeason =
    selectedSeason != null &&
    seasonNumber != null &&
    Number(selectedSeason) !== seasonNumber

  return (
    <div className="bg-card/50 rounded-lg border border-[color-mix(in_srgb,var(--primary)_20%,transparent)] overflow-hidden">
      <div className="p-4 border-b border-[color-mix(in_srgb,var(--primary)_20%,transparent)] flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--primary)]">
            Target Tokens by Boss
          </h2>
          <p className="text-xs text-amber-100/60 mt-1">
            Officer-set normative target tokens for{' '}
            {seasonNumber ? `Season ${seasonNumber}` : 'the current rotation'} —
            the denominator behind the target-weighted score above.{' '}
            {canManage ? (
              <>Hover a row to adjust the allocation. </>
            ) : (
              <>Set by your guild&apos;s officers on </>
            )}
            <Link href="/boss-assignments/targets" className="underline">
              Targets
            </Link>{' '}
            and the{' '}
            <Link href="/boss-playbooks" className="underline">
              Boss Playbooks
            </Link>
            .
          </p>
        </div>
        {onShowPrimesChange ? (
          <label
            className="flex items-center gap-1 text-xs text-amber-100/70"
            title="Include prime encounters in scores, the heatmap, and this table. Mirrors the Compare buttons above — “Boss Only” = primes excluded."
          >
            <input
              type="checkbox"
              checked={showPrimes}
              onChange={(e) => onShowPrimesChange(e.target.checked)}
              className="h-3 w-3"
            />
            Primes
          </label>
        ) : (
          !showPrimes && (
            <span className="text-xs text-amber-100/50">
              Primes hidden — controlled by &ldquo;Include primes&rdquo; in the
              scoring controls above.
            </span>
          )
        )}
      </div>

      {viewingNonCurrentSeason ? (
        <div className="p-6 text-center text-xs text-amber-100/60">
          Target tokens are the officer-set allocation for the current rotation
          {seasonNumber ? ` (Season ${seasonNumber})` : ''}; they don&apos;t
          apply to the Season {selectedSeason} view above.
        </div>
      ) : loading ? (
        <div className="p-6 text-center text-xs text-amber-100/60">
          Loading targets…
        </div>
      ) : errored ? (
        <div className="p-6 text-center text-xs text-red-400" role="alert">
          Couldn&apos;t load target tokens
          {targetsQuery.isError ? ' for this guild' : ''}. Try refreshing —
          showing no targets here would misreport every boss as unset.
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="p-6 text-center text-xs text-amber-100/60">
          No bosses in the current rotation.
        </div>
      ) : (
        <div className="overflow-auto max-h-[50vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--bg-primary)] border-b border-[color-mix(in_srgb,var(--primary)_30%,transparent)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-amber-100/80">
                  Boss
                </th>
                <th className="px-3 py-2 text-center font-medium text-amber-100/80">
                  Tier
                </th>
                <th className="px-3 py-2 text-center font-medium text-amber-100/80">
                  Encounter
                </th>
                <th
                  className="px-3 py-2 text-right font-medium text-amber-100/80"
                  title="Max HP for this boss/encounter"
                >
                  Boss HP
                </th>
                <th
                  className="px-3 py-2 text-right font-medium text-amber-100/80"
                  title="Guild average damage per attack this rotation"
                >
                  Guild AVG Damage
                </th>
                <th
                  className="px-3 py-2 text-right font-medium text-amber-100/80"
                  title="Average tokens spent per completed loop this rotation"
                >
                  AVG Tokens/Loop
                </th>
                <th
                  className="px-3 py-2 text-right font-medium text-amber-100/80"
                  title="Tokens spent on the last completed loop"
                >
                  Tokens Last Loop
                </th>
                <th className="px-3 py-2 text-right font-medium text-amber-100/80">
                  Target tokens
                </th>
                <th className="px-3 py-2 text-center font-medium text-amber-100/80">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const noneAvailable = isNoneAvailable(row.target)
                const skipped = isOfficerSkip(row.target)
                const rowDim = skipped || noneAvailable ? 'opacity-50' : ''
                return (
                  <tr
                    key={`${row.boss_type}__${row.rarity}__${row.set}__${row.encounter_id}`}
                    className={`group border-t border-[var(--card-border)] hover:bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)] ${rowDim}`}
                  >
                    <td className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap">
                      {getBossDisplayName(row.display_name)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-xs text-amber-300">
                      {levelLabel(row.rarity, row.set)}
                    </td>
                    <td
                      className={`px-3 py-2 text-center text-xs ${row.encounter_id === 0 ? 'text-amber-100/70' : 'text-purple-300'}`}
                    >
                      {encounterLabel(row.encounter_id)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-amber-100/70">
                      {formatStatCompact(row.stats?.bossHp)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-amber-100/70">
                      {formatStatCompact(row.stats?.avgDamagePerHit)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-amber-100/70">
                      {formatTokenStat(row.stats?.avgTokensPerLoop)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-amber-100/70">
                      {formatTokenStat(row.stats?.tokensLastLoop)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TargetCell
                        row={row}
                        canManage={canManage}
                        guildCode={guildCode}
                        // Defined here: this branch renders only after the schedule loads.
                        season={currentSeasonParam ?? ''}
                        onSaved={invalidate}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {noneAvailable ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/40">
                          None available
                        </span>
                      ) : skipped ? (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-gray-500/20 text-gray-300 border border-gray-500/30">
                          Skip
                        </span>
                      ) : row.target ? (
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            row.target.source === 'officer_manual'
                              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                          title={
                            row.target.source === 'historical_seed' &&
                            row.target.seeded_from_seasons
                              ? `Seeded from ${row.target.seeded_from_seasons}`
                              : undefined
                          }
                        >
                          {row.target.source === 'officer_manual'
                            ? 'Manual'
                            : 'Seeded'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] text-amber-100/40 border border-amber-100/10">
                          Unset
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
