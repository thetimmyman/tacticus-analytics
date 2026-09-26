import type { PropsWithChildren, ReactNode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type QueryResult = { data: unknown; error: Error | null }
type QueryState = {
  table: string
  columns: string
  filters: Map<string, unknown>
  greaterThanFilters: Map<string, number>
}

const mocks = vi.hoisted(() => {
  const from = vi.fn()
  const measureAsync = vi.fn(
    async (_label: string, callback: () => Promise<unknown>) => callback()
  )
  return {
    client: { from },
    context: { clusterCode: 'TEST', guildCode: null },
    from,
    measureAsync
  }
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => mocks.client
}))

vi.mock('@/app/lib/hooks/useDataContext', () => ({
  useDataContext: () => ({ context: mocks.context, loading: false })
}))

vi.mock('@/app/hooks/usePerformance', () => ({
  usePerformance: vi.fn(),
  useMemoryMonitor: vi.fn(),
  useAsyncPerformance: () => ({ measureAsync: mocks.measureAsync })
}))

vi.mock('@/app/lib/catalogs', () => ({
  loadHeroCatalog: () => Promise.resolve([])
}))

vi.mock('@/app/lib/utils/battle-log-helpers', () => ({
  parseHeroDetails: () => [],
  parseMachineOfWarDetails: () => null,
  detectCategories: () => [],
  normalizeMetaTeams: () => [{ teamName: 'Test team' }],
  buildHeroMappingMap: () => new Map()
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}))

vi.mock('@/app/lib/utils/bossNames', () => ({
  getBossDisplayName: (name: string) => name
}))

vi.mock('@tacticus/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tacticus/ui-kit')>()),
  ClientDate: ({ date }: { date: string }) => <span>{date}</span>
}))

vi.mock('@tacticus/ui-kit/radix-tabs', () => ({
  RadixTabs: ({
    children,
    onValueChange
  }: PropsWithChildren<{ onValueChange: (value: string) => void }>) => (
    <div
      onClick={(event) => {
        const button = (event.target as Element).closest<HTMLElement>(
          'button[data-value]'
        )
        if (button?.dataset.value) onValueChange(button.dataset.value)
      }}
    >
      {children}
    </div>
  ),
  RadixTabsList: ({ children }: PropsWithChildren) => <div>{children}</div>,
  RadixTabsTrigger: ({
    children,
    value
  }: PropsWithChildren<{ value: string }>) => (
    <button data-value={value}>{children}</button>
  )
}))

vi.mock('@/app/components/filters/RarityFilterControls', () => ({
  RarityFilterControls: () => null
}))

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/app/components/ui/BossLevelWrapper', () => ({
  BossLevelBadge: ({ level }: { level: string }) => <span>{level}</span>
}))

vi.mock('@/app/components/MultipleCategoryBadges', () => ({
  default: () => null
}))

import BossLeaderboards from '@/app/(dashboard)/leaderboards/components/BossLeaderboards'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const ELIGIBLE_NEW_BOSS = {
  Name: 'NewBoss',
  tier: 7,
  set: 0,
  rarity: 'Mythic',
  encounterId: 0,
  cluster_code: 'TEST',
  Guild: '',
  Season: '106',
  damageType: 'Battle',
  damageDealt: 1_000_000
}

const ELIGIBLE_OLD_BOSS = {
  ...ELIGIBLE_NEW_BOSS,
  Name: 'OldBoss',
  damageDealt: 750_000
}

const NOISE_ONLY_BOSS = {
  ...ELIGIBLE_OLD_BOSS,
  Name: 'NoiseBoss',
  damageType: 'Bomb',
  damageDealt: 2_000_000
}

const SINGLE_PASS_BOSS = {
  ...ELIGIBLE_OLD_BOSS,
  Name: 'SinglePassBoss',
  rarity: 'Legendary',
  set: 0,
  loopIndex: 0
}

const LOOP_WINDOW_BOSS = {
  ...ELIGIBLE_OLD_BOSS,
  Name: 'LoopWindowBoss',
  rarity: 'Legendary',
  set: 3,
  loopIndex: 1
}

const BOSS_ROWS = [
  ELIGIBLE_NEW_BOSS,
  ELIGIBLE_NEW_BOSS,
  ELIGIBLE_OLD_BOSS,
  {
    ...ELIGIBLE_OLD_BOSS,
    damageType: 'Bomb',
    damageDealt: 2_000_000
  },
  {
    ...ELIGIBLE_OLD_BOSS,
    damageType: 'Bomb',
    damageDealt: 2_000_000
  },
  {
    ...ELIGIBLE_OLD_BOSS,
    damageDealt: 0
  },
  {
    ...ELIGIBLE_OLD_BOSS,
    damageDealt: 0
  },
  NOISE_ONLY_BOSS,
  SINGLE_PASS_BOSS,
  LOOP_WINDOW_BOSS,
  NOISE_ONLY_BOSS,
  {
    ...NOISE_ONLY_BOSS,
    damageType: 'Battle',
    damageDealt: 0
  }
]

