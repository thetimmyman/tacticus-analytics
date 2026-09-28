import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'

type Row = { id: string; name: string; selected: boolean }

const rows: Row[] = [
  { id: 'a', name: 'Alpha', selected: false },
  { id: 'b', name: 'Beta', selected: true },
  { id: 'c', name: 'Gamma', selected: false }
]

const columns: DataTableColumn<Row, 'name'>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name, sortable: false }
]

const rowByName = (name: string) =>
  screen.getByText(name).closest('tr') as HTMLTableRowElement

describe('DataTable rowClassName', () => {
  it('merges the per-row classes onto the standard row chrome', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowClassName={(row) =>
          row.selected
            ? 'bg-blue-900/30 border-l-2 border-l-blue-500'
            : undefined
        }
      />
    )

    const selected = rowByName('Beta')
    expect(selected).toHaveClass('bg-blue-900/30')
    expect(selected).toHaveClass('border-l-2')
    expect(selected).toHaveClass('border-l-blue-500')
    expect(selected).toHaveClass('border-b')
    expect(selected).toHaveClass('hover:bg-(--bg-secondary)')

    const unselected = rowByName('Alpha')
    expect(unselected).not.toHaveClass('bg-blue-900/30')
    expect(unselected).toHaveClass('border-b')
  })

  it('is called once per rendered row with that row', () => {
    const rowClassName = vi.fn(() => undefined)
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowClassName={rowClassName}
      />
    )

    expect(rowClassName).toHaveBeenCalledTimes(rows.length)
    expect(rowClassName.mock.calls.map(([row]) => row)).toEqual(rows)
  })

  it('leaves markup unchanged when rowClassName is absent', () => {
    const { container: withHook } = render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowClassName={() => undefined}
      />
    )
    const hookMarkup = withHook.innerHTML

    const { container: without } = render(
      <DataTable rows={rows} columns={columns} rowKey={(row) => row.id} />
    )

    expect(without.innerHTML).toBe(hookMarkup)
  })

  it('composes with the onRowClick affordance classes', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        onRowClick={() => {}}
        rowClassName={(row) => (row.selected ? 'bg-green-500/5' : undefined)}
      />
    )

    const selected = rowByName('Beta')
    expect(selected).toHaveClass('cursor-pointer')
    expect(selected).toHaveClass('bg-green-500/5')
  })
})
