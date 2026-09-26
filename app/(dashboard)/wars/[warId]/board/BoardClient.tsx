'use client'

import { useMemo } from 'react'
import clsx from 'clsx'
import { Crown } from 'lucide-react'
import { Card, CardContent, CardHeader, Skeleton } from '@tacticus/ui-kit'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { formatNumber } from '@/app/lib/utils/number-format'
import { useWarBoard, useWarInfo } from '../../_hooks'
import type { PlayerStats, WarInfo } from '../../_types'
import {
  GUILD_MAX_TOKENS,
  TOKENS_PER_PLAYER,
  computeTotals,
  rankPlayers,
  resolveOutcome,
  type WarOutcome
} from './board-utils'

// 1-decimal formatter locked to en-US (like number-format.ts) so SSR/CSR match.
const avgFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

const fmtInt = (value: number): string =>
  formatNumber(value, { style: 'standard' })

type SideAccent = {
  border: string
  text: string
  bar: string
  headerBg: string
}

const ACCENTS: Record<'guild' | 'opponent', SideAccent> = {
  guild: {
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    bar: 'bg-emerald-500/10',
    headerBg: 'bg-emerald-500/5'
  },
  opponent: {
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    bar: 'bg-amber-500/10',
    headerBg: 'bg-amber-500/5'
  }
}

function FooterRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
      <span className="uppercase tracking-wide text-[11px] font-semibold text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="font-mono text-[var(--text-primary)]">{children}</span>
    </div>
  )
}

/** The `#` column is positional, so rank is precomputed once. */
type WarBoardPlayerRow = PlayerStats & { rank: number }

type WarBoardSortKey = 'rank' | 'player' | 'tokens' | 'score'

const boardColumns: DataTableColumn<WarBoardPlayerRow, WarBoardSortKey>[] = [
  {
    key: 'rank',
    header: '#',
    align: 'center',
    className: 'w-12',
    sortable: false,
    render: (row) => (
      <span className="font-mono text-[var(--text-tertiary)]">{row.rank}</span>
    )
  },
  {
    key: 'player',
    header: 'Player',
    sortable: false,
    render: (row) => (
      <span className="font-medium text-[var(--text-primary)]">
        {row.playerName}
      </span>
    )
  },
  {
    key: 'tokens',
    header: 'Tokens',
    align: 'center',
    sortable: false,
    render: (row) => (
      <>
        {row.attacks.total}
        <span className="text-[var(--text-tertiary)]">
          /{TOKENS_PER_PLAYER}
        </span>
      </>
    )
  },
  {
    key: 'score',
    header: 'Score',
    align: 'right',
    headerTitle:
      "Contribution score: zone-capture bonuses excluded so numbers reflect fight contribution. The same player's official score can be much higher.",
    sortable: false,
    render: (row) => (
      <span className="font-mono text-[var(--text-primary)]">
        {fmtInt(row.attacks.points)}
      </span>
    )
  }
]

