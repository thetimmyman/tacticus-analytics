import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemberGapAnalysisTab } from '@/app/(dashboard)/roster-development/components/MemberGapAnalysisTab'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}))

const membersFixture = [
  {
    player_id: 'p1',
    display_name: 'Bravo',
    has_roster: true,
    has_api_key: true,
    roster_count: 40,
    overall_score: 70,
    performance_vs_guild_avg: 5,
    status: 'strong',
    target_scores: []
  },
  {
    player_id: 'p2',
    display_name: 'Alpha',
    has_roster: true,
    has_api_key: true,
    roster_count: 20,
    overall_score: 40,
    performance_vs_guild_avg: -10,
    status: 'weak',
    target_scores: []
  },
  {
    player_id: 'p3',
    display_name: 'Charlie',
    has_roster: false,
    has_api_key: false,
    roster_count: 0,
    overall_score: null,
    performance_vs_guild_avg: null,
    status: 'no-roster',
    target_scores: []
  }
]

// Record shape keeps this suite off the frozen `unknown` baseline.
function jsonResponse(
  body: Record<string, object | string | number | boolean | null>
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/roster-development/scoring-config')) {
      return Promise.resolve(
        jsonResponse({
          guild_code: 'GLD1',
          config: {
            primary_source: 'playbook',
            strength_target_rarity_set: null,
            tier_optimal_pct: 100,
            tier_strong_pct: 80,
            tier_suitable_pct: 60
          },
          available_rarity_sets: [],
          default_rarity_set: null,
          can_edit: false
        })
      )
    }
    if (url.startsWith('/api/roster-development/member-gaps')) {
      return Promise.resolve(
        jsonResponse({
          guild_code: 'GLD1',
          season: '103',
          members: membersFixture,
          targets_analyzed: [],
          targets_label: 'Targets',
          coach_mode: false,
          active_source: null
        })
      )
    }
    return Promise.reject(new Error(`Unexpected fetch ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const memberNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) =>
        within(row).getAllByRole('cell')[0]?.querySelector('.font-semibold')
          ?.textContent
    )

describe('MemberGapAnalysisTab', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders headers in order and defaults to score-ascending (nulls last)', async () => {
    stubFetch()
    render(<MemberGapAnalysisTab />)

    await screen.findByRole('table')

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Member',
      'Status',
      'Score',
      'Roster',
      'Vs guild avg',
      'Targets'
    ])

    expect(memberNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(
      screen.getByRole('columnheader', { name: /^score$/i })
    ).toHaveAttribute('aria-sort', 'ascending')
  })

  it('re-sorts on a fresh column click starting at asc, and flips on re-click', async () => {
    stubFetch()
    render(<MemberGapAnalysisTab />)
    await screen.findByRole('table')

    // Fresh sorts asc (the hook's rule, not DataTable's default desc).
    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Sort by Member'
      })
    )
    expect(memberNames()).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(
      screen.getByRole('columnheader', { name: /^member$/i })
    ).toHaveAttribute('aria-sort', 'ascending')

    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: 'Sort Member descending'
      })
    )
    expect(memberNames()).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })
})
