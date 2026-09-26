'use client'

/**
 * Below `lg`, renders each matrix-table row as a card of wrapping tiles so phones never
 * scroll sideways. Pair with `hidden lg:block` on the table wrapper.
 */
import type { CSSProperties, ReactNode } from 'react'

export interface MatrixMobileCell {
  /** Same background style as the desktop `<td>`. */
  style?: CSSProperties
  className?: string
  content: ReactNode
}

export interface MatrixMobileSort {
  /** Null = default order. */
  value: string | null
  dir: 'asc' | 'desc'
  options: { value: string; label: string }[]
  onChange: (col: string | null) => void
  onToggleDir: () => void
}

interface MatrixMobileCardsProps<Row, Col> {
  rows: Row[]
  columns: Col[]
  rowKey: (row: Row) => string
  colKey: (col: Col) => string
  renderRowHeader: (row: Row) => ReactNode
  renderColLabel: (col: Col) => ReactNode
  renderCell: (row: Row, col: Col) => MatrixMobileCell
  rowClassName?: (row: Row) => string
  /** Mobile substitute for sortable column headers. */
  sort?: MatrixMobileSort
  /** Minimum tile width in px (default 96). */
  tileMinWidth?: number
}

export function MatrixMobileCards<Row, Col>({
  rows,
  columns,
  rowKey,
  colKey,
  renderRowHeader,
  renderColLabel,
  renderCell,
  rowClassName,
  sort,
  tileMinWidth = 96
}: MatrixMobileCardsProps<Row, Col>) {
  return (
    <div className="lg:hidden space-y-2.5">
      {sort && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <label htmlFor="matrix-mobile-sort">Sort</label>
          <select
            id="matrix-mobile-sort"
            value={sort.value ?? ''}
            onChange={(e) => sort.onChange(e.target.value || null)}
            className="min-w-0 flex-1 max-w-[220px] rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1.5 text-xs text-[var(--text-primary)]"
          >
            <option value="">Default</option>
            {sort.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={sort.onToggleDir}
            disabled={sort.value === null}
            className="rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2.5 py-1.5 disabled:opacity-40"
            title={sort.dir === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sort.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      )}
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          className={`overflow-hidden rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] ${
            rowClassName?.(row) ?? ''
          }`}
        >
          <div className="border-b border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)]">
            {renderRowHeader(row)}
          </div>
          <div
            className="grid gap-px bg-[var(--card-border)]"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${tileMinWidth}px, 1fr))`
            }}
          >
            {columns.map((col) => {
              const cell = renderCell(row, col)
              return (
                // Solid base so heatmap rgba composites over the card, not the divider colour.
                <div key={colKey(col)} className="bg-[var(--card-bg)]">
                  <div
                    className={`flex h-full min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 py-1 text-center ${
                      cell.className ?? ''
                    }`}
                    style={cell.style}
                  >
                    <div className="max-w-full truncate text-[9px] font-medium leading-tight text-[var(--text-secondary)]">
                      {renderColLabel(col)}
                    </div>
                    <div className="text-xs text-[var(--text-primary)]">
                      {cell.content}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
