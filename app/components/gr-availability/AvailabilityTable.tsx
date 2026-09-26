'use client'

import {
  ConnectionStatus,
  DataTable,
  StatusDot,
  type DataTableColumn
} from '@tacticus/ui-kit'
import { Check } from 'lucide-react'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { formatInterval } from '@/app/components/gr-availability/parse'
import type { PlayerAvailability } from '@/app/components/gr-availability/types'

interface AvailabilityTableProps {
  sortedPlayers: PlayerAvailability[]
  hasMounted: boolean
}

export const AvailabilityTable = ({
  sortedPlayers,
  hasMounted
}: AvailabilityTableProps) => {
  return (
    <div>
      {(() => {
        const tableData = sortedPlayers.map((player, index) => ({
          ...player,
          nextTokenDisplay:
            player.tokens_available < 3
              ? player.token_cooldown ||
                formatInterval(
                  typeof player.time_to_next_token === 'number'
                    ? player.time_to_next_token
                    : null
                )
              : '--',
          nextBombDisplay:
            player.bombs_available === 0 ? player.bomb_cooldown || '--' : '--',
          lastBattleDisplay:
            hasMounted && player.last_battle_time
              ? new Date(player.last_battle_time).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : '--',
          sortKey: index
        }))

        const columns: DataTableColumn<(typeof tableData)[number]>[] = [
          {
            key: 'display_name',
            header: 'Player',
            sortable: true,
            sortValue: (player) => player.display_name,
            className:
              'text-left py-0.5 sm:py-1 px-0.5 sm:px-2 max-w-[90px] sm:max-w-none',
            headerClassName:
              'text-left py-1 px-0.5 sm:px-2 font-medium text-[9px] sm:text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            render: (player) => (
              <div className="flex items-center gap-0.5 sm:gap-2">
                <span className="font-medium text-[var(--text-primary)] text-[11px] sm:text-sm truncate max-w-[80px] sm:max-w-none">
                  <PlayerLink playerName={player.display_name}>
                    {player.display_name}
                  </PlayerLink>
                </span>
                {/* API Key Status Badge - hidden on mobile */}
                <div className="hidden sm:block">
                  {player.data_source === 'live' ? (
                    <ConnectionStatus
                      status="connected"
                      size="sm"
                      showLabel={false}
                    />
                  ) : player.has_api_key ? (
                    <ConnectionStatus
                      status="disconnected"
                      size="sm"
                      showLabel={false}
                    />
                  ) : null}
                </div>
              </div>
            )
          },
          {
            key: 'tokens_available',
            header: 'Tkn',
            sortable: true,
            sortValue: (player) => player.tokens_available,
            className: 'text-center py-0.5 sm:py-1 px-0.5 sm:px-2',
            headerClassName:
              'text-center py-1 px-0.5 sm:px-2 font-medium text-[9px] sm:text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            render: (player) => (
              <div className="flex items-center justify-center gap-0.5">
                <span
                  className={`font-bold text-[11px] sm:text-sm ${
                    player.tokens_available >= 3
                      ? 'text-[var(--primary)]'
                      : player.tokens_available === 0
                        ? 'text-[var(--accent)]'
                        : 'text-green-400'
                  }`}
                >
                  <span className="sm:hidden">{player.tokens_available}</span>
                  <span className="hidden sm:inline">
                    {player.tokens_available}/3
                  </span>
                </span>
                {player.tokens_available >= 3 && (
                  <StatusDot
                    status="warning"
                    title="Tokens capped - wasting regeneration"
                  />
                )}
              </div>
            )
          },
          {
            key: 'nextTokenDisplay',
            header: 'Next',
            sortable: true,
            sortValue: (player) => player.nextTokenDisplay ?? '',
            className:
              'text-center py-0.5 sm:py-1 px-0.5 sm:px-2 text-[var(--text-tertiary)] text-[10px] sm:text-xs',
            headerClassName:
              'text-center py-1 px-0.5 sm:px-2 font-medium text-[9px] sm:text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            render: (player) => {
              const display = player.nextTokenDisplay || '--'
              const compactDisplay = display.replace(/\s/g, '').substring(0, 5)
              return (
                <span className="whitespace-nowrap">
                  <span className="sm:hidden">{compactDisplay}</span>
                  <span className="hidden sm:inline">{display}</span>
                </span>
              )
            }
          },
          {
            key: 'bombs_available',
            header: 'Bmb',
            sortable: true,
            sortValue: (player) => player.bombs_available,
            className: 'text-center py-0.5 sm:py-1 px-0.5 sm:px-2',
            headerClassName:
              'text-center py-1 px-0.5 sm:px-2 font-medium text-[9px] sm:text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            render: (player) =>
              player.bombs_available > 0 ? (
                <span className="text-green-400 font-medium text-[11px] sm:text-sm">
                  <Check className="h-3 w-3 sm:h-4 sm:w-4" />
                </span>
              ) : (
                <span className="text-[var(--text-tertiary)] text-[11px] sm:text-sm">
                  -
                </span>
              )
          },
          {
            key: 'nextBombDisplay',
            header: 'Next Bomb',
            sortable: true,
            sortValue: (player) => player.nextBombDisplay,
            className:
              'hidden lg:table-cell text-center py-0.5 sm:py-1 px-2 text-[var(--text-tertiary)]',
            headerClassName:
              'hidden lg:table-cell text-center py-1 px-2 font-medium text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            render: (player) => player.nextBombDisplay
          },
          {
            key: 'lastBattleDisplay',
            header: 'Last Battle',
            sortable: true,
            className:
              'hidden lg:table-cell text-center py-0.5 sm:py-1 px-2 text-[var(--text-tertiary)]',
            headerClassName:
              'hidden lg:table-cell text-center py-1 px-2 font-medium text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            sortValue: (player) => player.last_battle_time || '',
            render: (player) => player.lastBattleDisplay
          },
          {
            key: 'battles_with_damage',
            header: 'Btl',
            sortable: true,
            sortValue: (player) => player.battles_with_damage,
            className: 'text-center py-0.5 sm:py-1 px-0.5 sm:px-2',
            headerClassName:
              'text-center py-1 px-0.5 sm:px-2 font-medium text-[9px] sm:text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]',
            render: (player) => (
              <span
                className={`font-medium text-[11px] sm:text-sm ${
                  player.battles_with_damage === 0
                    ? 'text-[var(--accent)]'
                    : player.battles_with_damage < 10
                      ? 'text-[var(--primary)]'
                      : 'text-green-400'
                }`}
              >
                {player.battles_with_damage}
              </span>
            )
          }
        ]

        return (
          <div className="overflow-x-visible">
            <DataTable
              rows={tableData}
              columns={columns}
              defaultSort={{ key: 'tokens_available', direction: 'desc' }}
              rowKey={(item) => item.player_id || item.sortKey.toString()}
              density="compact"
              tableClassName="w-full text-xs"
              rowClassName={() =>
                'table-row-hover hover:bg-[color-mix(in_srgb,var(--card-hover)_30%,transparent)] transition-all duration-200 border-b border-dashed border-gray-800/50'
              }
            />
          </div>
        )
      })()}
    </div>
  )
}
