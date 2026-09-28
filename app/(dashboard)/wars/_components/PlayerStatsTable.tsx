'use client'

import { useMemo } from 'react'
import { Shield, Star } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import type { PlayerStats } from '../_types'
import { formatNumber, formatPercent } from './war-shared'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

type SortKey =
  | 'player'
  | 'zone'
  | 'attacks'
  | 'points'
  | 'perfect'
  | 'defended'
  | 'held'
  | 'failed'
  | 'conceded'

type PlayerBadges = {
  isTop: boolean
  isPerfect: boolean
  isNeverBreached: boolean
}

/** Badges depend on the whole roster, so derive once per render. */
type PlayerStatsRow = PlayerStats & { badges: PlayerBadges }

const columns: DataTableColumn<PlayerStatsRow, SortKey>[] = [
  {
    key: 'player',
    header: 'Player',
    sortValue: (row) => row.playerName,
    render: (row) => (
      <div className="flex items-center gap-2 font-medium text-primary-wh40k">
        <span>{row.playerName}</span>
        {row.badges.isTop && <Star className="h-3 w-3 text-yellow-400" />}
        {row.badges.isNeverBreached && (
          <Shield className="h-3 w-3 text-cyan-400" />
        )}
        {row.badges.isPerfect && (
          <span className="text-xs text-green-400">perfect</span>
        )}
      </div>
    )
  },
  {
    key: 'zone',
    header: 'Zone',
    headerTitle:
      'Zone the player defends — from their defense battles, or the planned assignment when they have not been attacked yet.',
    sortValue: (row) =>
      row.assignedZoneType ? zoneDisplayName(row.assignedZoneType) : '',
    render: (row) => (
      <span className="text-secondary-wh40k">
        {row.assignedZoneType ? zoneDisplayName(row.assignedZoneType) : '-'}
      </span>
    )
  },
  {
    key: 'attacks',
    header: 'Attacks',
    sortValue: (row) => row.attacks.total,
    render: (row) => (
      <span className="text-secondary-wh40k">
        {formatNumber(row.attacks.total)} ({formatPercent(row.attacks.winRate)})
      </span>
    )
  },
  {
    key: 'points',
    header: 'Official Points',
    align: 'right',
    headerTitle:
      'Official war score including zone-capture bonuses. The capture bonus (up to ~40K per zone) goes to the player who lands the capture.',
    sortValue: (row) => row.attacks.points,
    render: (row) => (
      <span className="font-mono text-primary-wh40k">
        {formatNumber(row.attacks.points)}
      </span>
    )
  },
  {
    key: 'perfect',
    header: 'Perfect',
    align: 'center',
    sortValue: (row) => row.attacks.perfect,
    render: (row) => (
      <span className="text-secondary-wh40k">
        {formatNumber(row.attacks.perfect)}
      </span>
    )
  },
  {
    key: 'defended',
    header: 'Defended',
    align: 'center',
    sortValue: (row) => row.defenses.total,
    render: (row) => (
      <span className="text-secondary-wh40k">
        {formatNumber(row.defenses.total)}
      </span>
    )
  },
  {
    key: 'held',
    header: 'Held',
    align: 'center',
    sortValue: (row) => row.defenses.holds,
    render: (row) => (
      <span className="text-secondary-wh40k">
        {formatNumber(row.defenses.holds)}
      </span>
    )
  },
  {
    key: 'failed',
    header: 'Failed',
    align: 'center',
    sortValue: (row) => row.attacks.failed ?? row.attacks.losses,
    render: (row) => (
      <span className="text-secondary-wh40k">
        {formatNumber(row.attacks.failed ?? row.attacks.losses)}
      </span>
    )
  },
  {
    key: 'conceded',
    header: 'Conceded',
    align: 'right',
    sortValue: (row) => row.defenses.conceded,
    render: (row) => (
      <span className="font-mono text-secondary-wh40k">
        {formatNumber(row.defenses.conceded)}
      </span>
    )
  }
]

export default function PlayerStatsTable({
  players
}: {
  players: PlayerStats[]
}) {
  const topPoints = Math.max(...players.map((p) => p.attacks.points))

  const rows: PlayerStatsRow[] = useMemo(
    () =>
      players
        .map((player) => ({
          ...player,
          badges: {
            isTop: player.attacks.points === topPoints,
            isPerfect:
              player.attacks.total > 0 &&
              player.attacks.perfect > 0 &&
              player.attacks.perfect === player.attacks.total,
            isNeverBreached:
              player.defenses.total > 0 &&
              player.defenses.holds === player.defenses.total
          }
        }))
        // Name-asc base order plus a stable sort gives a name tiebreak for constant defense columns.
        .sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players, topPoints]
  )

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.playerId}
      defaultSort={{ key: 'points', direction: 'desc' }}
      empty={<></>}
    />
  )
}
