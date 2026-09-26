import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemberListTable } from './MemberListTable'
import type { ExtendedMember, SortColumn } from './types'

// The parent defaults a new column to 'asc' (DataTable: 'desc'), so onSortChange forwards the key.

function makeMember(overrides: Partial<ExtendedMember>): ExtendedMember {
  const base: ExtendedMember = {
    api_key_added_at: null,
    api_key_is_valid: null,
    api_key_last_verified: null,
    assigned_at: null,
    assigned_by: null,
    assignment_notes: null,
    auto_generated: null,
    avatar_unit_id: null,
    avatar_url: null,
    boss_preferences: null,
    cluster_code: null,
    cluster_id: null,
    created_at: null,
    discord_user_id: null,
    discord_username: null,
    display_name: 'Unknown',
    guild_code: 'TEST',
    hasApiKey: false,
    has_duplicate_name: null,
    id: 1,
    is_active: null,
    is_app_admin: null,
    is_current: null,
    last_active_at: null,
    last_battle_time: null,
    last_sync_at: null,
    last_sync_bombs: null,
    last_sync_tokens: null,
    next_bomb_seconds: null,
    next_token_seconds: null,
    notify_boss_kills: null,
    notify_prime_kills: null,
    notify_when_capped: null,
    officer_notes: null,
    original_display_name: null,
    ownership_attestation_id: null,
    patreon_user_id: null,
    player_id: 'p-unknown',
    player_level: null,
    player_notes: null,
    player_power: null,
    preferences_updated_at: null,
    primary_boss: null,
    primary_team: null,
    protected: null,
    role: null,
    secondary_boss: null,
    secondary_team: null,
    tacticus_api_key_encrypted: null,
    tacticus_share_url: null,
    tertiary_team: null,
    theme_preference: null,
    timezone: null,
    updated_at: null,
    user_id: null,
    username: null
  }
  return { ...base, ...overrides }
}

// Deliberately not alphabetical: rows arrive pre-sorted and must render as given.
const bob = makeMember({ player_id: 'p2', display_name: 'Bob' })
const alice = makeMember({ player_id: 'p1', display_name: 'Alice' })

function renderTable(onSort = vi.fn()) {
  render(
    <MemberListTable
      members={[bob, alice]}
      tokenData={{}}
      bossPerformanceData={{}}
      metaTeams={[]}
      selectedSeason="140"
      sortConfig={{ column: 'player' as SortColumn, direction: 'asc' }}
      onSort={onSort}
      onOpenAction={vi.fn()}
      canEditMember={() => false}
      canInviteMember={false}
      hasCluster
    />
  )
  return onSort
}

function desktopTable(): HTMLElement {
  const tables = screen.getAllByRole('table')
  // The mobile card list has no <table>, so only the desktop DataTable matches.
  const table = tables[0]
  if (!table) throw new Error('No desktop table rendered')
  return table
}

// Narrows indexed access under noUncheckedIndexedAccess.
function rowAt(table: HTMLElement, index: number): HTMLElement {
  const row = within(table).getAllByRole('row')[index]
  if (!row) throw new Error(`No row at index ${index}`)
  return row
}

describe('MemberListTable — DataTable migration smoke tests', () => {
  it('renders the desktop table headers in order and the first row already-sorted', () => {
    const onSort = renderTable()
    const table = desktopTable()

    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Player',
      'Token / Bomb Availability',
      'Boss Preferences',
      'Meta Team Preferences',
      'Boss Performance (Guild / Cluster)',
      'Officer Notes',
      'Actions'
    ])

    // Bob first proves externallySorted is honoured.
    const firstRow = rowAt(table, 1)
    expect(within(firstRow).getByText('Bob')).toBeTruthy()
    expect(within(firstRow).getByText('No edit access')).toBeTruthy()

    expect(onSort).not.toHaveBeenCalled()
  })

  it('forwards only the clicked column key on sort — not DataTable-computed direction', () => {
    const onSort = renderTable()
    const table = desktopTable()

    const playerHeaderButton = within(table).getByRole('columnheader', {
      name: /player/i
    })
    within(playerHeaderButton).getByRole('button').click()
    expect(onSort).toHaveBeenLastCalledWith('player')

    const notesHeaderButton = within(table).getByRole('columnheader', {
      name: /officer notes/i
    })
    within(notesHeaderButton).getByRole('button').click()
    expect(onSort).toHaveBeenLastCalledWith('notes')

    expect(onSort).toHaveBeenCalledTimes(2)
  })

  it('renders the empty-state message via the `empty` prop when there are no members', () => {
    render(
      <MemberListTable
        members={[]}
        tokenData={{}}
        bossPerformanceData={{}}
        metaTeams={[]}
        selectedSeason="140"
        sortConfig={{ column: 'player' as SortColumn, direction: 'asc' }}
        onSort={vi.fn()}
        onOpenAction={vi.fn()}
        canEditMember={() => false}
      />
    )

    expect(
      within(screen.getByRole('table')).getAllByText(
        'No members match your current filters.'
      ).length
    ).toBeGreaterThan(0)
  })
})
