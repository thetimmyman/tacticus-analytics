import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TargetsClient from '@/app/(dashboard)/boss-assignments/targets/TargetsClient'

vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))
vi.mock('@/app/components/ui/BossPortrait', () => ({
  BossPortrait: ({ bossName }: { bossName: string }) => (
    <div data-testid="boss-portrait">{bossName}</div>
  )
}))
vi.mock(
  '@/app/(dashboard)/boss-assignments/_components/AssignmentSeasonWindow',
  () => ({ AssignmentSeasonWindow: () => <div data-testid="season-window" /> })
)

const SLOTS = [
  {
    boss_type: 'Magnus',
    boss_name: 'Magnus the Red',
    rarity: 'Mythic',
    set: 1,
    encounter_id: 0
  },
  {
    boss_type: 'Magnus',
    boss_name: 'Abraxas',
    rarity: 'Mythic',
    set: 1,
    encounter_id: 1
  },
  {
    boss_type: 'Magnus',
    boss_name: 'Thaumachus',
    rarity: 'Mythic',
    set: 1,
    encounter_id: 2
  }
]

const targetRow = (patch: Record<string, unknown>) => ({
  boss_name: 'Magnus',
  rarity: 'Mythic',
  set: 1,
  encounter_id: 0,
  target_tokens: 4,
  source: 'officer_manual',
  seeded_from_seasons: null,
  notes: null,
  updated_by: null,
  updated_at: '2026-07-31T00:00:00Z',
  skip: false,
  ...patch
})

let fetchCalls: Array<{
  url: string
  method: string
  body: Record<string, unknown>
}> = []

function mockFetch(
  rows: Array<Record<string, unknown>>,
  opts: { failPut?: boolean } = {}
) {
  fetchCalls = []
  let savedRows = rows.map((row) => ({ ...row }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input)
      const method = String(init?.method ?? 'GET').toUpperCase()
      fetchCalls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : {}
      })
      const json = (payload: unknown) =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      if (url.includes('/schedule')) {
        return json({
          current: { config_id: 'c', season_number: 103, slots: SLOTS },
          upcoming: { config_id: 'c', season_number: 104, slots: SLOTS },
          selected: { config_id: 'c', season_number: 103, slots: SLOTS },
          all: { slots: SLOTS, config_ids: ['c'] }
        })
      }
      if (url.includes('target-tokens')) {
        if ((method === 'PUT' || method === 'PATCH') && opts.failPut) {
          return new Response('nope', { status: 500 })
        }
        if (method === 'PUT' || method === 'PATCH') {
          const input = JSON.parse(String(init?.body))
          savedRows = savedRows.map((row) =>
            row.boss_name === input.boss_name &&
            row.encounter_id === input.encounter_id
              ? {
                  ...row,
                  ...input,
                  ...(method === 'PUT' ? { source: 'officer_manual' } : {})
                }
              : row
          )
          return json({ row: input })
        }
        return json({ rows: savedRows })
      }
      return json({ ok: true })
    })
  )
}

function renderClient(props: Record<string, unknown> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  return render(
    <QueryClientProvider client={qc}>
      <TargetsClient
        guildCode="TESTGUILD"
        canEdit
        canSeed={false}
        seasonOptions={[]}
        selectedSeason="103"
        {...props}
      />
    </QueryClientProvider>
  )
}

// Disambiguated by aria-expanded: the desktop gear's aria-label also contains the boss name.
const findGroupHeader = async () => {
  const buttons = await screen.findAllByRole('button', {
    name: /Magnus the Red/
  })
  const header = buttons.find((b) => b.hasAttribute('aria-expanded'))
  if (!header) throw new Error('accordion group header not found')
  return header
}

beforeEach(() => mockFetch([targetRow({})]))
afterEach(() => vi.unstubAllGlobals())

