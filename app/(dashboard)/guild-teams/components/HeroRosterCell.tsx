'use client'

import { memo } from 'react'
import { StarDisplay } from '@/app/components/StarDisplay'
import { RankIcon } from '@/app/(dashboard)/roster/components/RankIcon'
import { getRankIndexFromName } from '@/app/(dashboard)/roster/utils/roster-helpers'
import type { GuildTeamRosterEntry } from '../types'

interface HeroRosterCellProps {
  data: GuildTeamRosterEntry | null
  isMow?: boolean
}

export const HeroRosterCell = memo(function HeroRosterCell({
  data,
  isMow
}: HeroRosterCellProps) {
  if (!data || data.stars == null) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60px] text-[var(--text-secondary)]">
        —
      </div>
    )
  }

  const rankIndex = data.rank_name ? getRankIndexFromName(data.rank_name) : 0
  const hasAbilities =
    data.active_ability_level != null || data.passive_ability_level != null

  return (
    <div className="flex flex-col items-center gap-0.5 py-1 px-0.5 text-center min-h-[60px]">
      {/* Stars */}
      <StarDisplay
        progressionIndex={data.progression_index ?? data.stars ?? 0}
        size="sm"
      />

      {/* Rank — hidden for Machines of War */}
      {!isMow && <RankIcon rank={rankIndex} size="sm" />}

      {/* Level */}
      {data.xp_level != null && (
        <span className="text-[10px] text-[var(--text-primary)] leading-none">
          L{data.xp_level}
        </span>
      )}

      {/* Ability Levels */}
      {hasAbilities && (
        <span className="text-[10px] text-[var(--text-secondary)] leading-none whitespace-nowrap">
          A:{data.active_ability_level ?? '?'} P:
          {data.passive_ability_level ?? '?'}
        </span>
      )}
    </div>
  )
})
