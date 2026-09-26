import type { DataTableColumn, DataTableProps } from '@tacticus/ui-kit'

type Row = { id: string; score: number }
type SortKey = 'score'

const rows: Row[] = [{ id: 'a', score: 1 }]
const columns: DataTableColumn<Row, SortKey>[] = [
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

const uncontrolled: DataTableProps<Row, SortKey> = {
  ...baseProps,
  defaultSort: { key: 'score', direction: 'desc' }
}
const controlled: DataTableProps<Row, SortKey> = {
  ...baseProps,
  sort: { key: 'score', direction: 'asc' },
  onSortChange: () => {},
  externallySorted: true
}

// @ts-expect-error -- controlled sort requires a change handler
const controlledWithoutHandler: DataTableProps<Row, SortKey> = {
  ...baseProps,
  sort: { key: 'score', direction: 'asc' }
}
// @ts-expect-error -- externallySorted is controlled-mode-only
const externalWithoutControlledSort: DataTableProps<Row, SortKey> = {
  ...baseProps,
  externallySorted: true
}
// @ts-expect-error -- controlled and default sort states are mutually exclusive
const controlledWithDefault: DataTableProps<Row, SortKey> = {
  ...baseProps,
  defaultSort: { key: 'score', direction: 'asc' },
  sort: { key: 'score', direction: 'desc' },
  onSortChange: () => {}
}

void [
  uncontrolled,
  controlled,
  controlledWithoutHandler,
  externalWithoutControlledSort,
  controlledWithDefault
]
