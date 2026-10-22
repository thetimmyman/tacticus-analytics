'use client'

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import clsx from 'clsx'
import { EmptyState } from './EmptyState'

export type SortDirection = 'asc' | 'desc'

export interface DataTableColumn<Row, Key extends string = string> {
  /** Stable identifier, also used as the sort key. */
  key: Key
  header: ReactNode
  render: (row: Row) => ReactNode
  /** Defaults to true. */
  sortable?: boolean
  /** Defaults to the rendered string. */
  sortValue?: (row: Row) => number | string
  className?: string
  headerClassName?: string
  /** Native `title` for the `<th>` (kept off `header` so the sort label stays a string). */
  headerTitle?: string
  align?: 'left' | 'center' | 'right'
}

type DataTableSortState<Key extends string> = {
  key: Key
  direction: SortDirection
}

type DataTableSortChange<Key extends string> = (
  sort: DataTableSortState<Key>
) => void

interface DataTableBaseProps<Row, Key extends string> {
  rows: Row[]
  columns: DataTableColumn<Row, Key>[]
  rowKey: (row: Row) => string
  /** Pointer convenience only; keyboard users need a real button or link in a column. */
  onRowClick?: (row: Row) => void
  /**
   * Per-row classes on the row chrome. A plain `bg-*` loses to the hover rule's specificity,
   * so tints that must survive hover need `!bg-*`.
   */
  rowClassName?: (row: Row) => string | undefined
  empty?: ReactNode
  /**
   * Renders each row as a card below the `lg` breakpoint, where the table is hidden.
   * Use it when the row's decision does not need every column; wide numeric matrices
   * that need the comparison stay a table in a labelled scroll container.
   *
   * `'auto'` builds the card from the column metadata: the first column becomes the
   * title and the rest become label/value pairs. Pass a function when a row needs a
   * different shape than that.
   */
  mobileCard?: 'auto' | ((row: Row) => ReactNode)
  className?: string
  tableClassName?: string
  density?: 'default' | 'compact'
}

interface DataTableUncontrolledSortProps<Key extends string> {
  defaultSort?: DataTableSortState<Key>
  sort?: never
  /** Observer only; the table still owns and applies the resolved sort. */
  onSortChange?: DataTableSortChange<Key>
  externallySorted?: never
}

interface DataTableControlledSortProps<Key extends string> {
  defaultSort?: never
  /** Controlled mode requires a change handler so sortable headers are never no-ops. */
  sort: DataTableSortState<Key>
  onSortChange: DataTableSortChange<Key>
  /** `rows` already arrive in the caller's order; render them without re-sorting. */
  externallySorted?: boolean
}

export type DataTableProps<
  Row,
  Key extends string = string
> = DataTableBaseProps<Row, Key> &
  (DataTableUncontrolledSortProps<Key> | DataTableControlledSortProps<Key>)

const alignClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right'
} as const

const justifyClass = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end'
} as const

