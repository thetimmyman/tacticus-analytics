import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  configure,
  within
} from '@testing-library/react'
import SeasonPlannerClient from '@/app/(dashboard)/boss-assignments/season-planner/SeasonPlannerClient'
import type { SeasonConfigInfo } from '@/app/(dashboard)/boss-playbooks/types'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'

configure({ asyncUtilTimeout: 5000 })

const CONFIG_ID = 'config_140'

const allSeasons: SeasonConfigInfo[] = [
  { id: CONFIG_ID, index: 1, canonicals: [] }
]

const snapshotFixture = {
  snapshotAt: '2026-07-01T00:00:00.000Z',
  guildCode: 'TEST',
  season: '140',
  seasonId: CONFIG_ID,
  stageCode: 'L1',
  loopIndex: 0,
  advancedStage: false,
  encounters: {
    main: {
      encounterId: 0,
      targetUid: 'm',
      targetLabel: 'L1 Main',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'boss-main',
      maxHp: 1000,
      remainingHp: 1000,
      seededFromMax: false,
      confidence: 'high'
    },
    prime1: {
      encounterId: 1,
      targetUid: 'p1',
      targetLabel: 'L1 Prime 1',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'p1',
      maxHp: 0,
      remainingHp: 0,
      seededFromMax: true,
      confidence: 'low'
    },
    prime2: {
      encounterId: 2,
      targetUid: 'p2',
      targetLabel: 'L1 Prime 2',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'p2',
      maxHp: 0,
      remainingHp: 0,
      seededFromMax: true,
      confidence: 'low'
    }
  },
  warnings: []
}

const rosterFixture = [
  { player_id: 'p1', display_name: 'Alice' },
  { player_id: 'p2', display_name: 'Bob' }
]

// Back-to-back sessions merge into ONE stage and loop row but stay two per-player/session rows.
const planPayload = {
  season: '140',
  season_id: CONFIG_ID,
  season_start_at: '2026-07-01T00:00:00.000Z',
  season_end_at: '2026-07-14T00:00:00.000Z',
  snapshot_at: '2026-07-01T00:00:00.000Z',
  time_zone: 'UTC',
  lookback_days: 30,
  sessions_per_day: 1,
  snapshot: snapshotFixture,
  plan: {
    sessions: [
      {
        at: '2026-07-01T01:00:00.000Z',
        playerId: 'p1',
        playerDisplayName: 'Alice',
        tokensAvailable: 2,
        tokensSpent: 2,
        tokensHeld: 0,
        actions: [
          {
            type: 'token_attack',
            at: '2026-07-01T01:00:00.000Z',
            playerId: 'p1',
            stageCode: 'L1',
            loopIndex: 0,
            encounterId: 0,
            bossName: 'boss-main',
            expectedDamage: 100,
            appliedDamage: 100,
            overkillDamage: 0
          },
          {
            type: 'token_attack',
            at: '2026-07-01T01:05:00.000Z',
            playerId: 'p1',
            stageCode: 'L1',
            loopIndex: 0,
            encounterId: 0,
            bossName: 'boss-main',
            expectedDamage: 100,
            appliedDamage: 100,
            overkillDamage: 0
          }
        ]
      },
      {
        at: '2026-07-01T02:00:00.000Z',
        playerId: 'p2',
        playerDisplayName: 'Bob',
        tokensAvailable: 1,
        tokensSpent: 1,
        tokensHeld: 1,
        actions: [
          {
            type: 'token_attack',
            at: '2026-07-01T02:00:00.000Z',
            playerId: 'p2',
            stageCode: 'L1',
            loopIndex: 0,
            encounterId: 0,
            bossName: 'boss-main',
            expectedDamage: 50,
            appliedDamage: 50,
            overkillDamage: 0
          }
        ]
      }
    ],
    finalRaidState: snapshotFixture,
    metrics: {
      tokensSpent: 3,
      overkillDamage: 0,
      bossesDefeated: 0,
      loopAdvances: 0,
      wastedTokens: 0,
      wastedTicks: 0
    },
    warnings: []
  },
  remainingBossSequence: [],
  tokens_remaining_spendable: 0
}

