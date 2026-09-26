'use client'

import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List
} from 'lucide-react'
import {
  SORT_OPTIONS,
  type RosterViewMode,
  type SortField
} from '../_lib/roster-constants'
import type { RosterFiltersApi } from '../_lib/useRosterFilters'
import { RosterSelect } from './RosterFilterBar'

interface RosterToolbarProps {
  rf: RosterFiltersApi
  shownCount: number
  totalCount: number
  viewMode: RosterViewMode
  onViewModeChange: (mode: RosterViewMode) => void
}

export function RosterToolbar({
  rf,
  shownCount,
  totalCount,
  viewMode,
  onViewModeChange
}: RosterToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <span className="text-sm text-[var(--text-secondary)]">
        {shownCount}
        {shownCount !== totalCount ? ` of ${totalCount}` : ''} characters
      </span>
      <div className="flex items-center gap-2">
        <ArrowUpDown className="h-4 w-4 text-[var(--text-secondary)]" />
        <RosterSelect
          value={rf.sortField}
          onChange={(value) => rf.changeSortField(value as SortField)}
          ariaLabel="Sort by"
          className="w-36"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </RosterSelect>
        <button
          onClick={rf.toggleSortDirection}
          className="inline-flex h-9 w-9 items-center justify-center rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
          aria-label={`Sort ${rf.sortDirection === 'asc' ? 'ascending' : 'descending'}`}
        >
          {rf.sortDirection === 'asc' ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        <div className="hidden md:flex items-center rounded border border-[var(--card-border)] overflow-hidden">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`inline-flex h-9 w-9 items-center justify-center transition-colors ${
              viewMode === 'grid'
                ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] font-semibold text-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
            }`}
            aria-label="Grid view"
            title="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => onViewModeChange('table')}
            className={`inline-flex h-9 w-9 items-center justify-center transition-colors ${
              viewMode === 'table'
                ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] font-semibold text-[var(--accent)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]'
            }`}
            aria-label="Table view"
            title="Table view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
