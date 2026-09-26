'use client'

import { useMemo, useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import {
  RadixDropdownMenu,
  RadixDropdownMenuTrigger,
  RadixDropdownMenuContent,
  RadixDropdownMenuCheckboxItem,
  RadixDropdownMenuLabel,
  RadixDropdownMenuSeparator
} from '@tacticus/ui-kit/radix-dropdown'
import { extractErrorMessage as extractErrorEnvelope } from '@/app/lib/utils/error-message'

// Writes `source='leader_override'` rows: empty/self/auto → POST, leader_override → DELETE,
// so removing a 'self' row takes two clicks.

export interface MetaTeamOption {
  id: string
  team_name: string
  description: string | null
}

export interface PlayerMetaRoleRow {
  id: string
  user_id: string
  meta_team_id: string
  source: 'self' | 'leader_override' | 'auto' | 'manual'
}

interface LeaderRoleOverrideCellProps {
  targetUserId: string | null
  targetDisplayName: string | null
  metaTeamOptions: MetaTeamOption[]
  rows: PlayerMetaRoleRow[]
  canEdit: boolean
  onChange: (newRows: PlayerMetaRoleRow[]) => void
}

const extractErrorMessage = (body: unknown, status: number): string =>
  extractErrorEnvelope(body, `Request failed (${status})`)

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  self: {
    label: 'self',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  },
  leader_override: {
    label: 'leader',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  },
  auto: {
    label: 'auto',
    className: 'border-sky-500/40 bg-sky-500/10 text-sky-300'
  },
  manual: {
    label: 'manual',
    className: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300'
  }
}

export function LeaderRoleOverrideCell({
  targetUserId,
  targetDisplayName,
  metaTeamOptions,
  rows,
  canEdit,
  onChange
}: LeaderRoleOverrideCellProps) {
  const [pendingTeamId, setPendingTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const teamMap = useMemo(() => {
    const m = new Map<string, MetaTeamOption>()
    metaTeamOptions.forEach((t) => m.set(t.id, t))
    return m
  }, [metaTeamOptions])

  const rowByTeamId = useMemo(() => {
    const m = new Map<string, PlayerMetaRoleRow>()
    rows.forEach((r) => m.set(r.meta_team_id, r))
    return m
  }, [rows])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const an = teamMap.get(a.meta_team_id)?.team_name ?? a.meta_team_id
      const bn = teamMap.get(b.meta_team_id)?.team_name ?? b.meta_team_id
      return an.localeCompare(bn)
    })
  }, [rows, teamMap])

  if (!targetUserId) {
    return (
      <span className="text-xs text-[var(--text-tertiary)]">Unclaimed</span>
    )
  }

  const handleToggle = async (team: MetaTeamOption) => {
    if (pendingTeamId !== null) return
    const currentRow = rowByTeamId.get(team.id) ?? null
    setPendingTeamId(team.id)
    setError(null)

    // Optimistic: compute the expected rows up front; replay the prior rows on failure.
    const isDelete = currentRow?.source === 'leader_override'
    const prevRows = rows
    let optimisticNext: PlayerMetaRoleRow[]
    if (isDelete) {
      optimisticNext = rows.filter((r) => r.meta_team_id !== team.id)
    } else {
      const stub: PlayerMetaRoleRow = {
        id: currentRow?.id ?? `optimistic-${team.id}`,
        user_id: targetUserId,
        meta_team_id: team.id,
        source: 'leader_override'
      }
      const others = rows.filter((r) => r.meta_team_id !== team.id)
      optimisticNext = [...others, stub]
    }
    onChange(optimisticNext)

    try {
      let res: Response
      if (isDelete) {
        const params = new URLSearchParams({
          user_id: targetUserId,
          meta_team_id: team.id,
          source: 'leader_override'
        })
        res = await fetch(`/api/player-meta-roles?${params.toString()}`, {
          method: 'DELETE'
        })
      } else {
        res = await fetch('/api/player-meta-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: targetUserId,
            meta_team_id: team.id,
            source: 'leader_override'
          })
        })
      }
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        onChange(prevRows)
        setError(extractErrorMessage(body, res.status))
        return
      }

      if (!isDelete && body && body.row) {
        const real = body.row as PlayerMetaRoleRow
        onChange([
          ...optimisticNext.filter((r) => r.meta_team_id !== team.id),
          real
        ])
      }
    } catch (err) {
      onChange(prevRows)
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setPendingTeamId(null)
    }
  }

  return (
    <div className="text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {sortedRows.length === 0 ? (
          <span className="text-[var(--text-secondary)]">None</span>
        ) : (
          sortedRows.map((r) => {
            const team = teamMap.get(r.meta_team_id)
            const badge = SOURCE_BADGE[r.source] ?? {
              label: 'Manual',
              className: 'border-blue-500/30 bg-blue-500/10 text-blue-200'
            }
            return (
              <span
                key={r.id}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${badge.className}`}
                title={`Source: ${r.source}`}
              >
                <span>{team?.team_name ?? r.meta_team_id.slice(0, 6)}</span>
                <span className="opacity-70">({badge.label})</span>
              </span>
            )
          })
        )}

        {canEdit && (
          <RadixDropdownMenu open={open} onOpenChange={setOpen}>
            <RadixDropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-[var(--card-border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] hover:text-[var(--accent)] transition-colors"
                aria-label={`Edit Herald roles for ${targetDisplayName ?? 'member'}`}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
            </RadixDropdownMenuTrigger>
            <RadixDropdownMenuContent
              align="start"
              className="max-h-72 w-64 overflow-y-auto"
            >
              <RadixDropdownMenuLabel>
                Herald roles for {targetDisplayName ?? 'member'}
              </RadixDropdownMenuLabel>
              <RadixDropdownMenuSeparator />
              {metaTeamOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs italic text-[var(--text-secondary)]">
                  No meta teams configured.
                </div>
              ) : (
                metaTeamOptions.map((team) => {
                  const row = rowByTeamId.get(team.id) ?? null
                  const checked = row !== null
                  const isPending = pendingTeamId === team.id
                  const sourceLabel = row
                    ? (SOURCE_BADGE[row.source]?.label ?? row.source)
                    : null
                  return (
                    <RadixDropdownMenuCheckboxItem
                      key={team.id}
                      checked={checked}
                      onSelect={(e) => {
                        // Stay open across multi-select toggles.
                        e.preventDefault()
                        void handleToggle(team)
                      }}
                      disabled={isPending}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="truncate">{team.team_name}</span>
                        {isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : sourceLabel ? (
                          <span className="text-[10px] opacity-60">
                            {sourceLabel}
                          </span>
                        ) : null}
                      </div>
                    </RadixDropdownMenuCheckboxItem>
                  )
                })
              )}
            </RadixDropdownMenuContent>
          </RadixDropdownMenu>
        )}
      </div>

      {error && <div className="text-[10px] text-rose-300">{error}</div>}
    </div>
  )
}