const savedPlanFixture = {
  id: 'saved-1',
  season_id: CONFIG_ID,
  start_at: planPayload.season_start_at,
  end_at: planPayload.season_end_at,
  snapshot_at: planPayload.snapshot_at,
  kind: 'replan',
  baseline_key: null,
  baseline_plan_id: null,
  trigger: 'ui_generate',
  seed: null,
  plan_hash: null,
  plan_metrics: null,
  resolved_options: null,
  created_by: null,
  created_at: '2026-07-01T03:00:00.000Z',
  updated_at: '2026-07-01T03:00:00.000Z'
}

const rosterStrategyFixture = {
  clusterCode: 'cluster-a',
  targetGuildCode: 'TEST',
  guilds: [
    {
      guildCode: 'TEST',
      displayName: 'Test Guild',
      clusterCode: 'cluster-a',
      timeZone: 'UTC'
    }
  ],
  members: [
    { playerId: 'p1', displayName: 'Alice', guildCode: 'TEST', role: 'officer' }
  ],
  seasons: [{ season: '140', configId: CONFIG_ID, label: 'S140' }],
  baseline: {
    guildCode: 'TEST',
    aggregate: {
      guildCode: 'TEST',
      memberCount: 1,
      tokensSpent: 3,
      tokensHeld: 1,
      wastedTokens: 0,
      bossesDefeated: 0,
      loopAdvances: 0,
      appliedDamage: 250,
      expectedDamage: 250,
      overkillDamage: 0,
      tokenEfficiency: 83,
      finalStageCode: 'L1',
      finalLoopIndex: 0,
      tokensRemainingSpendable: 0
    },
    seasons: [],
    contributions: []
  },
  swap: null,
  optimizer: [
    {
      candidatePlayerId: 'p3',
      candidateDisplayName: 'Candidate Carol',
      candidateGuildCode: 'TEST',
      replacedPlayerId: 'p2',
      replacedDisplayName: 'Bob',
      baseline: {},
      projected: {},
      delta: {
        tokensSpent: 0,
        wastedTokens: 0,
        bossesDefeated: 1,
        loopAdvances: 0,
        appliedDamage: 100,
        expectedDamage: 100,
        overkillDamage: 0,
        tokenEfficiency: 25,
        score: 40
      },
      fitDamage: 900,
      sampleCount: 5,
      reasons: []
    }
  ],
  investments: [
    {
      playerId: 'p1',
      displayName: 'Alice',
      heroName: 'Hero One',
      unitId: 'unit-1',
      state: 'owned',
      priorityScore: 10,
      bossNames: ['boss-main'],
      raritySets: [],
      currentRank: 'diamond1',
      currentAbilities: { active: 3, passive: 3 },
      recommendation: 'Rank up active ability'
    }
  ],
  warnings: []
}

// Record shape (not `unknown`) keeps this suite off the frozen unknown ratchet.
function jsonRes(
  data: Record<string, object | string | number | boolean | null>
) {
  return { ok: true, status: 200, json: async () => data }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/season-plan/snapshot')) {
      return jsonRes({
        snapshot: snapshotFixture,
        roster: rosterFixture,
        detectedConfigId: CONFIG_ID
      })
    }
    if (u.includes('/season-plan/generate')) {
      return jsonRes(planPayload)
    }
    if (u.includes('/season-plan?season_id=')) {
      return jsonRes({ plans: [savedPlanFixture] })
    }
    if (u.includes('/season-plan/roster-strategy')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      return jsonRes({
        ...rosterStrategyFixture,
        optimizer: body.include_optimizer
          ? rosterStrategyFixture.optimizer
          : [],
        investments: rosterStrategyFixture.investments
      })
    }
    return jsonRes({})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderWithPlanAndStrategy() {
  render(
    <SeasonPlannerClient
      canEdit
      currentSeasonIndex={1}
      allSeasons={allSeasons}
      initialSeason="140"
      initialConfigId={CONFIG_ID}
      liveConfigId={CONFIG_ID}
    />
  )

  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  fireEvent.click(screen.getByText('Generate Plan'))
  // Outside tests/**'s jest-dom types, so use the DOM property instead of toBeDisabled.
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: /generate plan/i
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  )
  await waitFor(() => expect(screen.getByText(/Loops \(/i)).toBeTruthy())

  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: /optimize roster/i
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  )
  fireEvent.click(screen.getByRole('button', { name: /optimize roster/i }))
  await waitFor(() => expect(screen.getByText('Roster optimizer')).toBeTruthy())
}