function WarBoardColumn({
  guildName,
  players,
  accent,
  isWinner,
  failureDataAvailable
}: {
  guildName: string
  players: PlayerStats[]
  accent: SideAccent
  isWinner: boolean
  failureDataAvailable: boolean
}) {
  const ranked = useMemo<WarBoardPlayerRow[]>(
    () =>
      rankPlayers(players).map((player, index) => ({
        ...player,
        rank: index + 1
      })),
    [players]
  )
  const totals = useMemo(() => computeTotals(players), [players])

  return (
    <Card className={clsx('bg-[var(--bg-primary)]', accent.border)}>
      <CardHeader className={clsx('rounded-t-xl', accent.headerBg)}>
        <div className="flex items-center justify-between gap-2">
          <span className={clsx('text-lg font-bold truncate', accent.text)}>
            {guildName}
          </span>
          {isWinner && <Crown className="h-5 w-5 shrink-0 text-yellow-400" />}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {ranked.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--text-tertiary)]">
            No player data available for this guild yet.
          </div>
        ) : (
          <DataTable
            rows={ranked}
            columns={boardColumns}
            rowKey={(row) => row.playerId}
          />
        )}

        <div className={clsx('divide-y divide-[var(--border)]', accent.bar)}>
          <FooterRow label="Total all players">
            {totals.totalTokens} tokens · {fmtInt(totals.totalScore)}
          </FooterRow>
          <FooterRow label="Average / player">
            {avgFormatter.format(totals.avgTokens)} ·{' '}
            {avgFormatter.format(totals.avgScore)}
          </FooterRow>
          {/* Older wars cannot infer failures: show "—", not 0. */}
          <FooterRow label="Failed tokens">
            {failureDataAvailable ? totals.totalFailed : '—'}
          </FooterRow>
          <FooterRow label="Guild max tokens">{GUILD_MAX_TOKENS}</FooterRow>
          <FooterRow label="Percent of used tokens">
            {totals.pctUsed}%
          </FooterRow>
        </div>
      </CardContent>
    </Card>
  )
}

function bannerForOutcome(
  war: WarInfo,
  outcome: WarOutcome
): { text: string; tone: string } {
  switch (outcome) {
    case 'guild':
      return {
        text: `${war.guild.guildName} wins the war!`,
        tone: 'text-yellow-400'
      }
    case 'opponent':
      return {
        text: `${war.opponent.guildName} wins the war!`,
        tone: 'text-yellow-400'
      }
    case 'draw':
      return { text: 'War drawn', tone: 'text-[var(--text-primary)]' }
    case 'pending':
    default:
      if (war.status === 'in_progress') {
        if (war.guild.score === war.opponent.score) {
          return {
            text: 'War in progress — level',
            tone: 'text-[var(--accent)]'
          }
        }
        const leader =
          war.guild.score > war.opponent.score
            ? war.guild.guildName
            : war.opponent.guildName
        return {
          text: `War in progress — ${leader} leading`,
          tone: 'text-[var(--accent)]'
        }
      }
      return {
        text: `${war.guild.guildName} vs ${war.opponent.guildName}`,
        tone: 'text-[var(--text-primary)]'
      }
  }
}

function BoardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  )
}

export default function BoardClient({ warId }: { warId: string }) {
  const {
    data: war,
    isLoading: warLoading,
    error: warError
  } = useWarInfo(warId)
  const {
    data: board,
    isLoading: boardLoading,
    error: boardError
  } = useWarBoard(warId)

  if (warError || boardError) {
    return (
      <div className="py-8 text-center text-red-400">
        Failed to load war board. Please try refreshing the page.
      </div>
    )
  }

  if (warLoading || boardLoading || !war || !board) {
    return <BoardSkeleton />
  }

  const guildPlayers = board.guild
  const opponentPlayers = board.opponent

  const outcome = resolveOutcome(war)
  const banner = bannerForOutcome(war, outcome)

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          Devastator&apos;s War Board
        </span>
        <p className={clsx('text-lg font-bold', banner.tone)}>{banner.text}</p>
        <p
          className="text-xs text-[var(--text-tertiary)]"
          title="Contribution scoring reflects fight contribution only: zone-capture bonuses are excluded. The same player's official score on the guild and opponent stats pages can be much higher."
        >
          Contribution scores (zone-capture bonuses excluded)
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WarBoardColumn
          guildName={war.guild.guildName}
          players={guildPlayers}
          accent={ACCENTS.guild}
          isWinner={outcome === 'guild'}
          failureDataAvailable={board.failureDataAvailable === true}
        />
        <WarBoardColumn
          guildName={war.opponent.guildName}
          players={opponentPlayers}
          accent={ACCENTS.opponent}
          isWinner={outcome === 'opponent'}
          failureDataAvailable={board.failureDataAvailable === true}
        />
      </div>
    </div>
  )
}