const leaderboardRow = (displayName: string, userId: string) => ({
  displayName,
  userId,
  Guild: '',
  damageDealt: 1_000_000,
  completedOn: '2026-08-01T12:00:00Z',
  heroDetails: null,
  machineOfWarDetails: null,
  tier: 7,
  loopIndex: 1,
  cluster_code: 'TEST'
})

class MockQuery implements PromiseLike<QueryResult> {
  readonly state: QueryState

  constructor(table: string) {
    this.state = {
      table,
      columns: '',
      filters: new Map(),
      greaterThanFilters: new Map()
    }
  }

  select(columns: string) {
    this.state.columns = columns
    return this
  }

  eq(column: string, value: unknown) {
    this.state.filters.set(column, value)
    return this
  }

  not() {
    return this
  }

  gt(column: string, value: number) {
    this.state.greaterThanFilters.set(column, value)
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  in() {
    return this
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return resolveQuery(this.state).then(onfulfilled, onrejected)
  }
}

let oldLeaderboard: Deferred<QueryResult>
let leaderboardRequests: string[]
let catalogQueries: QueryState[]

function resolveQuery(state: QueryState): Promise<QueryResult> {
  if (state.table === 'meta_teams') {
    return Promise.resolve({
      data: [{ team_name: 'Test team', trigger_heroes: [], match_type: 'any' }],
      error: null
    })
  }

  if (state.table === 'guild_config') {
    return Promise.resolve({ data: [], error: null })
  }

  if (state.columns.startsWith('Name, tier')) {
    catalogQueries.push(state)
    const data = BOSS_ROWS.filter((row) => {
      for (const [column, value] of state.filters) {
        if (String(row[column as keyof typeof row]) !== String(value)) {
          return false
        }
      }
      for (const [column, value] of state.greaterThanFilters) {
        if (Number(row[column as keyof typeof row]) <= value) {
          return false
        }
      }
      return true
    })
    return Promise.resolve({ data, error: null })
  }

  if (state.columns.includes('remainingHp')) {
    return Promise.resolve({ data: [], error: null })
  }

  const bossName = String(state.filters.get('Name'))
  leaderboardRequests.push(bossName)
  if (bossName === 'OldBoss') {
    return oldLeaderboard.promise
  }

  return Promise.resolve({
    data: [leaderboardRow('New Player', 'new-player')],
    error: null
  })
}

beforeEach(() => {
  oldLeaderboard = deferred<QueryResult>()
  leaderboardRequests = []
  catalogQueries = []
  mocks.from.mockReset()
  mocks.from.mockImplementation((table: string) => new MockQuery(table))
  mocks.measureAsync.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('BossLeaderboards request lifecycle', () => {
  it('keeps noise-only bosses selectable but defaults by eligible battle participation', async () => {
    render(<BossLeaderboards initialSeason="106" userGuild="" />)

    expect((await screen.findAllByText('New Player')).length).toBeGreaterThan(0)
    expect(catalogQueries[0]?.columns).toContain('damageType, damageDealt')
    expect(catalogQueries[0]?.filters.has('damageType')).toBe(false)
    expect(catalogQueries[0]?.greaterThanFilters.has('damageDealt')).toBe(false)
    expect(
      screen.getByRole('button', { name: /NoiseBoss/ })
    ).toBeInTheDocument()
    expect(leaderboardRequests).not.toContain('OldBoss')
    expect(leaderboardRequests).not.toContain('NoiseBoss')
  })

  it('keeps cached current data visible when an older request resolves late', async () => {
    const user = userEvent.setup()
    render(<BossLeaderboards initialSeason="106" userGuild="" />)

    expect((await screen.findAllByText('New Player')).length).toBeGreaterThan(0)
    const initialNewRequests = leaderboardRequests.filter(
      (boss) => boss === 'NewBoss'
    ).length

    await user.click(screen.getByRole('button', { name: /OldBoss/ }))
    await waitFor(() => expect(leaderboardRequests).toContain('OldBoss'))

    await user.click(screen.getByRole('button', { name: /NewBoss/ }))
    await waitFor(() =>
      expect(screen.getAllByText('New Player').length).toBeGreaterThan(0)
    )
    expect(
      leaderboardRequests.filter((boss) => boss === 'NewBoss')
    ).toHaveLength(initialNewRequests)

    await act(async () => {
      oldLeaderboard.resolve({
        data: [leaderboardRow('Old Player', 'old-player')],
        error: null
      })
      await oldLeaderboard.promise
    })

    await waitFor(() => {
      expect(screen.queryByText('Old Player')).not.toBeInTheDocument()
      expect(screen.getAllByText('New Player').length).toBeGreaterThan(0)
    })
  })

  it('loads leaderboard data for a selected single-pass boss', async () => {
    const user = userEvent.setup()
    render(<BossLeaderboards initialSeason="106" userGuild="" />)

    expect((await screen.findAllByText('New Player')).length).toBeGreaterThan(0)
    await user.click(
      screen.getByRole('button', { name: /Show single-pass stages L1/i })
    )
    await user.click(screen.getByRole('button', { name: 'L1' }))
    await user.click(screen.getByRole('button', { name: /SinglePassBoss/ }))

    await waitFor(() => expect(leaderboardRequests).toContain('SinglePassBoss'))
  })
})
