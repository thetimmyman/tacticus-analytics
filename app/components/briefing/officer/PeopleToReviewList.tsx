'use client'

/**
 * Ranked "People to review" list. "All signals" is the deduped union, first
 * occurrence in needs_support → team_upgrades → doing_great order.
 */

import { Users } from 'lucide-react'
import {
  FilterChips,
  type BriefingFilter
} from '@/app/components/briefing/officer/FilterChips'
import { MemberReviewRow } from '@/app/components/briefing/officer/MemberReviewRow'
import type { MemberSignalRow } from '@/app/lib/officer-briefing/types'

interface PeopleToReviewListProps {
  filter: BriefingFilter
  onFilterChange: (filter: BriefingFilter) => void
  needsReview: MemberSignalRow[]
  recognition: MemberSignalRow[]
  teamUpgrades: MemberSignalRow[]
  selectedMember: string | null
  onSelectMember: (displayName: string) => void
}

function dedupeByName(rows: MemberSignalRow[]): MemberSignalRow[] {
  const seen = new Set<string>()
  const out: MemberSignalRow[] = []
  for (const r of rows) {
    if (seen.has(r.displayName)) continue
    seen.add(r.displayName)
    out.push(r)
  }
  return out
}

export interface DisplayBuckets {
  needsSupport: MemberSignalRow[]
  teamUpgrades: MemberSignalRow[]
  doingGreat: MemberSignalRow[]
  all: MemberSignalRow[]
}

/**
 * Single source of the disjoint tab taxonomy (tabs, chips, cards): Needs support =
 * every below-expectation case; Team upgrades = fieldable upside but not
 * needs-review; Doing great = recognition.
 */
export function computeDisplayBuckets(
  needsReview: MemberSignalRow[],
  teamUpgrades: MemberSignalRow[],
  recognition: MemberSignalRow[]
): DisplayBuckets {
  const needsReviewNames = new Set(needsReview.map((r) => r.displayName))
  const teamUpgradesDisjoint = teamUpgrades.filter(
    (t) => !needsReviewNames.has(t.displayName)
  )
  return {
    needsSupport: needsReview,
    teamUpgrades: teamUpgradesDisjoint,
    doingGreat: recognition,
    all: dedupeByName([...needsReview, ...teamUpgradesDisjoint, ...recognition])
  }
}

export function PeopleToReviewList({
  filter,
  onFilterChange,
  needsReview,
  recognition,
  teamUpgrades,
  selectedMember,
  onSelectMember
}: PeopleToReviewListProps) {
  const {
    needsSupport,
    teamUpgrades: teamUpgradesDisplayed,
    doingGreat,
    all
  } = computeDisplayBuckets(needsReview, teamUpgrades, recognition)

  const visible: MemberSignalRow[] =
    filter === 'needs_support'
      ? needsSupport
      : filter === 'team_upgrades'
        ? teamUpgradesDisplayed
        : filter === 'doing_great'
          ? doingGreat
          : all

  return (
    <section
      className="rounded-xl border border-[var(--card-border)] bg-card/30 overflow-hidden"
      aria-label="People to review"
    >
      <header className="border-b border-[color-mix(in_srgb,var(--card-border)_50%,transparent)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--accent)]" aria-hidden />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            People to review
          </h2>
        </div>
        <p className="mt-0.5 pl-6 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
          Ranked by impact × confidence × urgency
        </p>
      </header>

      <div className="space-y-3 p-4">
        <FilterChips
          active={filter}
          counts={{
            needsSupport: needsSupport.length,
            teamUpgrades: teamUpgradesDisplayed.length,
            doingGreat: doingGreat.length,
            all: all.length
          }}
          onChange={onFilterChange}
        />

        {visible.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--text-tertiary)]">
            Nothing here right now — no members match this filter.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((row) => (
              <li key={row.displayName}>
                <MemberReviewRow
                  row={row}
                  selected={row.displayName === selectedMember}
                  onSelect={onSelectMember}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[color-mix(in_srgb,var(--card-border)_40%,transparent)] px-4 py-2.5 text-[11px] text-[var(--text-tertiary)]">
        Only exceptions are shown. Full roster stays in Guild Ops.{' '}
        <a
          href="/guild-management/members"
          className="text-[var(--accent)] hover:underline"
        >
          Open all members →
        </a>
      </div>
    </section>
  )
}
