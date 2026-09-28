'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { PlayerCell } from './PlayerCell'
import type { CurrentBossAssignmentRow } from './CurrentBossAssignmentsPanel'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

interface AssignedAttackersTableProps {
  rows: CurrentBossAssignmentRow[]
  avatarMap?: Map<string, string | null>
  guildCode?: string
  emptyMessage?: string
}

// "Unplanned" is an orthogonal chip, e.g. "Completed (unplanned)".
type StatusLevel = 'defeated' | 'completed' | 'needs' | 'idle'

function deriveStatusLevel(row: CurrentBossAssignmentRow): StatusLevel {
  if (typeof row.targetRemainingHp === 'number' && row.targetRemainingHp <= 0)
    return 'defeated'
  if (row.remaining > 0) return 'needs'
  if (row.used > 0) return 'completed'
  return 'idle'
}

const STATUS_BADGE: Record<StatusLevel, { label: string; className: string }> =
  {
    defeated: {
      label: 'Defeated',
      className: 'bg-gray-500/20 text-gray-300 border-gray-500/30'
    },
    completed: {
      label: 'Completed',
      className: 'bg-green-500/20 text-green-300 border-green-500/30'
    },
    needs: {
      label: 'Needs attacks',
      className: 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    },
    idle: {
      label: 'Idle',
      className: 'bg-(--card-bg) text-secondary-wh40k border-(--card-border)'
    }
  }

