'use client'

import { Fragment, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TrendBadge } from '@/app/components/ui/TrendBadge'

export type LoopTrend = 'improving' | 'declining' | 'stable'

export const LOOP_TABLE_CLASSES = {
  viewport: 'overflow-x-auto border border-[var(--card-border)] rounded-lg',
  headerRow:
    'text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]',
  row: 'border-t border-card-border/60 cursor-pointer hover:bg-card/50 transition-colors',
  disclosureCell: 'px-2 py-2 text-[var(--text-secondary)]',
  loopCell: 'px-4 py-2 font-medium text-[var(--text-primary)]',
  blueCell: 'px-4 py-2 text-right font-mono text-blue-400',
  yellowCell: 'px-4 py-2 text-right font-mono text-yellow-400',
  detailPanel:
    'bg-card/30 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-200',
  detailTable: 'w-full text-xs border-collapse',
  detailHead: 'text-[var(--text-secondary)] uppercase bg-card/50',
  detailRow:
    'border-b border-card-border/30 hover:bg-[color-mix(in_srgb,var(--card-hover)_50%,transparent)] transition-colors',
  detailBlueCell: 'px-3 py-2 text-right font-mono text-blue-400'
} as const

export interface LoopFilterOption {
  key: string
  label: ReactNode
}

export function sortLoopBossNames(names: Iterable<string>): string[] {
  const rarityOrder = (name: string) =>
    name.startsWith('M') ? 0 : name.startsWith('L') ? 1 : 2
  const setNumber = (name: string) => {
    const value = name.match(/^[ML](\d+)/)?.[1]
    return value ? Number.parseInt(value, 10) : 0
  }

  return Array.from(new Set(names)).sort((left, right) => {
    const rarityDifference = rarityOrder(left) - rarityOrder(right)
    return rarityDifference || setNumber(right) - setNumber(left)
  })
}

export function LoopFilterChips({
  options,
  selectedKey,
  onSelect
}: {
  options: LoopFilterOption[]
  selectedKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = option.key === selectedKey
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelect(option.key)}
            aria-pressed={selected}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              selected
                ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--bg-primary)]'
                : 'border-[var(--card-border)] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export interface LoopTableCell {
  content: ReactNode
  className?: string
}

export interface LoopTableDetailRow {
  key: string
  cells: LoopTableCell[]
}

export interface LoopTableRow {
  key: number
  loopLabel: ReactNode
  trend: LoopTrend
  cells: LoopTableCell[]
  detailHeaders: ReactNode[]
  detailRows: LoopTableDetailRow[]
}

export function LoopExpandableTable({
  headers,
  rows,
  expanded,
  onToggle
}: {
  headers: ReactNode[]
  rows: LoopTableRow[]
  expanded: Set<number>
  onToggle: (key: number) => void
}) {
  return (
    <div className="hidden lg:block">
      <div className={LOOP_TABLE_CLASSES.viewport}>
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--card-bg)]">
            <tr className={LOOP_TABLE_CLASSES.headerRow}>
              <th className="w-8 px-2 py-2" />
              <th className="px-4 py-2">Loop</th>
              {headers.map((header) => (
                <th key={String(header)} className="px-4 py-2 text-right">
                  {header}
                </th>
              ))}
              <th className="px-4 py-2 text-center">Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isExpanded = expanded.has(row.key)
              return (
                <Fragment key={row.key}>
                  <tr
                    className={LOOP_TABLE_CLASSES.row}
                    onClick={() => onToggle(row.key)}
                  >
                    <td className={LOOP_TABLE_CLASSES.disclosureCell}>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>
                    <td className={LOOP_TABLE_CLASSES.loopCell}>
                      {row.loopLabel}
                    </td>
                    {row.cells.map((cell, index) => (
                      <td
                        key={String(headers[index])}
                        className={`px-4 py-2 text-right ${cell.className ?? ''}`}
                      >
                        {cell.content}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-center">
                      <TrendBadge trend={row.trend} />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={headers.length + 3} className="p-0">
                        <div className={LOOP_TABLE_CLASSES.detailPanel}>
                          <table className={LOOP_TABLE_CLASSES.detailTable}>
                            <thead className={LOOP_TABLE_CLASSES.detailHead}>
                              <tr>
                                {row.detailHeaders.map((header, index) => (
                                  <th
                                    key={String(header)}
                                    className={`px-3 py-2 ${index === 0 ? 'text-left' : 'text-right'}`}
                                  >
                                    {header}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {row.detailRows.map((detail) => (
                                <tr
                                  key={detail.key}
                                  className={LOOP_TABLE_CLASSES.detailRow}
                                >
                                  {detail.cells.map((cell, index) => (
                                    <td
                                      key={String(row.detailHeaders[index])}
                                      className={`px-3 py-2 ${index === 0 ? 'font-medium' : 'text-right'} ${cell.className ?? ''}`}
                                    >
                                      {cell.content}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export interface LoopMobileCard {
  key: number
  title: ReactNode
  trend: LoopTrend
  metrics: Array<{ label: ReactNode; value: ReactNode; className?: string }>
  footer?: ReactNode
}

export function LoopMobileGrid({ cards }: { cards: LoopMobileCard[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
      {cards.map((card) => (
        <div
          key={card.key}
          className="space-y-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-3"
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {card.title}
            </div>
            <TrendBadge
              trend={card.trend}
              showLabel={false}
              className="flex items-center gap-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {card.metrics.map((metric) => (
              <div key={String(metric.label)}>
                <div className="text-xs text-[var(--text-secondary)]">
                  {metric.label}
                </div>
                <div className={metric.className}>{metric.value}</div>
              </div>
            ))}
          </div>
          {card.footer && (
            <div className="text-xs text-[var(--text-secondary)]">
              {card.footer}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
