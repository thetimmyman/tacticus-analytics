'use client'

/**
 * Shared phone filter bar. Search and the primary filters never hide; secondary
 * filters may collapse behind one control, but the closed control must show how
 * many are active and a visible reset must clear them too.
 *
 * The bar never claims a result count it has not been given: pass `resultCount`
 * only when the caller knows what the count covers.
 */

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'

export interface FilterBarProps {
  /** Search input. Rendered first and never collapsed. */
  search?: ReactNode
  /** The two or three filters that carry most decisions. Never collapsed. */
  primaryFilters?: ReactNode
  /** Anything else. Collapsed behind one control that reports its active count. */
  secondaryFilters?: ReactNode
  /** Name of the control that opens the secondary group. */
  secondaryLabel?: string
  /**
   * Keeps the secondary group open from the `sm` breakpoint up, where there is
   * room for it, and hides its toggle there. Phones still collapse it.
   */
  secondaryOpenOnWide?: boolean
  /** How many secondary filters are currently applied. Drives the closed-state label. */
  activeSecondaryCount?: number
  /** How many filters are applied across every group. Drives reset visibility. */
  activeCount?: number
  /** Clears every filter, collapsed ones included. Shown whenever anything is active. */
  onReset?: () => void
  /** Page-level action (such as a refresh) shown at the end of the control row. */
  actions?: ReactNode
  /** Stated above the results, and says what it covers. */
  resultCount?: ReactNode
  children?: ReactNode
}

export function FilterBar({
  search,
  primaryFilters,
  secondaryFilters,
  secondaryLabel = 'More filters',
  secondaryOpenOnWide = false,
  activeSecondaryCount = 0,
  activeCount,
  onReset,
  actions,
  resultCount,
  children
}: FilterBarProps) {
  const [open, setOpen] = useState(false)
  const secondaryId = useId()
  // Reset shows whenever anything is active, not only when the collapsed group is.
  const hasActive = (activeCount ?? activeSecondaryCount) > 0

  return (
    <div className="space-y-2" data-testid="filter-bar">
      {search && (
        <div className="flex flex-wrap items-center gap-2">{search}</div>
      )}
      {(primaryFilters || secondaryFilters || onReset || actions) && (
        <div className="flex flex-wrap items-end gap-2">
          {primaryFilters}
          {secondaryFilters && (
            <button
              type="button"
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-(--card-border) px-3 text-sm ${secondaryOpenOnWide ? 'sm:hidden' : ''}`}
              aria-expanded={open}
              aria-controls={secondaryId}
              onClick={() => setOpen((previous) => !previous)}
            >
              <span>
                {secondaryLabel}
                {activeSecondaryCount > 0 && (
                  <>
                    {' '}
                    <span
                      className="font-semibold"
                      data-testid="filter-bar-active-count"
                    >
                      ({activeSecondaryCount} active)
                    </span>
                  </>
                )}
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
          {hasActive && onReset && (
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-(--card-border) px-3 text-sm font-semibold"
              onClick={onReset}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Reset</span>
            </button>
          )}
          {actions && <div className="ml-auto">{actions}</div>}
        </div>
      )}
      {secondaryFilters && (open || secondaryOpenOnWide) && (
        <div
          id={secondaryId}
          className={`flex-wrap items-center gap-2 rounded-lg border border-(--card-border) p-2 ${
            open ? 'flex' : 'hidden sm:flex'
          }`}
        >
          {secondaryFilters}
        </div>
      )}
      {resultCount && (
        <p
          className="text-sm text-secondary-wh40k"
          data-testid="filter-bar-count"
        >
          {resultCount}
        </p>
      )}
      {children}
    </div>
  )
}
