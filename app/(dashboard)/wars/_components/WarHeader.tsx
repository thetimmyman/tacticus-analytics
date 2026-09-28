'use client'

import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Badge, Card, CardContent, CardHeader } from '@tacticus/ui-kit'
import { ArrowDown, ArrowUp, Swords } from 'lucide-react'
import { Avatar } from '@tacticus/ui-kit'
import type { WarInfo } from '../_types'
import { formatNumber } from './war-shared'
import { cn } from '@/app/lib/utils/cn'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Not a guild_code UUID, '???'/'opp' placeholders, or id-length strings.
const isRealGuildTag = (tag?: string | null): tag is string =>
  !!tag &&
  tag !== '???' &&
  tag.toLowerCase() !== 'opp' &&
  tag.length <= 12 &&
  !UUID_RE.test(tag)

const getStatusBadge = (status: WarInfo['status']) => {
  switch (status) {
    case 'completed':
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/40">
          Completed
        </Badge>
      )
    case 'in_progress':
      return (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 animate-pulse">
          In Progress
        </Badge>
      )
    case 'scheduled':
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/40">
          Scheduled
        </Badge>
      )
    case 'cancelled':
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/40">
          Cancelled
        </Badge>
      )
    default:
      return (
        <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
          Unknown
        </Badge>
      )
  }
}

/** `--success`/`--danger` via color-mix stay legible in every theme. */
type WarOutcomeTone = 'ahead' | 'behind' | 'even'

const OUTCOME_CHROME: Record<WarOutcomeTone, { card: string; bar: string }> = {
  ahead: {
    card: 'border-[color-mix(in_srgb,var(--success)_45%,var(--border))]',
    bar: 'bg-[color-mix(in_srgb,var(--success)_75%,transparent)]'
  },
  behind: {
    card: 'border-[color-mix(in_srgb,var(--danger)_45%,var(--border))]',
    bar: 'bg-[color-mix(in_srgb,var(--danger)_75%,transparent)]'
  },
  even: {
    card: 'border-(--border)',
    bar: 'bg-(--border)'
  }
}

/** Prefer `war_result`, else the live score delta. */
export function getWarOutcomeTone(war: WarInfo): WarOutcomeTone {
  if (war.result === 'win') return 'ahead'
  if (war.result === 'loss') return 'behind'
  if (war.result === 'draw') return 'even'
  if (war.status === 'scheduled' || war.status === 'cancelled') return 'even'
  const diff = war.guild.score - war.opponent.score
  if (diff > 0) return 'ahead'
  if (diff < 0) return 'behind'
  return 'even'
}

export default function WarHeader({ war }: { war: WarInfo }) {
  const hasMounted = useHasMounted()

  const scoreDiff = war.guild.score - war.opponent.score
  const canShowLiveDelta =
    war.result == null &&
    (war.status === 'in_progress' || war.status === 'completed')
  const isWinning = canShowLiveDelta && scoreDiff > 0
  const isLosing = canShowLiveDelta && scoreDiff < 0

  const outcome = getWarOutcomeTone(war)
  const chrome = OUTCOME_CHROME[outcome]

  return (
    <Card
      data-war-outcome={outcome}
      className={cn('overflow-hidden bg-(--bg-primary)', chrome.card)}
    >
      <div className={cn('h-1 w-full', chrome.bar)} aria-hidden="true" />
      <CardHeader className="pb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Swords className="h-5 w-5 text-(--accent)" />
            <div>
              <div className="text-sm text-secondary-wh40k">Guild War</div>
              <div className="text-lg font-semibold text-primary-wh40k">
                {war.guild.guildName} vs {war.opponent.guildName}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {getStatusBadge(war.status)}
            <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
              Starts{' '}
              {hasMounted
                ? new Date(war.startTime).toLocaleDateString()
                : war.startTime?.slice(0, 10)}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-3 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="flex items-center gap-3">
            <Avatar
              displayName={war.guild.guildName}
              guildCode={war.guild.guildTag}
              size="lg"
            />
            <div>
              {isRealGuildTag(war.guild.guildTag) && (
                <div className="text-sm text-secondary-wh40k">
                  {war.guild.guildTag}
                </div>
              )}
              <div className="text-xl font-semibold text-primary-wh40k">
                {war.guild.guildName}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              className="text-2xl font-bold text-primary-wh40k font-mono"
              title="Game-reported official war total, including zone-capture bonuses (up to ~40K per capture)."
            >
              {formatNumber(war.guild.score)} -{' '}
              {formatNumber(war.opponent.score)}
            </div>
            <div className="text-xs text-(--text-tertiary)">Official score</div>
            <div className="flex items-center gap-2 text-sm">
              {war.result === 'win' && (
                <span className="text-green-400 flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" />
                  Victory
                </span>
              )}
              {war.result === 'loss' && (
                <span className="text-red-400 flex items-center gap-1">
                  <ArrowDown className="h-3 w-3" />
                  Defeat
                </span>
              )}
              {war.result === 'draw' && (
                <span className="text-secondary-wh40k">Draw</span>
              )}
              {war.result == null && isWinning && (
                <span className="text-green-400 flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" />
                  Leading by {formatNumber(scoreDiff)}
                </span>
              )}
              {war.result == null && isLosing && (
                <span className="text-red-400 flex items-center gap-1">
                  <ArrowDown className="h-3 w-3" />
                  Behind by {formatNumber(Math.abs(scoreDiff))}
                </span>
              )}
              {canShowLiveDelta && !isWinning && !isLosing && (
                <span className="text-secondary-wh40k">Tied</span>
              )}
              {war.result == null && war.status === 'scheduled' && (
                <span className="text-secondary-wh40k">Not started</span>
              )}
              {war.result == null && war.status === 'cancelled' && (
                <span className="text-secondary-wh40k">No active outcome</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            <div className="text-right">
              {isRealGuildTag(war.opponent.guildTag) && (
                <div className="text-sm text-secondary-wh40k">
                  {war.opponent.guildTag}
                </div>
              )}
              <div className="text-xl font-semibold text-primary-wh40k">
                {war.opponent.guildName}
              </div>
            </div>
            <Avatar
              displayName={war.opponent.guildName}
              guildCode={war.opponent.guildTag}
              size="lg"
            />
          </div>
        </div>

        {war.endTime && (
          <div className="flex flex-wrap gap-3 text-xs text-(--text-tertiary)">
            <span>
              Ends{' '}
              {hasMounted
                ? new Date(war.endTime).toLocaleDateString()
                : war.endTime?.slice(0, 10)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
