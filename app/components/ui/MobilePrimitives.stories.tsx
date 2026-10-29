import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { ToastProvider } from '@/app/hooks/useToast'
import { SyncStatusPanel } from './SyncStatusPanel'
import {
  CORNER_STACK_PILL_SLOT_CLASS,
  CORNER_STACK_MOBILE_CLEARANCE_CLASS,
  CORNER_STACK_INLINE_CLEARANCE_CLASS,
  CORNER_STACK_ROOMY_INLINE_CLEARANCE_CLASS,
  CORNER_STACK_RIGHT_GUTTER_CLASS
} from './corner-stack'
import PerformanceTable from '@/app/(dashboard)/wars/_components/PerformanceTable'
import { MobileTabBar } from '../navigation/MobileTabBar'
import { workspaces } from '../navigation/workspaces'
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
    id: 'example-alpha',
    title: 'Example Vanguard Alpha with a complete, deliberately long title',
    state: 'Ready',
    detail: 'Assigned to the northern objective',
    meta: ['12 attacks', '3 holds'],
    href: '#example-record'
  },
  {
    id: 'example-beta',
    title: 'Example Vanguard Beta',
    state: 'Not observed',
    detail: 'No data for the selected period.',
    meta: ['4 historical attacks']
  }
]

export const CardList: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[390px] p-4">
      <MobileCardList items={items} />
      <section
        id="example-record"
        className="mt-8"
        aria-label="Example record detail"
      >
        <h2 className="text-base font-semibold">Example record detail</h2>
        <p className="text-sm">
          Synthetic details for the linked example record.
        </p>
      </section>
    </div>
  )
}

function InteractiveFilters() {
  const [query, setQuery] = useState('')
  const [readyOnly, setReadyOnly] = useState(false)
  const [assignedOnly, setAssignedOnly] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const filtered = items.filter(
    (item, index) =>
      String(item.title).toLowerCase().includes(query.toLowerCase()) &&
      (!readyOnly || item.state === 'Ready') &&
      (!assignedOnly || index === 0)
  )
  return (
    <div className="mx-auto w-full max-w-[390px] p-4">
      <FilterBar
        search={
          <>
            <input
              ref={search}
              type="search"
              aria-label="Search example records"
              placeholder="Search example records"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-(--card-border) bg-(--card-bg) px-3"
            />
            {query && (
              <button
                type="button"
                className="min-h-11 px-2"
                onClick={() => {
                  setQuery('')
                  search.current?.focus()
                }}
              >
                Clear search
              </button>
            )}
          </>
        }
        primaryFilters={
          <button
            type="button"
            className="min-h-11 px-2"
            aria-pressed={readyOnly}
            onClick={() => setReadyOnly((value) => !value)}
          >
            Status: {readyOnly ? 'Ready' : 'All'}
          </button>
        }
        secondaryFilters={
          <button
            type="button"
            className="min-h-11 px-2"
            aria-pressed={assignedOnly}
            onClick={() => setAssignedOnly((value) => !value)}
          >
            Assigned only: {assignedOnly ? 'On' : 'Off'}
          </button>
        }
        activeSecondaryCount={Number(assignedOnly)}
        activeCount={
          Number(Boolean(query)) + Number(readyOnly) + Number(assignedOnly)
        }
        onReset={() => {
          setQuery('')
          setReadyOnly(false)
          setAssignedOnly(false)
          search.current?.focus()
        }}
        resultCount={`${filtered.length} example records`}
      />
      <div className="mt-3">
        <MobileCardList
          items={filtered}
          empty={<p role="status">No example records match these filters.</p>}
        />
      </div>
    </div>
  )
}

export const FilterBarWithCollapse: Story = {
  render: () => <InteractiveFilters />
}

function InteractivePageActions() {
  const [saved, setSaved] = useState(false)
  return (
    <div className="safe-x">
      <div className="mx-auto w-full max-w-[640px] p-4 mobile-page-bottom-reserve">
        <h1 className="text-lg font-semibold">Example plan</h1>
        {Array.from({ length: 12 }, (_, index) => (
          <p key={index} className="py-5 text-sm">
            Example record {index + 1}
          </p>
        ))}
        <p className="mb-4 text-sm" data-testid="last-example-record">
          Last record of page content.
        </p>
        <p role="status" className="min-h-6 text-sm">
          {saved ? 'Example plan saved.' : ''}
        </p>
        <MobileActionBar
          actions={
            <button
              type="button"
              className="min-h-11 rounded-md border border-(--card-border) px-3"
              disabled={saved}
              onClick={() => setSaved(true)}
            >
              Save plan
            </button>
          }
        />
        <MobileTabBar workspaces={workspaces} currentSeason="112" />
      </div>
    </div>
  )
}