export function DataTable<Row, Key extends string = string>({
  rows,
  columns,
  defaultSort,
  sort,
  onSortChange,
  externallySorted,
  rowKey,
  onRowClick,
  rowClassName,
  empty,
  mobileCard,
  className,
  tableClassName,
  density = 'default'
}: DataTableProps<Row, Key>) {
  const [internalSortKey, setInternalSortKey] = useState<Key | undefined>(
    defaultSort?.key
  )
  const [internalDirection, setInternalDirection] = useState<SortDirection>(
    defaultSort?.direction ?? 'desc'
  )

  const mobileSortId = useId()

  const isControlled = sort !== undefined
  const requestedSortKey = isControlled ? sort.key : internalSortKey
  const requestedDirection = isControlled ? sort.direction : internalDirection
  // A removed active sort column (e.g. a preset switch) recovers to defaultSort, not unsorted.
  const hasColumn = (key: Key | undefined) =>
    key !== undefined && columns.some((c) => c.key === key)
  const sortKey = hasColumn(requestedSortKey)
    ? requestedSortKey
    : !isControlled && hasColumn(defaultSort?.key)
      ? defaultSort?.key
      : undefined
  const direction =
    sortKey === requestedSortKey
      ? requestedDirection
      : (defaultSort?.direction ?? 'desc')

  // Persist the fallback, or switching the old column back resurrects stale sort
  // state and the first click on the fallback becomes a no-op.
  useEffect(() => {
    if (isControlled || sortKey === requestedSortKey) return
    setInternalSortKey(sortKey)
    setInternalDirection(direction)
  }, [direction, isControlled, requestedSortKey, sortKey])

  const sortConfigError =
    isControlled && !onSortChange
      ? 'DataTable: `sort` requires `onSortChange`; controlled headers must not be no-op controls.'
      : isControlled && defaultSort
        ? 'DataTable: `sort` and `defaultSort` are mutually exclusive.'
        : !isControlled && externallySorted !== undefined
          ? 'DataTable: `externallySorted` requires controlled `sort` and `onSortChange` props.'
          : null
  // Re-sorting an upstream-paginated slice would silently reorder it.
  const skipInternalSort = Boolean(isControlled && externallySorted)

  const sorted = useMemo(() => {
    if (skipInternalSort) return rows
    if (!sortKey) return rows
    const column = columns.find((c) => c.key === sortKey)
    if (!column) return rows
    const accessor =
      column.sortValue ?? ((row: Row) => String(column.render(row) ?? ''))
    return [...rows].sort((a, b) => {
      const aVal = accessor(a)
      const bVal = accessor(b)
      // localeCompare: raw code-unit comparison misorders mixed-case/accented names.
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const comparison = aVal.localeCompare(bVal)
        return direction === 'asc' ? comparison : -comparison
      }
      if (aVal < bVal) return direction === 'asc' ? -1 : 1
      if (aVal > bVal) return direction === 'asc' ? 1 : -1
      return 0
    })
  }, [rows, columns, sortKey, direction, skipInternalSort])

  if (sortConfigError) {
    throw new Error(sortConfigError)
  }

  const onSort = (key: Key, sortable: boolean | undefined) => {
    if (sortable === false) return
    const nextDirection: SortDirection =
      sortKey === key ? (direction === 'asc' ? 'desc' : 'asc') : 'desc'
    if (!isControlled) {
      setInternalSortKey(key)
      setInternalDirection(nextDirection)
    }
    onSortChange?.({ key, direction: nextDirection })
  }

  const getSortLabel = (
    header: ReactNode,
    isActive: boolean,
    isSortable: boolean
  ) => {
    const headerText = typeof header === 'string' ? header : 'column'
    if (!isSortable) return undefined
    if (!isActive) return `Sort by ${headerText}`
    return direction === 'asc'
      ? `Sort ${headerText} descending`
      : `Sort ${headerText} ascending`
  }

  // Builds a card from column metadata: first column is the title, the rest are
  // label/value pairs. Callers that need a different row shape pass a function.
  const autoCard = (row: Row) => {
    const [title, ...rest] = columns
    // A column with no label cannot name a value; bar/spacer columns belong to
    // the table view only.
    const fields = rest.filter((col) => col.header !== '')
    return (
      <>
        <div className="text-sm font-semibold break-words">
          {title.render(row)}
        </div>
        {fields.length > 0 && (
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            {fields.map((col) => (
              <Fragment key={col.key}>
                <dt className="text-(--text-tertiary)">
                  {col.headerTitle ?? col.header}
                </dt>
                <dd
                  className={clsx(
                    'min-w-0 break-words',
                    col.align === 'right' && 'text-right'
                  )}
                >
                  {col.render(row)}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </>
    )
  }

  let mobileList: ReactNode = null
  if (mobileCard) {
    const renderCard = typeof mobileCard === 'function' ? mobileCard : autoCard
    mobileList =
      sorted.length === 0 ? (
        (empty ?? <EmptyState size="md" title="No data available." />)
      ) : (
        <ul className="space-y-2">
          {sorted.map((row) => (
            <li
              key={rowKey(row)}
              className="rounded-lg border border-(--card-border) bg-(--card-bg) p-3"
            >
              {renderCard(row)}
            </li>
          ))}
        </ul>
      )
  }

  const sortableColumns = columns.filter((col) => col.sortable !== false)
  // A wide table that stays a table on a phone scrolls sideways, so the first
  // column stays pinned to keep each row identifiable while it scrolls.
  const stickyFirstColumn = !mobileCard && columns.length >= 5

  return (
    <div className={clsx('overflow-x-auto', className)}>
      {mobileCard && sortableColumns.length > 0 && (
        <div
          className="mb-2 flex items-center gap-2 lg:hidden"
          data-testid="datatable-mobile-sort"
        >
          <label
            className="shrink-0 text-xs text-(--text-tertiary)"
            htmlFor={mobileSortId}
          >
            Sort by
          </label>
          <select
            id={mobileSortId}
            className="min-w-0 flex-1 rounded-md border border-(--card-border) bg-(--card-bg) px-2 py-1.5 text-xs"
            value={sortKey === undefined ? '' : String(sortKey)}
            onChange={(event) => {
              const column = sortableColumns.find(
                (col) => String(col.key) === event.target.value
              )
              if (column) onSort(column.key, column.sortable)
            }}
          >
            <option value="">Default order</option>
            {sortableColumns.map((col) => (
              <option key={col.key} value={String(col.key)}>
                {typeof col.header === 'string' ? col.header : 'Column'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="shrink-0 rounded-md border border-(--card-border) bg-(--card-bg) px-2 py-1.5 text-xs disabled:opacity-50"
            onClick={() => sortKey !== undefined && onSort(sortKey, true)}
            disabled={sortKey === undefined}
            aria-label={`Sort ${direction === 'asc' ? 'descending' : 'ascending'}`}
          >
            {direction === 'asc' ? 'Asc' : 'Desc'}
          </button>
        </div>
      )}
      {mobileCard && (
        <div className="lg:hidden" data-testid="datatable-mobile-cards">
          {mobileList}
        </div>
      )}
      <table
        className={clsx(
          'w-full text-sm',
          mobileCard && 'hidden lg:table',
          tableClassName
        )}
      >
        {!mobileCard && stickyFirstColumn && (
          <caption
            className="pb-1 text-left text-xs text-(--text-tertiary) lg:hidden"
            data-testid="datatable-scroll-hint"
          >
            Scroll sideways to see all {columns.length} columns.
          </caption>
        )}
        <thead className="border-b border-(--card-border) bg-(--bg-secondary)">
          <tr>
            {columns.map((col, colIndex) => {
              const isActive = sortKey === col.key
              const isSortable = col.sortable !== false
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={clsx(
                    'p-0 text-xs font-semibold text-secondary-wh40k select-none',
                    alignClass[col.align ?? 'left'],
                    stickyFirstColumn &&
                      colIndex === 0 &&
                      'sticky left-0 z-10 bg-(--bg-secondary)',
                    col.headerClassName,
                    col.className
                  )}
                  title={col.headerTitle}
                  aria-sort={
                    // WAI-ARIA permits aria-sort only on the currently sorted header.
                    !isSortable || !isActive
                      ? undefined
                      : direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                  }
                >
                  {isSortable ? (
                    <button
                      type="button"
                      className={clsx(
                        density === 'compact'
                          ? 'inline-flex min-h-0 w-full items-center gap-0.5 px-0.5 py-1 text-[9px] font-medium uppercase tracking-wider text-(--text-tertiary) transition-colors duration-fast hover:text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-(--accent) sm:gap-1 sm:px-2 sm:text-[10px]'
                          : 'inline-flex min-h-[44px] w-full items-center gap-1 p-3 text-xs font-semibold text-secondary-wh40k transition-colors duration-fast hover:text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-(--accent)',
                        justifyClass[col.align ?? 'left']
                      )}
                      onClick={() => onSort(col.key, col.sortable)}
                      aria-label={getSortLabel(
                        col.header,
                        isActive,
                        isSortable
                      )}
                    >
                      {col.header}
                      {isActive ? (
                        direction === 'asc' ? (
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown
                          className="h-3 w-3 opacity-40"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ) : (
                    <span
                      className={clsx(
                        density === 'compact'
                          ? 'inline-flex min-h-0 w-full items-center gap-0.5 px-0.5 py-1 text-[9px] font-medium uppercase tracking-wider sm:gap-1 sm:px-2 sm:text-[10px]'
                          : 'inline-flex min-h-[44px] w-full items-center gap-1 p-3',
                        justifyClass[col.align ?? 'left']
                      )}
                    >
                      {col.header}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty ?? <EmptyState size="md" title="No data available." />}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className={clsx(
                  'border-b border-(--card-border) hover:bg-(--bg-secondary) transition-colors duration-fast',
                  onRowClick && 'cursor-pointer',
                  rowClassName?.(row)
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col, colIndex) => (
                  <td
                    key={col.key}
                    className={clsx(
                      'p-3 text-secondary-wh40k',
                      alignClass[col.align ?? 'left'],
                      stickyFirstColumn &&
                        colIndex === 0 &&
                        'sticky left-0 bg-(--card-bg)',
                      col.className
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
