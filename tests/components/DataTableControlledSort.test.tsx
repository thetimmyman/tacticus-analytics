import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useMemo, useState, type ComponentType } from 'react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'

type Row = { id: string; name: string; score: number }
type SortKey = 'name' | 'score'

const rows: Row[] = [
  { id: 'a', name: 'Alpha', score: 1 },
  { id: 'b', name: 'Beta', score: 3 },
  { id: 'c', name: 'Gamma', score: 2 }
]

const columns: DataTableColumn<Row, SortKey>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => row.name,
    sortValue: (row) => row.name
  },
  {
    key: 'score',
    header: 'Score',
    render: (row) => row.score,
    sortValue: (row) => row.score
  }
]

const baseProps = {
  rows,
  columns,
  rowKey: (row: Row) => row.id
} as const

// Runtime callers can bypass TypeScript, so exercise the fail-loud guard untyped.
const UnsafeDataTable = DataTable as unknown as ComponentType<
  Record<string, unknown>
>

const renderInvalidSortConfig = (sortProps: Record<string, unknown>) =>
  render(<UnsafeDataTable {...baseProps} {...sortProps} />)

const expectInvalidSortConfig = (
  sortProps: Record<string, unknown>,
  message: RegExp
) => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(() => renderInvalidSortConfig(sortProps)).toThrow(message)
  } finally {
    consoleError.mockRestore()
  }
}

function PaginatedControlledConsumer() {
  const [sort, setSort] = useState<{
    key: SortKey
    direction: 'asc' | 'desc'
  }>({ key: 'score', direction: 'desc' })
  const [page, setPage] = useState(2)

  const externallySortedRows = useMemo(() => {
    const next = [...rows].sort((a, b) => {
      const comparison =
        sort.key === 'score' ? a.score - b.score : a.name.localeCompare(b.name)
      return sort.direction === 'asc' ? comparison : -comparison
    })
    return next.slice((page - 1) * 2, page * 2)
  }, [page, sort])

  return (
    <>
      <span data-testid="current-page">{page}</span>
      <DataTable
        rows={externallySortedRows}
        columns={columns}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={(nextSort) => {
          setSort(nextSort)
          setPage(1)
        }}
        externallySorted
      />
    </>
  )
}

const renderedNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent)

describe('DataTable sorting', () => {
  it('keeps the uncontrolled default sorting rows internally', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
      />
    )

    expect(renderedNames()).toEqual(['Beta', 'Gamma', 'Alpha'])
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'descending')
    expect(
      screen.getByRole('columnheader', { name: /name/i })
    ).not.toHaveAttribute('aria-sort')

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort Score ascending' })
    )

    expect(renderedNames()).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('starts a newly picked column at desc when uncontrolled', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))

    expect(renderedNames()).toEqual(['Gamma', 'Beta', 'Alpha'])
  })

  it('defers to the caller in controlled mode and reports the next sort', () => {
    const onSortChange = vi.fn()
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        sort={{ key: 'score', direction: 'asc' }}
        onSortChange={onSortChange}
      />
    )

    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'ascending')
    expect(
      screen.getByRole('columnheader', { name: /name/i })
    ).not.toHaveAttribute('aria-sort')

    fireEvent.click(
      screen.getByRole('button', { name: 'Sort Score descending' })
    )
    expect(onSortChange).toHaveBeenCalledWith({
      key: 'score',
      direction: 'desc'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(onSortChange).toHaveBeenLastCalledWith({
      key: 'name',
      direction: 'desc'
    })

    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts rows internally in controlled mode unless externallySorted is set', () => {
    const { rerender } = render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        sort={{ key: 'score', direction: 'asc' }}
        onSortChange={() => {}}
      />
    )

    expect(renderedNames()).toEqual(['Alpha', 'Gamma', 'Beta'])

    rerender(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        sort={{ key: 'score', direction: 'asc' }}
        onSortChange={() => {}}
        externallySorted
      />
    )

    expect(renderedNames()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('rejects controlled mode without an onSortChange handler', () => {
    expectInvalidSortConfig(
      {
        sort: { key: 'score', direction: 'asc' },
        externallySorted: true
      },
      /`sort` requires `onSortChange`/
    )
  })

  it('rejects externallySorted outside controlled mode', () => {
    expectInvalidSortConfig(
      {
        defaultSort: { key: 'score', direction: 'desc' },
        externallySorted: true
      },
      /`externallySorted` requires controlled `sort`/
    )
  })

  it('rejects simultaneous controlled and default sort states', () => {
    expectInvalidSortConfig(
      {
        defaultSort: { key: 'name', direction: 'asc' },
        sort: { key: 'score', direction: 'desc' },
        onSortChange: () => {}
      },
      /`sort` and `defaultSort` are mutually exclusive/
    )
  })

  it('emits aria-sort only on the currently sorted header', () => {
    render(
      <DataTable
        rows={rows}
        columns={[{ ...columns[0]! }, { ...columns[1]!, sortable: false }]}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'name', direction: 'asc' }}
      />
    )

    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute(
      'aria-sort',
      'ascending'
    )
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).not.toHaveAttribute('aria-sort')
  })

  it('preserves the externally sorted page slice and resets pagination through the consumer callback', () => {
    render(<PaginatedControlledConsumer />)

    expect(screen.getByTestId('current-page')).toHaveTextContent('2')
    expect(renderedNames()).toEqual(['Alpha'])

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))

    expect(screen.getByTestId('current-page')).toHaveTextContent('1')
    expect(renderedNames()).toEqual(['Gamma', 'Beta'])
  })

  it('renders a headerTitle tooltip on the column header', () => {
    render(
      <DataTable
        rows={rows}
        columns={[
          { ...columns[0]! },
          { ...columns[1]!, headerTitle: 'Battle Weighted' }
        ]}
        rowKey={(row) => row.id}
      />
    )

    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('title', 'Battle Weighted')
  })

  it('falls back to defaultSort when the active sort column leaves the column set', () => {
    const { rerender } = render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sort by Name' }))
    expect(renderedNames()).toEqual(['Gamma', 'Beta', 'Alpha'])

    rerender(
      <DataTable
        rows={rows}
        columns={[columns[1]!]}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
      />
    )

    const scores = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent)
    expect(scores).toEqual(['3', '2', '1'])
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'descending')

    rerender(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
      />
    )
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'descending')
    expect(
      screen.getByRole('columnheader', { name: /name/i })
    ).not.toHaveAttribute('aria-sort')

    rerender(
      <DataTable
        rows={rows}
        columns={[columns[1]!]}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Sort Score ascending' })
    )
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'ascending')

    rerender(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        defaultSort={{ key: 'score', direction: 'desc' }}
      />
    )
    expect(
      screen.getByRole('columnheader', { name: /score/i })
    ).toHaveAttribute('aria-sort', 'ascending')
    expect(renderedNames()).toEqual(['Alpha', 'Gamma', 'Beta'])
  })
})