describe('TargetsClient', () => {
  it('keeps a seeded legacy target seeded when an officer edits only its note', async () => {
    mockFetch([
      targetRow({
        source: 'historical_seed',
        seeded_from_seasons: '101,102',
        season_number: ''
      })
    ])
    renderClient()
    await findGroupHeader()
    fireEvent.click(
      (
        await screen.findAllByRole('button', {
          name: 'Edit target notes for Magnus the Red'
        })
      )[0]!
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Target notes for Magnus the Red' }),
      { target: { value: 'Keep the historical refresh' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save target notes' }))
    await waitFor(() =>
      expect(
        screen.getAllByText('Keep the historical refresh').length
      ).toBeGreaterThan(0)
    )
    expect(screen.getByTitle('Seeded from 101,102')).toHaveTextContent('Seeded')
    const writes = fetchCalls.filter(({ method }) => method !== 'GET')
    expect(writes).toEqual([
      {
        url: '/api/boss-assignments/target-tokens?guild_code=TESTGUILD',
        method: 'PATCH',
        body: {
          boss_name: 'Magnus',
          rarity: 'Mythic',
          set: 1,
          encounter_id: 0,
          season_number: '',
          notes: 'Keep the historical refresh'
        }
      }
    ])
  })

  it('shows saved actual-token comparisons in the expanded narrow layout', async () => {
    renderClient({
      desktopMode: true,
      perBossActuals: {
        Magnus__Mythic__1__0: {
          season: '102',
          tokensToKill: 8.25,
          sampleCount: 3
        }
      }
    })
    fireEvent.click(await findGroupHeader())
    const reset = screen.getByRole('button', {
      name: 'Reset target for Magnus the Red'
    })
    const row = reset.parentElement!
    expect(within(row).getByText('actual ≈ 8.3')).toHaveAttribute(
      'title',
      'Recent guild actual: 8.3 tokens to kill (S102, 3 attacks)'
    )
  })

  it('lets an officer skip a prime from the narrow layout and reloads that saved state', async () => {
    mockFetch([targetRow({ encounter_id: 1 })])
    renderClient()
    fireEvent.click(await findGroupHeader())
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Skip target for Abraxas' })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Skip target for Abraxas' })
      ).toBeChecked()
    )
    expect(screen.getAllByText(/Skipped/).length).toBeGreaterThan(0)
  })

  it('retains the saved note and edit draft after a refused note write', async () => {
    mockFetch([targetRow({ notes: 'Original target note' })], { failPut: true })
    renderClient()
    await findGroupHeader()
    fireEvent.click(
      (
        await screen.findAllByRole('button', {
          name: 'Edit target notes for Magnus the Red'
        })
      )[0]!
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Target notes for Magnus the Red' }),
      { target: { value: 'Rejected draft' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save target notes' }))
    await waitFor(() =>
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    )
    expect(
      screen.getByRole('textbox', { name: 'Target notes for Magnus the Red' })
    ).toHaveValue('Rejected draft')
    expect(
      screen.queryByText('Rejected draft', { selector: 'p' })
    ).not.toBeInTheDocument()
  })

  it('edits target notes through the hydrated interface and reloads the saved note', async () => {
    mockFetch([targetRow({ notes: 'Original target note' })])
    renderClient()
    await findGroupHeader()
    fireEvent.click(
      (
        await screen.findAllByRole('button', {
          name: 'Edit target notes for Magnus the Red'
        })
      )[0]!
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Target notes for Magnus the Red' }),
      { target: { value: 'Use the saved anti-boss team' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save target notes' }))
    await waitFor(() =>
      expect(
        screen.getAllByText('Use the saved anti-boss team').length
      ).toBeGreaterThan(0)
    )
    expect(
      screen.queryByRole('textbox', { name: 'Target notes for Magnus the Red' })
    ).not.toBeInTheDocument()
  })

  it('groups the stage into one accordion card with a token total', async () => {
    mockFetch([
      targetRow({ encounter_id: 0, target_tokens: 22 }),
      targetRow({ encounter_id: 1, target_tokens: 2 })
    ])
    renderClient()

    // Main + two primes collapse to one group; 22 + 2 = 24 planned.
    const group = await findGroupHeader()
    expect(group).toBeInTheDocument()
    expect(screen.getAllByText('24').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2\/3 set/).length).toBeGreaterThan(0)
  })

  it('does NOT count an unset row as zero in the group total', async () => {
    // Unset means auto-derive from history, not a target of 0.
    mockFetch([targetRow({ encounter_id: 0, target_tokens: 7 })])
    renderClient()

    await findGroupHeader()
    expect(screen.getAllByText('7').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1\/3 set/).length).toBeGreaterThan(0)
  })

  it('renders zero mutation controls for a read-only member', async () => {
    renderClient({ canEdit: false, canManageHerald: false })
    await findGroupHeader()
    expect(screen.queryAllByTestId('targets-mutation-control')).toHaveLength(0)
  })

  it('renders mutation controls for an officer', async () => {
    renderClient({ canEdit: true })
    await findGroupHeader()
    await waitFor(() =>
      expect(
        screen.queryAllByTestId('targets-mutation-control').length
      ).toBeGreaterThan(0)
    )
  })

  it('gates the ops gear on canManageHerald, in BOTH layouts', async () => {
    // Gated on canManageHerald, narrower than canEdit: herald routes have no app-admin bypass.
    const { unmount } = renderClient({ canManageHerald: false })
    await findGroupHeader()
    fireEvent.click(await findGroupHeader())
    expect(
      screen.queryAllByRole('button', { name: /Open ops settings/ })
    ).toHaveLength(0)
    unmount()

    renderClient({ canManageHerald: true })
    const group = await findGroupHeader()
    fireEvent.click(group)
    expect(
      screen.getAllByRole('button', { name: /Open ops settings/ }).length
    ).toBeGreaterThan(0)
  })

  it('renders the None-available sentinel distinctly from an officer skip', async () => {
    // A seeded "no data at this tier" row has skip=true but is not an officer opt-out.
    mockFetch([
      targetRow({
        encounter_id: 1,
        skip: true,
        source: 'historical_seed',
        seeded_from_seasons: 'none available',
        target_tokens: 1
      }),
      targetRow({ encounter_id: 2, skip: true, source: 'officer_manual' })
    ])
    renderClient()

    const group = await findGroupHeader()
    fireEvent.click(group)
    expect(screen.getAllByText(/None available/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Skipped/).length).toBeGreaterThan(0)
  })

  it('shows Skipped for a prime skipped ONLY via the season planner (D20 union)', async () => {
    // The planner unions both stores, so this page must too.
    mockFetch([targetRow({ encounter_id: 1, skip: false, target_tokens: 2 })])
    renderClient({
      canManageHerald: true,
      opsSlice: {
        seasonNumber: 103,
        loadFailed: false,
        byKey: {
          Magnus__Mythic__1__1: {
            key: 'Magnus__Mythic__1__1',
            bossType: 'Magnus',
            rarity: 'Mythic',
            set: 1,
            encounterId: 1,
            difficultyCode: 'M1',
            heraldBossId: 'Magnus_E1',
            roleIds: [],
            roleLabels: {},
            notes: null,
            behaviour: 'skip',
            thresholdHpPct: null
          }
        }
      }
    })

    const group = await findGroupHeader()
    fireEvent.click(group)
    expect(screen.getAllByText(/Skipped/).length).toBeGreaterThan(0)
  })

  it('surfaces the tier-fallback provenance rather than hiding it', async () => {
    mockFetch([
      targetRow({
        encounter_id: 0,
        source: 'historical_seed',
        seeded_from_seasons: 'fallback from L3'
      })
    ])
    renderClient()
    const group = await findGroupHeader()
    fireEvent.click(group)
    expect(screen.getAllByText(/Fallback: L3/).length).toBeGreaterThan(0)
  })

  it('saveEdit keeps sending an explicit skip:false (C10)', async () => {
    // Committing a real target clears skip (product decision).
    renderClient()
    await findGroupHeader()
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Edit' }))[0]!
    )
    const input = screen.getAllByRole('spinbutton')[0]!
    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(fetchCalls.some((c) => c.method === 'PUT')).toBe(true)
    )
    const put = fetchCalls.find((c) => c.method === 'PUT')!
    expect(put.body.skip).toBe(false)
    expect(put.body.target_tokens).toBe(6)
    expect(put.body.season_number).toBe('103')
    expect(put.body.boss_name).toBe('Magnus')
    expect(put.url).toContain('guild_code=TESTGUILD')
  })

  it('surfaces a failed save inline instead of dying silently (D9)', async () => {
    mockFetch([targetRow({})], { failPut: true })
    renderClient()
    await findGroupHeader()
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Edit' }))[0]!
    )
    const input = screen.getAllByRole('spinbutton')[0]!
    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Save failed/)).toBeInTheDocument()
  })
})
