import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import {
  act,
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
vi.mock(
  '@/app/(dashboard)/boss-assignments/season-planner/planner-format',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resolveBrowserTimeZone: () => 'UTC'
  })
)

const oldId = '11111111-1111-4111-8111-111111111111'
const newId = '22222222-2222-4222-8222-222222222222'
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
const snapshotFor = (season: string) => ({
  snapshotAt: '2026-07-12T00:00:00Z',
  guildCode: 'TEST',
  season,
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
})
const savedFor = (season: string) => {
  const snapshot = snapshotFor(season)
  const spent = season === '140' ? 3 : 2
  return {
    id: season === '140' ? oldId : newId,
    season_id: 'config-test',
    start_at: '2026-07-01T00:00:00Z',
    end_at: '2026-07-14T00:00:00Z',
    snapshot_at: snapshot.snapshotAt,
    kind: 'replan',
    trigger: season === '140' ? 'Old saved plan' : 'New saved plan',
    created_at: snapshot.snapshotAt,
    updated_at: snapshot.snapshotAt,
    plan: {
      season,
      season_id: 'config-test',
      season_start_at: '2026-07-01T00:00:00Z',
      season_end_at: '2026-07-14T00:00:00Z',
      snapshot_at: snapshot.snapshotAt,
      time_zone: season === '140' ? 'Asia/Tokyo' : 'Europe/London',
      lookback_days: 30,
      sessions_per_day: 1,
      snapshot,
      plan: {
        sessions: [
          {
            at: '2026-07-12T01:00:00Z',
            playerId: 'synthetic-player',
            playerDisplayName: 'Synthetic Player',
            tokensAvailable: spent,
            tokensSpent: spent,
            tokensHeld: 0,
            actions: Array.from({ length: spent }, () => ({
              type: 'token_attack',
              at: '2026-07-12T01:00:00Z',
              playerId: 'synthetic-player',
              stageCode: 'L1',
              loopIndex: 0,
              encounterId: 0,
              bossName: 'Boss',
              expectedDamage: 100,
              appliedDamage: 100,
              overkillDamage: 0
            }))
          }
        ],
        finalRaidState: {
          stageCode: 'L1',
          loopIndex: 0,
          encounters: {
            0: {
              ...encounter,
              remainingHp: encounter.remainingHp - spent * 100
            },
            1: { ...snapshot.encounters.prime1 },
            2: { ...snapshot.encounters.prime2 }
          }
        },
        metrics: {
          tokensSpent: spent,
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
  }
}
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let fetchMock: Mock<(input: string, init?: RequestInit) => Promise<Response>>
beforeEach(() => {
  fetchMock = vi.fn(async (input: string) => {
    const url = new URL(String(input), 'http://localhost')
    const season = url.searchParams.get('season') || '140'
    if (url.pathname.endsWith('/snapshot'))
      return jsonResponse({ snapshot: snapshotFor(season), roster: [] })
    if (url.searchParams.has('id'))
      return jsonResponse({
        plan: savedFor(url.searchParams.get('id') === oldId ? '140' : '141')
      })
    return jsonResponse({ plans: [savedFor(season)] })
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const props = {
  initialSeason: '140',
  initialConfigId: 'config-test',
  savedSeasons: ['140', '141'],
  currentSeasonIndex: 0,
  allSeasons: [{ id: 'config-test', index: 1, canonicals: [] }],
  // Consecutive seasons can share a boss configuration; season is still part of context.
  seasonConfigResolutions: [
    { seasonNumber: 140, configId: 'config-test' },
    { seasonNumber: 141, configId: 'config-test' }
  ]
}

it.each([
  { desktopMode: true, canEdit: false, role: 'desktop member' },
  { desktopMode: true, canEdit: true, role: 'desktop officer' },
  { desktopMode: false, canEdit: true, role: 'hosted officer' }
])(
  'ordinary Load restores saved time zone and session times for $role',
  async (mode) => {
    render(<SeasonPlannerClient {...props} {...mode} />)
    const saved = screen.getByLabelText('Saved season plans')
    fireEvent.click(await within(saved).findByRole('button', { name: 'Load' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Time zone')).toHaveValue('Asia/Tokyo')
    )
    expect(
      within(screen.getByLabelText('Season plan results')).getAllByText(
        '07/12/2026, 10:00'
      ).length
    ).toBeGreaterThan(0)
  }
)

it.each([false, true])(
  'removes old season actions immediately while the next list is pending (canEdit=%s)',
  async (canEdit) => {
    const nextList = deferredResponse()
    const ordinaryFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((input: string, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (
        url.pathname === '/api/guild-raid/season-plan' &&
        !url.searchParams.has('id') &&
        url.searchParams.get('season') === '141'
      )
        return nextList.promise.then((response) => response.clone())
      return ordinaryFetch(input, init)
    })
    render(<SeasonPlannerClient {...props} desktopMode canEdit={canEdit} />)
    const saved = screen.getByLabelText('Saved season plans')
    fireEvent.click(await within(saved).findByRole('button', { name: 'Load' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Season plan results')).toHaveAttribute(
        'data-tokens-spent',
        '3'
      )
    )
    fireEvent.change(screen.getByLabelText('Saved season'), {
      target: { value: '141' }
    })
    expect(screen.getByLabelText('Saved season')).toHaveValue('141')
    expect(within(saved).queryByText('Old saved plan')).toBeNull()
    for (const name of ['Load', 'Loaded', 'Edit', 'Delete'])
      expect(within(saved).queryByRole('button', { name })).toBeNull()
    expect(screen.getByLabelText('Season plan results')).not.toHaveAttribute(
      'data-tokens-spent'
    )
    await act(async () => {
      nextList.resolve(jsonResponse({ plans: [savedFor('141')] }))
    })
    fireEvent.click(await within(saved).findByRole('button', { name: 'Load' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Season plan results')).toHaveAttribute(
        'data-tokens-spent',
        '2'
      )
    )
  }
)

it('does not refresh the old season when a pending save finishes after switching seasons', async () => {
  const save = deferredResponse()
  const ordinaryFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input: string, init?: RequestInit) =>
    String(input).endsWith('/save') ? save.promise : ordinaryFetch(input, init)
  )
  render(<SeasonPlannerClient {...props} desktopMode canEdit />)
  const saved = screen.getByLabelText('Saved season plans')
  fireEvent.click(await within(saved).findByRole('button', { name: 'Edit' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save Changes' })
    ).not.toBeDisabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/save'))
    ).toBe(true)
  )
  fireEvent.change(screen.getByLabelText('Saved season'), {
    target: { value: '141' }
  })
  expect(await within(saved).findByText('New saved plan')).toBeTruthy()
  const oldListRequests = () =>
    fetchMock.mock.calls.filter(([input]) => {
      const url = new URL(String(input), 'http://localhost')
      return (
        url.pathname === '/api/guild-raid/season-plan' &&
        url.searchParams.get('season') === '140'
      )
    }).length
  const beforeCompletion = oldListRequests()
  await act(async () => {
    save.resolve(jsonResponse({ success: true, id: oldId }))
  })
  expect(oldListRequests()).toBe(beforeCompletion)
  expect(within(saved).getByText('New saved plan')).toBeTruthy()
  expect(within(saved).queryByText('Old saved plan')).toBeNull()
  expect(screen.queryByText(`Saved plan ${oldId}`)).toBeNull()
})

it('keeps the current season deletion pending when an old season deletion is refused', async () => {
  const oldDelete = deferredResponse()
  const newDelete = deferredResponse()
  const ordinaryFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    if (init?.method === 'DELETE')
      return String(input).includes(oldId)
        ? oldDelete.promise
        : newDelete.promise
    return ordinaryFetch(input, init)
  })
  render(<SeasonPlannerClient {...props} desktopMode canEdit />)
  const saved = screen.getByLabelText('Saved season plans')
  fireEvent.click(await within(saved).findByRole('button', { name: 'Delete' }))
  fireEvent.change(screen.getByLabelText('Saved season'), {
    target: { value: '141' }
  })
  await within(saved).findByText('New saved plan')
  fireEvent.click(within(saved).getByRole('button', { name: 'Delete' }))
  expect(
    within(saved).getByRole('button', { name: 'Deleting…' })
  ).toBeDisabled()
  await act(async () => {
    oldDelete.resolve(
      jsonResponse({ error: 'Old season deletion refused' }, 403)
    )
  })
  expect(within(saved).queryByText('Old season deletion refused')).toBeNull()
  expect(
    within(saved).getByRole('button', { name: 'Deleting…' })
  ).toBeDisabled()
  expect(within(saved).getByText('New saved plan')).toBeTruthy()
  await act(async () => {
    newDelete.resolve(jsonResponse({ success: true, id: newId }))
  })
  expect(within(saved).queryByText('New saved plan')).toBeNull()
})

it('does not replace the new season output or time zone with a late old plan Load', async () => {
  const oldLoad = deferredResponse()
  const ordinaryFetch = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.searchParams.get('id') === oldId) return oldLoad.promise
    return ordinaryFetch(input, init)
  })
  render(<SeasonPlannerClient {...props} desktopMode canEdit={false} />)
  const saved = screen.getByLabelText('Saved season plans')
  fireEvent.click(await within(saved).findByRole('button', { name: 'Load' }))
  expect(
    within(saved).getByRole('button', { name: 'Loading...' })
  ).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Saved season'), {
    target: { value: '141' }
  })
  fireEvent.click(await within(saved).findByRole('button', { name: 'Load' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Season plan results')).toHaveAttribute(
      'data-tokens-spent',
      '2'
    )
  )
  await act(async () => {
    oldLoad.resolve(jsonResponse({ plan: savedFor('140') }))
  })
  expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/London')
  expect(screen.getByLabelText('Season plan results')).toHaveAttribute(
    'data-tokens-spent',
    '2'
  )
  expect(within(saved).getByText('New saved plan')).toBeTruthy()
  expect(
    within(saved).getByRole('button', { name: 'Loaded' })
  ).not.toBeDisabled()
})
