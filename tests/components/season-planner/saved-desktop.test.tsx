import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import SeasonPlannerClient from '@/app/(dashboard)/boss-assignments/season-planner/SeasonPlannerClient'
vi.mock('@/app/hooks/useMemberLabels', () => ({
  useMemberLabels: () => ({ labelFor: (value: string) => value })
}))
const id = '11111111-1111-4111-8111-111111111111'
const encounter = {
  encounterId: 0,
  targetUid: 'main',
  targetLabel: 'Main',
  stageCode: 'L1',
  loopIndex: 0,
  bossName: 'Boss',
  maxHp: 10000,
  remainingHp: 10000,
  seededFromMax: false,
  confidence: 'high'
}
const snapshot = {
  snapshotAt: '2026-07-12T00:00:00Z',
  guildCode: 'TEST',
  season: '140',
  seasonId: 'config-test',
  stageCode: 'L1',
  loopIndex: 0,
  advancedStage: false,
  encounters: {
    main: encounter,
    prime1: { ...encounter, encounterId: 1, maxHp: 0, remainingHp: 0 },
    prime2: { ...encounter, encounterId: 2, maxHp: 0, remainingHp: 0 }
  },
  warnings: []
}
const plan = {
  season: '140',
  season_id: 'config-test',
  season_start_at: '2026-07-01T00:00:00Z',
  season_end_at: '2026-07-14T00:00:00Z',
  snapshot_at: snapshot.snapshotAt,
  time_zone: 'UTC',
  lookback_days: 30,
  sessions_per_day: 1,
  snapshot,
  plan: {
    sessions: [],
    finalRaidState: {
      stageCode: 'L1',
      loopIndex: 0,
      encounters: {
        0: encounter,
        1: { ...encounter, encounterId: 1 },
        2: { ...encounter, encounterId: 2 }
      }
    },
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
  remainingBossSequence: []
}
const row = {
  id,
  season_id: 'config-test',
  start_at: plan.season_start_at,
  end_at: plan.season_end_at,
  snapshot_at: plan.snapshot_at,
  kind: 'replan',
  trigger: 'manual',
  created_at: plan.snapshot_at,
  updated_at: plan.snapshot_at,
  plan
}
let rows: (typeof row)[],
  refuseDelete: boolean,
  requestBodies: Record<string, unknown>[],
  fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  rows = [row]
  refuseDelete = false
  requestBodies = []
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    let data: unknown
    if (url.pathname.endsWith('/snapshot'))
      data = { snapshot, roster: [], detectedConfigId: 'config-test' }
    else if (url.pathname.endsWith('/generate'))
      data = {
        ...plan,
        sessions_per_day: Number(url.searchParams.get('sessions_per_day') ?? 1)
      }
    else if (url.pathname.endsWith('/save')) {
      const body = JSON.parse(init!.body as string)
      requestBodies.push(body)
      data = { success: true, id }
      rows = [{ ...row, plan: body.plan }]
    } else if (method === 'DELETE') {
      if (refuseDelete)
        return new Response(JSON.stringify({ error: 'Write refused' }), {
          status: 403
        })
      rows = []
      data = { success: true, id }
    } else if (url.searchParams.has('id')) data = { plan: rows[0] }
    else data = { plans: rows }
    return new Response(JSON.stringify(data), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const props = {
  desktopMode: true,
  initialSeason: '140',
  initialConfigId: 'config-test',
  savedSeasons: ['140'],
  currentSeasonIndex: 0,
  allSeasons: [{ id: 'config-test', index: 1, canonicals: [] }],
  seasonConfigResolutions: [{ seasonNumber: 140, configId: 'config-test' }]
}
it('loads, edits and deletes a saved plan through ordinary controls; refused delete preserves it', async () => {
  render(<SeasonPlannerClient {...props} canEdit />)
  expect(
    await screen.findByText('Calculations run locally; no live API request.', {
      exact: false
    })
  ).toBeTruthy()
  const saved = screen.getByLabelText('Saved season plans')
  await waitFor(() => expect(within(saved).getByText('Edit')).toBeTruthy())
  fireEvent.click(within(saved).getByText('Edit'))
  await waitFor(() =>
    expect(screen.getByText('Save Changes')).not.toBeDisabled()
  )
  fireEvent.change(screen.getByLabelText('Sessions/day'), {
    target: { value: '2' }
  })
  fireEvent.click(screen.getByText('Generate Plan'))
  await waitFor(() =>
    expect(screen.getByText('Save Changes')).not.toBeDisabled()
  )
  fireEvent.click(screen.getByText('Save Changes'))
  await waitFor(() => expect(requestBodies).toHaveLength(1))
  expect(requestBodies[0]).toMatchObject({ id, plan: { sessions_per_day: 2 } })
  await waitFor(() =>
    expect(within(saved).getByText('Delete')).not.toBeDisabled()
  )
  refuseDelete = true
  fireEvent.click(within(saved).getByText('Delete'))
  expect(await within(saved).findByText('Write refused')).toBeTruthy()
  expect(within(saved).getByText('Load')).toBeTruthy()
  refuseDelete = false
  fireEvent.click(within(saved).getByText('Delete'))
  await waitFor(() => expect(within(saved).queryByText('Load')).toBeNull())
})
it('current member loads saved output without generation or mutation controls', async () => {
  render(<SeasonPlannerClient {...props} canEdit={false} />)
  const saved = screen.getByLabelText('Saved season plans')
  fireEvent.click(await within(saved).findByText('Load'))
  await waitFor(() =>
    expect(screen.getByLabelText('Season plan results')).toHaveAttribute(
      'data-tokens-spent',
      '3'
    )
  )
  for (const label of [
    'Generate Plan',
    'Save Plan',
    'Save Changes',
    'Edit',
    'Delete'
  ])
    expect(screen.queryByText(label)).toBeNull()
  expect(
    fetchMock.mock.calls.some(([url]) => String(url).includes('/snapshot'))
  ).toBe(false)
  expect(
    fetchMock.mock.calls.some(
      ([, init]) => init?.method && init.method !== 'GET'
    )
  ).toBe(false)
})