export const ActionBarAboveTabBar: Story = {
  render: () => <InteractivePageActions />
}

export const EmptyRecords: Story = {
  render: () => (
    <div className="p-4">
      <MobileCardList
        items={[]}
        empty={
          <p role="status">No example records exist for this selection.</p>
        }
      />
    </div>
  )
}

export const UnavailableRecords: Story = {
  render: () => (
    <div className="p-4">
      <MobileCardList
        items={[]}
        empty={
          <p role="alert">
            The example source could not be read. Its record count is unknown.
          </p>
        }
      />
    </div>
  )
}

export const ReadingRecords: Story = {
  render: () => (
    <div className="p-4">
      <p role="status" aria-busy="true">
        Reading example records…
      </p>
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
    headerTitle: 'Includes completed objective bonuses.',
    render: (r) => r.score,
    sortValue: (r) => r.score
  },
  { key: 'zone', header: 'Zone', render: (r) => r.zone }
]

const rows: Row[] = [
  {
    name: 'Example Vanguard Alpha with a complete, deliberately long title',
    score: 1240,
    zone: 'Alpha'
  },
  { name: 'Example Vanguard Beta', score: 980, zone: 'Bravo' }
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

// Comparative reports preserve columns instead of expanding every metric into cards.
export const UnitPerformanceComparison: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[640px] p-4">
      <PerformanceTable
        rows={[
          {
            unit: {
              id: 'example-alpha',
              name: 'Example comparison Alpha with a long name',
              shortCode: 'EA',
              faction: 'Example faction'
            },
            uses: 12,
            wins: 6,
            losses: 6,
            winRate: 50,
            avgScore: 300,
            avgKills: 2.5
          },
          {
            unit: {
              id: 'example-beta',
              name: 'Example comparison Beta',
              shortCode: 'EB',
              faction: 'Example faction'
            },
            uses: 8,
            wins: 6,
            losses: 2,
            winRate: 75,
            avgScore: 200,
            avgKills: 1.5
          }
        ]}
      />
    </div>
  )
}

function ExampleCornerStack({
  roomy,
  navigation
}: {
  roomy: boolean
  navigation: boolean
}) {
  const [saved, setSaved] = useState(false)
  return (
    <ToastProvider>
      <div className="safe-x">
        <div className="p-4 mobile-page-bottom-reserve">
          <h1>Example page with auxiliary controls</h1>
          {Array.from({ length: 12 }, (_, index) => (
            <p key={index} className="py-5">
              Example record {index + 1}
            </p>
          ))}
          <div
            role="region"
            aria-label="Example page actions"
            className={`sticky ${CORNER_STACK_MOBILE_CLEARANCE_CLASS} ${roomy ? CORNER_STACK_ROOMY_INLINE_CLEARANCE_CLASS : CORNER_STACK_INLINE_CLEARANCE_CLASS} ${CORNER_STACK_RIGHT_GUTTER_CLASS}`}
          >
            <button
              type="button"
              className="min-h-11 rounded border px-3"
              onClick={() => setSaved(true)}
            >
              {saved ? 'Example saved' : 'Save example'}
            </button>
          </div>
        </div>
      </div>
      <div
        className={CORNER_STACK_PILL_SLOT_CLASS}
        data-testid="example-operational-slot"
      >
        <span className="block rounded border bg-(--dropdown-bg-solid) p-2 text-xs">
          Example source unknown
        </span>
      </div>
      <SyncStatusPanel />
      {navigation && (
        <MobileTabBar workspaces={workspaces} currentSeason="112" />
      )}
    </ToastProvider>
  )
}

export const CornerStack: StoryObj<typeof ExampleCornerStack> = {
  args: { roomy: false, navigation: true },
  render: (args) => (
    <ExampleCornerStack
      roomy={Boolean(args.roomy)}
      navigation={args.navigation !== false}
    />
  )
}

function InteractiveCardActions() {
  const [reviewed, setReviewed] = useState<string | null>(null)
  return (
    <div className="mx-auto max-w-[640px] p-4">
      <DataTable
        rows={rows}
        columns={[
          ...columns,
          {
            key: 'actions',
            header: '',
            sortable: false,
            render: (row) => (
              <button
                type="button"
                className="min-h-11 rounded border px-3"
                onClick={() => setReviewed(row.name)}
              >
                Review record
              </button>
            )
          }
        ]}
        rowKey={(row) => row.name}
        mobileCard="auto"
      />
      <p role="status">{reviewed ? `Reviewing ${reviewed}` : ''}</p>
    </div>
  )
}

export const TableWithUnlabeledActions: Story = {
  render: () => <InteractiveCardActions />
}
