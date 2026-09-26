'use client'

import { X, Search } from 'lucide-react'
import type { RecentAttempt } from '../_types'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

export interface ActivityFilters {
  playerSearch: string
  selectedZone: string
}

export const DEFAULT_FILTERS: ActivityFilters = {
  playerSearch: '',
  selectedZone: 'all'
}

export function applyActivityFilters(
  attempts: RecentAttempt[],
  filters: ActivityFilters
): RecentAttempt[] {
  let result = attempts

  if (filters.playerSearch) {
    const q = filters.playerSearch.toLowerCase()
    result = result.filter(
      (a) =>
        a.attacker.name.toLowerCase().includes(q) ||
        a.defender.name.toLowerCase().includes(q) ||
        a.attacker.guildTag.toLowerCase().includes(q) ||
        a.defender.guildTag.toLowerCase().includes(q)
    )
  }

  if (filters.selectedZone !== 'all') {
    // Legacy zone_name is 'trenches' for all three Trenches zones.
    result = result.filter((a) => a.zoneType === filters.selectedZone)
  }

  return result
}

interface ActivityFilterBarProps {
  filters: ActivityFilters
  onChange: (filters: ActivityFilters) => void
  attempts: RecentAttempt[]
}

export default function ActivityFilterBar({
  filters,
  onChange,
  attempts
}: ActivityFilterBarProps) {
  const zoneOptions = [
    ...new Set(attempts.map((a) => a.zoneType).filter(Boolean))
  ]
    .map((zoneType) => ({ zoneType, label: zoneDisplayName(zoneType) }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const activeCount = [
    filters.playerSearch !== '',
    filters.selectedZone !== 'all'
  ].filter(Boolean).length

  const clear = () => onChange(DEFAULT_FILTERS)

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Player / guild search */}
      <div className="relative flex items-center">
        <Search className="absolute left-2 w-3.5 h-3.5 text-[var(--text-tertiary)] pointer-events-none" />
        <input
          type="text"
          value={filters.playerSearch}
          onChange={(e) =>
            onChange({ ...filters, playerSearch: e.target.value })
          }
          placeholder="Search player or guild…"
          className="pl-7 pr-3 py-1 text-xs rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--primary)] w-48"
        />
      </div>

      {/* Zone dropdown */}
      {zoneOptions.length > 0 && (
        <select
          value={filters.selectedZone}
          onChange={(e) =>
            onChange({ ...filters, selectedZone: e.target.value })
          }
          className="px-2 py-1 text-xs rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary)]"
        >
          <option value="all">All zones</option>
          {zoneOptions.map(({ zoneType, label }) => (
            <option key={zoneType} value={zoneType}>
              {label}
            </option>
          ))}
        </select>
      )}

      {/* Clear filters */}
      {activeCount > 0 && (
        <button
          onClick={clear}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-3 h-3" />
          Clear ({activeCount})
        </button>
      )}
    </div>
  )
}
