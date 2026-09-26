import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

// Rows arrive pre-ordered, so every column is sortable:false.

type MockSearchParams = { tab?: string }

let currentSearchParams: MockSearchParams = {}
const routerReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => ({
    get: (key: string) =>
      key === 'tab' ? (currentSearchParams.tab ?? null) : null
  })
}))

const MATCH_ROW = {
  war_id: 'war-1',
  guild_code: 'atk1',
  opponent_guild_code: 'opp1',
  opponent_guild_name: 'Blood Ravens',
  war_status: 'completed',
  war_result: 'win',
  guild_score: 5000,
  opponent_score: 3200,
  war_start_date: '2026-07-01T00:00:00Z',
  war_end_date: '2026-07-03T00:00:00Z',
  war_season: 1
}

const ATTEMPT_ROW = {
  id: 'attempt-1',
  war_id: 'war-1',
  guild_code: 'atk1',
  is_guild_member: true,
  attacker_team_index: 0,
  attacker_guild_name: 'Attackers Inc',
  player_id: 'player-1',
  player_name: 'Commander Shepard',
  attempt_number: 3,
  attempt_status: 'completed',
  attempt_result: 'win',
  damage_dealt: 100000,
  score_earned: 4500,
  attempt_start_time: '2026-07-02T00:00:00Z',
  zone_id: 'zone-1'
}

// No legacy `zone_name`, proving the column renders a derived name.
const ZONE_ROW = {
  id: 'zone-1',
  war_id: 'war-1',
  guild_code: 'atk1',
  zone_number: 5,
  zone_type: 'ComsStation',
  zone_status: 'completed',
  assigned_players: ['Commander Shepard'],
  raw_loki_data: { attempts: [{ scoreEarned: 4500 }] }
}

type MockRow = typeof MATCH_ROW | typeof ATTEMPT_ROW | typeof ZONE_ROW

function tableFor(table: string): MockRow[] {
  if (table === 'guild_war_matches') return [MATCH_ROW]
  if (table === 'guild_war_player_attempts') return [ATTEMPT_ROW]
  if (table === 'guild_war_zones') return [ZONE_ROW]
  throw new Error(`Unexpected table: ${table}`)
}

class MockQuery implements PromiseLike<{
  data: MockRow[]
  count: number
  error: null
}> {
  constructor(private readonly table: string) {}
  select() {
    return this
  }
  order() {
    return this
  }
  range() {
    return this
  }
  or() {
    return this
  }
  then<TResult1 = { data: MockRow[]; count: number; error: null }>(
    onfulfilled?:
      | ((value: {
          data: MockRow[]
          count: number
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null
  ) {
    const rows = tableFor(this.table)
    return Promise.resolve({
      data: rows,
      count: rows.length,
      error: null
    }).then(onfulfilled)
  }
}

// A new object per dbClient() call would loop the fetch effect via useCallback deps.
const mockSupabase = {
  from: (table: string) => new MockQuery(table)
}

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => mockSupabase
}))

import GuildWarExplorerClient from '@/app/(dashboard)/war-explorer/GuildWarExplorerClient'

describe('GuildWarExplorerClient', () => {
  it('renders the War Results table (default tab) with header labels in order and the first row', async () => {
    currentSearchParams = {}
    render(<GuildWarExplorerClient />)

    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual([
      'Guild',
      'Opponent',
      'Score',
      'Result',
      'Status',
      'Date',
      'Details'
    ])

    const firstRow = within(table).getAllByRole('row')[1]!
    const cells = within(firstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(cells[0]).toBe('ATK1')
    expect(cells[1]).toBe('Blood Ravens')
    expect(cells[2]).toBe('5000-3200')
    expect(cells[3]).toBe('Win')
  })

  it('renders the Player Activity table with header labels in order and the first row', async () => {
    currentSearchParams = { tab: 'activity' }
    render(<GuildWarExplorerClient />)

    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual([
      'Guild',
      'Player',
      'Attempt #',
      'Result',
      'Score',
      'Time'
    ])

    const firstRow = within(table).getAllByRole('row')[1]!
    const cells = within(firstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(cells[1]).toContain('Commander Shepard')
    expect(cells[2]).toBe('3')
    expect(cells[3]).toBe('Win')
    expect(cells[4]).toBe('4,500')
  })

  it('renders the Zone Assignments table with header labels in order and the first row', async () => {
    currentSearchParams = { tab: 'zones' }
    render(<GuildWarExplorerClient />)

    const table = await screen.findByRole('table')
    const headers = within(table).getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual([
      'Guild',
      'Zone #',
      'Zone',
      'Status',
      'Assigned Players',
      'Total Score'
    ])

    const firstRow = within(table).getAllByRole('row')[1]!
    const cells = within(firstRow)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(cells[0]).toBe('ATK1')
    expect(cells[1]).toBe('5')
    expect(cells[2]).toContain('Vox-Station')
    expect(cells[2]).not.toContain('ComsStation')
    expect(cells[3]).toBe('completed')
    expect(cells[5]).toBe('4,500')
  })
})
