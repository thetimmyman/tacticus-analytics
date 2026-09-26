'use client'

/** Counted filter chips for "People to review"; the parent owns the state. */

import { LifeBuoy, TrendingUp, Award, List } from 'lucide-react'

export type BriefingFilter =
  'needs_support' | 'team_upgrades' | 'doing_great' | 'all'

interface FilterChipsProps {
  active: BriefingFilter
  counts: {
    needsSupport: number
    teamUpgrades: number
    doingGreat: number
    all: number
  }
  onChange: (filter: BriefingFilter) => void
}

interface ChipDef {
  key: BriefingFilter
  label: string
  count: number
  color: string
  icon: React.ReactNode
}

export function FilterChips({ active, counts, onChange }: FilterChipsProps) {
  const chips: ChipDef[] = [
    {
      key: 'needs_support',
      label: 'Needs support',
      count: counts.needsSupport,
      color: 'var(--warning)',
      icon: <LifeBuoy className="h-3.5 w-3.5" aria-hidden />
    },
    {
      key: 'team_upgrades',
      label: 'Team upgrades',
      count: counts.teamUpgrades,
      color: 'var(--accent)',
      icon: <TrendingUp className="h-3.5 w-3.5" aria-hidden />
    },
    {
      key: 'doing_great',
      label: 'Doing great',
      count: counts.doingGreat,
      color: 'var(--success)',
      icon: <Award className="h-3.5 w-3.5" aria-hidden />
    },
    {
      key: 'all',
      label: 'All signals',
      count: counts.all,
      color: 'var(--text-secondary)',
      icon: <List className="h-3.5 w-3.5" aria-hidden />
    }
  ]

  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label="Filter members"
    >
      {chips.map((chip) => {
        const isActive = chip.key === active
        return (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(chip.key)}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:brightness-110"
            style={{
              color: isActive ? chip.color : 'var(--text-secondary)',
              borderColor: isActive ? chip.color : 'var(--card-border)',
              backgroundColor: isActive ? 'transparent' : undefined
            }}
          >
            <span style={{ color: chip.color }}>{chip.icon}</span>
            {chip.label}
            <span
              className="rounded-full px-1.5 text-[10px] font-bold"
              style={{
                color: isActive ? 'var(--bg-primary)' : chip.color,
                backgroundColor: isActive ? chip.color : 'transparent'
              }}
            >
              {chip.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