export function AssignedAttackersTable({
  rows,
  avatarMap,
  guildCode,
  emptyMessage = 'No assignments yet.'
}: AssignedAttackersTableProps) {
  const resolvedAvatarMap = avatarMap ?? new Map<string, string | null>()

  // On mobile the 6 secondary columns move behind a per-row disclosure.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const toggleRow = (rowKey: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })

  return (
    <div className="overflow-x-auto">
      {/* Below `md`: four columns, sticky Player, the rest behind a toggle. */}
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-secondary-wh40k">
            <th className="sticky left-0 z-20 bg-[rgb(var(--card-bg-rgb))] py-2 pr-4 md:static md:z-auto md:bg-transparent">
              Player
            </th>
            <th className="hidden py-2 pr-4 md:table-cell">Tokens available</th>
            <th className="hidden py-2 pr-4 md:table-cell">
              Time to Next Token
            </th>
            <th className="py-2 pr-4">Target</th>
            <th
              className="hidden py-2 pr-4 md:table-cell"
              title="Per-player historical average damage per attack on this encounter"
            >
              Avg dmg
            </th>
            <th className="hidden py-2 pr-4 md:table-cell">Actual dmg</th>
            <th className="hidden py-2 pr-4 md:table-cell">EST HP Remaining</th>
            <th className="hidden py-2 pr-4 md:table-cell">Tokens remaining</th>
            <th className="py-2 pr-4">Planned</th>
            <th className="py-2 pr-4">Used</th>
            <th className="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-(--card-border)">
              <td className="py-3 text-secondary-wh40k" colSpan={11}>
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowKey = `${row.playerId}:${row.targetId}`
              const isRowExpanded = expandedRows.has(rowKey)
              const detailFields: Array<{ label: string; value: string }> = [
                {
                  label: 'Tokens available',
                  value:
                    typeof row.tokensAvailable === 'number'
                      ? formatNumber(row.tokensAvailable)
                      : '-'
                },
                {
                  label: 'Time to Next Token',
                  value: row.timeToNextToken || '-'
                },
                {
                  label: 'Avg dmg',
                  value:
                    typeof row.avgDamage === 'number'
                      ? formatNumber(row.avgDamage)
                      : '-'
                },
                { label: 'Actual dmg', value: formatNumber(row.actualDamage) },
                {
                  label: 'EST HP Remaining',
                  value:
                    typeof row.estHpRemaining === 'number'
                      ? formatNumber(row.estHpRemaining)
                      : '-'
                },
                {
                  label: 'Tokens remaining',
                  value: formatNumber(row.remaining)
                }
              ]
              return (
                <Fragment key={rowKey}>
                  <tr className="border-t border-(--card-border)">
                    <td className="sticky left-0 z-10 bg-[rgb(var(--card-bg-rgb))] py-2 pr-4 text-primary-wh40k md:static md:z-auto md:bg-transparent">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleRow(rowKey)}
                          aria-label={
                            isRowExpanded ? 'Hide details' : 'Show details'
                          }
                          aria-expanded={isRowExpanded}
                          className="-ml-1 shrink-0 text-secondary-wh40k hover:text-primary-wh40k md:hidden"
                        >
                          {isRowExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                        <PlayerCell
                          playerId={row.playerId}
                          displayName={row.displayName}
                          avatarMap={resolvedAvatarMap}
                          guildCode={guildCode}
                        />
                      </div>
                    </td>
                    <td className="hidden py-2 pr-4 text-secondary-wh40k md:table-cell">
                      {typeof row.tokensAvailable === 'number'
                        ? formatNumber(row.tokensAvailable)
                        : '-'}
                    </td>
                    <td className="hidden py-2 pr-4 text-secondary-wh40k md:table-cell">
                      {row.timeToNextToken || '-'}
                    </td>
                    <td className="py-2 pr-4 text-secondary-wh40k">
                      <div className="flex flex-col items-start gap-1">
                        {row.cascadedFromTarget ? (
                          <span
                            title={`Originally assigned to ${getBossDisplayName(row.cascadedFromTarget)}. That target is expected to be effectively defeated before this token would fire, so the cascade waterfall redirects the attack here.`}
                            className="inline-flex flex-wrap items-center gap-1"
                          >
                            <span className="line-through opacity-60">
                              {getBossDisplayName(row.cascadedFromTarget)}
                            </span>
                            <span className="text-amber-300">→</span>
                            <span className="text-primary-wh40k">
                              {getBossDisplayName(row.target)}
                            </span>
                          </span>
                        ) : (
                          getBossDisplayName(row.target)
                        )}
                      </div>
                    </td>
                    <td className="hidden py-2 pr-4 text-secondary-wh40k md:table-cell">
                      {typeof row.avgDamage === 'number'
                        ? formatNumber(row.avgDamage)
                        : '-'}
                    </td>
                    <td className="hidden py-2 pr-4 text-secondary-wh40k md:table-cell">
                      {formatNumber(row.actualDamage)}
                    </td>
                    <td className="hidden py-2 pr-4 text-secondary-wh40k md:table-cell">
                      {typeof row.estHpRemaining === 'number'
                        ? formatNumber(row.estHpRemaining)
                        : '-'}
                    </td>
                    <td className="hidden py-2 pr-4 text-secondary-wh40k md:table-cell">
                      {formatNumber(row.remaining)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-wh40k">
                      {formatNumber(row.planned)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-wh40k">
                      {formatNumber(row.used)}
                    </td>
                    <td className="py-2 pr-4">
                      {(() => {
                        const level = deriveStatusLevel(row)
                        const badge = STATUS_BADGE[level]
                        return (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            {row.unplanned && (
                              <span
                                className="inline-flex items-center rounded-sm border border-orange-500/40 bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-medium text-orange-300"
                                title="Attacker landed on this target without being assigned here by the solver."
                              >
                                unplanned
                              </span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                  {isRowExpanded && (
                    <tr className="border-t border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] bg-[rgb(var(--card-bg-rgb))] md:hidden">
                      <td colSpan={5} className="px-3 py-3">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {detailFields.map((field) => (
                            <div key={field.label} className="flex flex-col">
                              <dt className="text-[10px] uppercase tracking-wide text-secondary-wh40k">
                                {field.label}
                              </dt>
                              <dd className="text-xs text-primary-wh40k">
                                {field.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