// Tables sit at different depths: walk up to the shared `rounded-lg` card, then search down.
function tableNearHeading(matcher: string | RegExp): HTMLElement {
  const heading = screen.getByText(matcher)
  const card = heading.closest('[class*="rounded-lg"]') as HTMLElement | null
  if (!card) throw new Error(`No card container found for heading: ${matcher}`)
  const table = card.querySelector('table')
  if (!table) throw new Error(`No table found under heading: ${matcher}`)
  return table as HTMLElement
}

// Narrows indexed access under noUncheckedIndexedAccess.
function rowAt(table: HTMLElement, index: number): HTMLElement {
  const row = within(table).getAllByRole('row')[index]
  if (!row) throw new Error(`No row at index ${index}`)
  return row
}

describe('SeasonPlannerClient — DataTable migration smoke tests', () => {
  it('renders the Roster optimizer table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    const table = tableNearHeading('Roster optimizer')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Candidate',
      'Swap out',
      'Clears',
      'Damage/token',
      'Fit damage',
      'Samples'
    ])

    const firstRow = rowAt(table, 1)
    expect(within(firstRow).getByText('Candidate Carol')).toBeTruthy()
    expect(within(firstRow).getByText('Bob')).toBeTruthy()
  })

  it('renders the Investment priorities table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    const table = tableNearHeading('Investment priorities')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Member',
      'Hero',
      'State',
      'Bosses',
      'Next investment'
    ])

    const firstRow = rowAt(table, 1)
    expect(within(firstRow).getByText('Alice')).toBeTruthy()
    expect(within(firstRow).getByText('Hero One')).toBeTruthy()
  })

  it('renders the Saved Plans table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    await waitFor(() => expect(screen.getByText('replan')).toBeTruthy())

    const table = screen.getByText('replan').closest('table') as HTMLElement
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Created',
      'Kind',
      'Trigger',
      'Snapshot',
      'Actions'
    ])

    const firstRow = rowAt(table, 1)
    expect(within(firstRow).getByText('replan')).toBeTruthy()
    expect(within(firstRow).getByText('ui_generate')).toBeTruthy()
    expect(within(firstRow).getByRole('button', { name: 'Load' })).toBeTruthy()
  })

  it('renders the Loops table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    const table = tableNearHeading(/Loops \(/i)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Loop',
      'Start',
      'End',
      'Stages',
      'Tokens',
      'Players'
    ])

    const firstRow = rowAt(table, 1)
    const cells = within(firstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent?.trim())
    expect(cells[0]).toBe('0')
    expect(cells[3]).toBe('1')
    expect(cells[4]).toBe('3')
    expect(cells[5]).toBe('2')
  })

  it('renders the Stage timeline table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    const table = tableNearHeading(/Stage timeline \(/i)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Start',
      'End',
      'Stage',
      'Loop',
      'Boss',
      'Tokens',
      'Top attackers'
    ])

    const firstRow = rowAt(table, 1)
    expect(within(firstRow).getByText('L1')).toBeTruthy()
    expect(within(firstRow).getByText(/Alice \(2\)/)).toBeTruthy()
  })

  it('renders the Per-player totals table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    const table = tableNearHeading('Per-player totals')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual(['Player', 'Sessions', 'Spent', 'Held'])

    const firstRow = rowAt(table, 1)
    const cells = within(firstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent?.trim())
    expect(cells).toEqual(['Alice', '1', '2', '0'])
  })

  it('renders the Sessions table with the expected headers and first row', async () => {
    await renderWithPlanAndStrategy()

    const table = tableNearHeading(/^Sessions \(/i)
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual(['At', 'Player', 'Spent', 'Held', 'Target'])

    const firstRow = rowAt(table, 1)
    const cells = within(firstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent?.trim())
    expect(within(firstRow).getByText('Alice')).toBeTruthy()
    expect(cells[2]).toBe('2')
    expect(cells[3]).toBe('0')
    expect(cells[4]).toBe(getBossDisplayName('boss-main'))
  })
})
