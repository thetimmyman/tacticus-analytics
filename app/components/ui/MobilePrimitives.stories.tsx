import type { Meta, StoryObj } from '@storybook/react-vite'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { FilterBar } from './FilterBar'
import { MobileActionBar } from './MobileActionBar'
import { MobileCardList, type MobileCardListItem } from './MobileCardList'

/**
 * Visual qualification fixtures for the shared phone primitives. Rendered at
 * phone width in both supported themes; the layout choice these exercise is
 * made per report on row shape, not blanket-wide.
 */

const meta: Meta = {
  title: 'UI/Mobile/Primitives',
  parameters: { layout: 'fullscreen' }
}

export default meta

type Story = StoryObj

const items: MobileCardListItem[] = [
  {
    id: '1',
    title: 'Severus',
    state: 'Ready',
    detail: 'Assigned to the northern objective',
    meta: ['12 attacks', '3 holds'],
    href: '#'
  },
  {
    id: '2',
    title: 'Gulliman P.',
    state: 'Not observed',
    detail: 'No data for the selected period.',
    meta: ['4 attacks'],
    action: <button type="button">Reassign</button>
  }
]

export const CardList: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] p-4">
      <MobileCardList items={items} />
    </div>
  )
}

export const FilterBarWithCollapse: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] p-4">
      <FilterBar
        search={
          <input
            type="search"
            placeholder="Search"
            className="min-h-[44px] w-full rounded-lg border border-(--card-border) bg-(--card-bg) px-3"
          />
        }
        primaryFilters={<button type="button">Role: All</button>}
        secondaryFilters={<button type="button">Activity window</button>}
        activeSecondaryCount={1}
        onReset={() => {}}
        resultCount="24 results for this guild"
      />
    </div>
  )
}

export const ActionBarAboveTabBar: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] p-4 pb-24">
      <p className="mb-24 text-sm">Last row of page content.</p>
      <MobileActionBar actions={<button type="button">Save plan</button>} />
    </div>
  )
}

type Row = { name: string; score: number; zone: string }

const columns: DataTableColumn<Row>[] = [
  {
    key: 'name',
    header: 'Player',
    render: (r) => r.name,
    sortValue: (r) => r.name
  },
  {
    key: 'score',
    header: 'Score',
    render: (r) => r.score,
    sortValue: (r) => r.score
  },
  { key: 'zone', header: 'Zone', render: (r) => r.zone }
]

const rows: Row[] = [
  { name: 'Severus', score: 1240, zone: 'Alpha' },
  { name: 'Gulliman P.', score: 980, zone: 'Bravo' }
]

export const TableAsCards: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] p-4">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.name}
        mobileCard="auto"
      />
    </div>
  )
}

// A wide numeric matrix stays a table: the comparison across columns is the point.
const wideColumns: DataTableColumn<Row>[] = [
  ...columns,
  { key: 'd', header: 'Defended', render: (r) => r.score % 7 },
  { key: 'h', header: 'Held', render: (r) => r.score % 5 },
  { key: 'f', header: 'Failed', render: (r) => r.score % 3 }
]

export const WideTableStaysTable: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] p-4">
      <DataTable rows={rows} columns={wideColumns} rowKey={(r) => r.name} />
    </div>
  )
}
