'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronRight, Calendar, Swords } from 'lucide-react'
import { Badge } from '@tacticus/ui-kit'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import { formatUtcDateShort } from '@/app/lib/season-date/date-format'

interface WarMatchRow {
  war_id: string
  opponent_guild_name: string
  war_status: string
  war_result: string | null
  guild_score: number | null
  opponent_score: number | null
  war_start_date: string | null
  war_end_date: string | null
  war_season: number | null
  battlefield_level: number | null
}

interface WarMatchCardProps {
  match: WarMatchRow
  isActive?: boolean
}

function resultBadgeClasses(result: string): string {
  switch (result) {
    case 'win':
      return 'bg-green-500/10 text-green-400 border-green-500/20'
    case 'loss':
      return 'bg-red-500/10 text-red-400 border-red-500/20'
    case 'draw':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    default:
      return 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
  }
}

// UTC YYYY-MM-DD, locale-independent, 'Unknown' sentinel.
const formatDateShort = formatUtcDateShort

export function WarMatchCard({ match, isActive }: WarMatchCardProps) {
  const searchParams = useSearchParams()
  const currentSeason = searchParams.get('season')

  const guildScore = match.guild_score ?? 0
  const opponentScore = match.opponent_score ?? 0
  const displayDate = isActive ? match.war_start_date : match.war_end_date

  return (
    <Link href={getHrefWithSeason(`/wars/${match.war_id}`, currentSeason)}>
      <div className="group card-wh40k p-3 hover:border-[var(--accent)] transition-colors cursor-pointer h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-[var(--text-primary)] truncate leading-tight">
              vs {match.opponent_guild_name || 'Unknown'}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5 flex items-center gap-1.5">
              <Swords className="h-3.5 w-3.5 shrink-0" />
              {guildScore} – {opponentScore}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isActive ? (
              <Badge className="bg-green-500/10 text-green-400 border-green-500/20">
                Active
              </Badge>
            ) : match.war_result ? (
              <Badge className={resultBadgeClasses(match.war_result)}>
                {match.war_result.charAt(0).toUpperCase() +
                  match.war_result.slice(1)}
              </Badge>
            ) : null}
            <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)] group-hover:text-[var(--accent)] transition-colors" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
            <Calendar className="h-3 w-3" />
            {formatDateShort(displayDate)}
          </span>
          {match.war_season != null && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              S{match.war_season}
            </span>
          )}
          {match.battlefield_level != null && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
              BF{match.battlefield_level}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
