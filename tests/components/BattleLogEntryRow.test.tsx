import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { BattleLogEntryRow } from '@/app/components/ui/BattleLogTable'
import type { BattleLogEntry } from '@/app/lib/utils/battle-log-helpers'

vi.mock('@tacticus/ui-kit', () => ({
  EmptyState: ({
    title,
    description
  }: {
    title: string
    description: string
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  ),
  TableSkeleton: () => <div data-testid="table-skeleton">Loading...</div>
}))

vi.mock('@/app/components/MultipleCategoryBadges', () => ({
  default: ({ categories }: { categories: string[] }) => (
    <div data-testid="category-badges">{categories.join(', ')}</div>
  )
}))

const baseEntry: BattleLogEntry = {
  id: 'entry-1',
  displayName: 'Ferrus',
  Name: 'Szarekh',
  damageDealt: 5000000,
  damageType: 'Battle',
  tier: 1,
  set: 0,
  rarity: 'Legendary',
  loopIndex: 0,
  completedOn: '2026-01-01T12:00:00Z',
  remainingHp: 250000,
  maxHp: 50000000,
  encounterId: 0
}

function renderRow(
  overrides: Partial<BattleLogEntry> = {},
  clusterCode: string | null = 'TESTCLUSTER'
) {
  const { container } = render(
    <BattleLogEntryRow
      entry={{ ...baseEntry, ...overrides }}
      heroMappings={new Map()}
      guildPerformancePctMap={new Map()}
      clusterPerformancePctMap={new Map()}
      clusterCode={clusterCode}
      hasMounted
      desktopGridClassName="grid-cols-[32px,120px,180px,120px,1fr,90px,40px,40px,80px,auto]"
      desktopPrimary={<div>desktop-primary</div>}
      desktopSecondary={<div>desktop-secondary</div>}
      mobileIdentity={<div>mobile-identity</div>}
    />
  )
  return container.firstElementChild as HTMLElement
}

describe('BattleLogEntryRow', () => {
  it('applies the red killing-blow border treatment', () => {
    const row = renderRow({ remainingHp: 0 })

    expect(row).toHaveClass('border-red-600')
    expect(row).toHaveClass('bg-red-900/30')
    expect(row).toHaveClass('hover:border-red-500')
  })

  it('applies the neutral treatment when the boss survived', () => {
    const row = renderRow()

    expect(row).toHaveClass('border-[var(--card-border)]')
    expect(row).toHaveClass('bg-slate-800/50')
    expect(row).toHaveClass('hover:border-accent-wh40k')
    expect(row).not.toHaveClass('border-red-600')
  })

  it('renders remaining HP in red on both breakpoints', () => {
    const row = renderRow()

    const hpValues = Array.from(row.querySelectorAll('.text-red-400')).map(
      (node) => node.textContent
    )
    expect(hpValues).toEqual(['250k', '250k'])
  })

  it('renders bomb damage in red and battle damage in the accent colour', () => {
    const bombRow = renderRow({ damageType: 'Bomb' })
    expect(bombRow.querySelector('.text-right.font-bold')).toHaveClass(
      'text-red-400'
    )

    const battleRow = renderRow()
    expect(battleRow.querySelector('.text-right.font-bold')).toHaveClass(
      'text-[var(--accent)]'
    )
  })

  it('renders the killing-blow skull in yellow', () => {
    const row = renderRow({ remainingHp: 0 })

    const skulls = Array.from(row.querySelectorAll('.text-yellow-400')).map(
      (node) => node.textContent
    )
    expect(skulls).toEqual(['\uD83D\uDC80', '\uD83D\uDC80'])
  })

  it('falls back to a placeholder for the cluster column without a cluster code', () => {
    const row = renderRow({}, null)

    const clusterCell = row.querySelector('[title="vs Cluster (player stats)"]')
    expect(clusterCell).not.toBeNull()
    expect(clusterCell).toHaveTextContent('--')
  })

  it('renders the caller-supplied identity slots', () => {
    const row = renderRow()

    expect(row).toHaveTextContent('desktop-primary')
    expect(row).toHaveTextContent('desktop-secondary')
    expect(row).toHaveTextContent('mobile-identity')
  })
})
