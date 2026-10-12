import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import SavedCurrentQueueClient from '@/app/(dashboard)/boss-assignments/current/SavedCurrentQueueClient'

const props = {
  contextKey: 'synthetic-opaque-context',
  season: '101',
  seasons: ['102', '101'],
  canCalculate: false
}
const saved = {
  source: 'saved-local',
  season: '101',
  assignments: [
    {
      player_id: 'synthetic-private-id',
      display_name: 'Saved member',
      primary_boss: null,
      secondary_boss: null,
      token_allocations: { L1: 1 },
      uses_flexible_tokens: true,
      total_tokens_allocated: 1,
      assigned_at: '2026-06-02T08:00:00.000Z',
      updated_at: null
    }
  ],
  bosses: [
    {
      level: 'L1',
      boss_name: 'Riptide',
      sub_bosses: { sub1: '', sub2: '', sub1_skip: false, sub2_skip: false },
      selected_at: null
    }
  ],
  canReplace: false,
  canClear: false
}

afterEach(() => vi.unstubAllGlobals())

describe('saved current queue ordinary interface', () => {
  it('reads persisted intent for a member without calculating or mutating', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(saved))
    vi.stubGlobal('fetch', request)
    const { container } = render(<SavedCurrentQueueClient {...props} />)
    expect(
      await screen.findByRole('region', { name: 'Saved assignment intent' })
    ).toHaveTextContent('Saved member')
    expect(
      screen.getByRole('region', { name: 'Saved assignment intent' })
    ).toHaveTextContent('Riptide')
    expect(
      screen.queryByRole('button', { name: 'Calculate saved queue' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Replace|Clear/ })
    ).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe(
      '/api/guild-raid/saved-assignments?season_number=101'
    )
    expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
    expect(container.innerHTML).not.toContain('synthetic-private-id')
    expect(container.innerHTML).not.toContain(props.contextKey)
  })
})

const asOf = '2026-06-02T08:00:00.000Z'
type Projection = {
  bossName: string
  startingHp: number
  projectedRemainingHp: number
  projectedDamage: number
  tokensPlanned: number
  isPrime: boolean
}
const calculation = {
  source: 'saved-season',
  season: '101',
  configId: 'captured-synthetic',
  asOf,
  timeZone: 'UTC',
  rosterSource: 'current-saved-roster',
  players: [
    {
      playerId: 'synthetic-private-id',
      displayName: 'Saved member',
      tier: 'mid',
      currentTokens: 3,
      nextRegenAt: null,
      tokensUsedThisSeason: 1,
      spendableByEnd: 3,
      tokensPlanned: 3
    }
  ],
  stages: [
    {
      stageCode: 'L1',
      loopIndex: 0,
      projectedStartAt: asOf,
      inboundDurationSeconds: null,
      inboundDurationSource: null,
      conditionalOnPriorClear: false,
      assignments: [
        { playerId: 'synthetic-private-id', encounter: 'main', tokens: 3 }
      ],
      projections: {
        main: {
          bossName: 'Riptide',
          startingHp: 4999900,
          projectedRemainingHp: 4999600,
          projectedDamage: 300,
          tokensPlanned: 3,
          isPrime: false
        },
        prime1: null as Projection | null,
        prime2: null as Projection | null
      }
    }
  ],
  replacement: {
    asOf,
    bosses: [
      {
        level: 'L1',
        boss_name: 'Riptide',
        sub_bosses: { sub1: '', sub2: '', sub1_skip: false, sub2_skip: false }
      }
    ],
    assignments: [
      {
        player_id: 'synthetic-private-id',
        token_allocations: { L1: 3 } as Record<string, number>
      }
    ]
  },
  metrics: { totalTokensPlanned: 3, projectedStages: 1 },
  feasibility: {
    status: 'tokens-verified-at-projected-starts',
    stageStarts: 'historical-estimate',
    horizonEndExclusive: true,
    projectedPrefix: {
      fullyClearedStageCount: 0,
      firstUnclearedStage: { stageCode: 'L1', loopIndex: 0 } as {
        stageCode: string
        loopIndex: number
      } | null
    },
    unsolvedRemainder: [],
    sequenceLimitReached: false
  },
  warnings: [] as string[]
}

it('calculates explicitly, edits integer intent without stale projections, then replaces with authoritative saved state', async () => {
  const writable = { ...saved, canReplace: true, canClear: true }
  const committed = {
    ...writable,
    assignments: [
      {
        ...saved.assignments[0],
        token_allocations: { L1: 2 },
        total_tokens_allocated: 2
      }
    ],
    summary: { assignedCount: 1, totalPlayers: 1, totalTokens: 2 }
  }
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(Response.json(calculation))
    .mockResolvedValueOnce(Response.json(committed))
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  const input = screen.getByLabelText('As-of time (UTC)')
  expect(input).toHaveValue('')
  expect(
    screen.getByRole('button', { name: 'Calculate saved queue' })
  ).toBeDisabled()
  fireEvent.change(input, { target: { value: '2026-06-02T08:00:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Calculate saved queue' }))
  expect(
    await screen.findByRole('region', { name: 'Calculated queue preview' })
  ).toHaveTextContent('300')
  expect(request.mock.calls[1][1]).toMatchObject({
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify({ season_number: '101', asOf })
  })
  expect(request).toHaveBeenCalledTimes(2)
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Saved member L1 tokens' }),
    { target: { value: '2' } }
  )
  expect(screen.getByText('Uncalculated intent')).toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Calculated queue preview' })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Replace saved assignments and boss choices for this season'
    })
  )
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Omitted assignments and boss choices will be removed from season 101'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm replacement' }))
  expect(
    await screen.findByText('Saved intent reloaded after replacement.')
  ).toBeInTheDocument()
  expect(request.mock.calls[2][0]).toBe(
    '/api/guild-raid/saved-assignments?season_number=101'
  )
  expect(request.mock.calls[2][1]).toMatchObject({
    method: 'PUT',
    body: JSON.stringify({
      ...calculation.replacement,
      assignments: [
        { player_id: 'synthetic-private-id', token_allocations: { L1: 2 } }
      ]
    })
  })
  expect(
    screen.getByRole('region', { name: 'Saved assignment intent' })
  ).toHaveTextContent('L1: 2')
})

const writable = { ...saved, canReplace: true, canClear: true }
async function calculateReady() {
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Calculate saved queue' }))
  await screen.findByRole('region', { name: 'Calculated queue preview' })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it('requires a post-unknown authoritative reload across input changes and season round trips with no write retry', async () => {
  let ended = false
  let chunk = false
  const failed = new Response(
    new ReadableStream(
      {
        pull(controller) {
          if (!chunk) {
            chunk = true
            controller.enqueue(new TextEncoder().encode('RAW_WRITE_CANARY'))
          } else {
            ended = true
            controller.close()
          }
        }
      },
      { highWaterMark: 0 }
    ),
    { status: 503 }
  )
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(
      Response.json({ ...writable, season: '102', assignments: [], bosses: [] })
    )
    .mockResolvedValueOnce(Response.json(writable))
  vi.stubGlobal('fetch', request)
  const { rerender } = render(
    <SavedCurrentQueueClient {...props} canCalculate />
  )
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Clear saved assignments and boss choices for this season'
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'outcome unavailable; reload'
  )
  expect(ended).toBe(true)
  expect(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  ).toBeDisabled()
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  expect(
    screen.getByRole('button', { name: 'Calculate saved queue' })
  ).toBeDisabled()
  rerender(<SavedCurrentQueueClient {...props} canCalculate season="102" />)
  await screen.findByText('No saved assignments.')
  rerender(<SavedCurrentQueueClient {...props} canCalculate />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'outcome unavailable; reload'
  )
  expect(request).toHaveBeenCalledTimes(3)
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload current saved season' })
  )
  await screen.findByText('Saved member')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  ).toBeEnabled()
  expect(request).toHaveBeenCalledTimes(4)
  expect(
    request.mock.calls.filter(([, options]) => options?.method === 'DELETE')
  ).toHaveLength(1)
  expect(document.body).not.toHaveTextContent('RAW_WRITE_CANARY')
})

it('treats a success header with a malformed mutation receipt as unknown rather than a confirmed clear', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(
      Response.json({
        ...writable,
        assignments: [],
        bosses: [],
        deleted: { assignmentsDeleted: 'not-a-count', bossesDeleted: 1 }
      })
    )
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'outcome unavailable; reload'
  )
  expect(
    screen.queryByText('Saved intent reloaded after clearing.')
  ).not.toBeInTheDocument()
})

it('bounds a nonresponsive read and offers an explicit safe reload', async () => {
  vi.useFakeTimers()
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise(() => {}))
    )
    render(<SavedCurrentQueueClient {...props} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10001)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved assignment intent unavailable'
    )
    expect(
      screen.getByRole('button', { name: 'Reload current saved season' })
    ).toBeEnabled()
  } finally {
    vi.useRealTimers()
  }
})

it('rejects late read headers/body/finally across season changes without clearing the new pending read', async () => {
  let oldBody!: ReadableStreamDefaultController<Uint8Array>
  const oldResponse = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        oldBody = controller
      }
    })
  )
  const later = deferred<Response>()
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(oldResponse)
    .mockImplementationOnce(() => later.promise)
  vi.stubGlobal('fetch', request)
  const { rerender } = render(<SavedCurrentQueueClient {...props} />)
  await act(async () => {
    await Promise.resolve()
  })
  const signal = request.mock.calls[0][1]!.signal!
  rerender(<SavedCurrentQueueClient {...props} season="102" />)
  await act(async () => {
    expect(() =>
      oldBody.enqueue(new TextEncoder().encode(JSON.stringify(saved)))
    ).toThrow()
    await Promise.resolve()
  })
  expect(signal.aborted).toBe(true)
  expect(screen.queryByText('Saved member')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  await act(async () =>
    later.resolve(
      Response.json({
        ...saved,
        season: '102',
        assignments: [
          { ...saved.assignments[0], display_name: 'Other saved member' }
        ]
      })
    )
  )
  expect(await screen.findByText('Other saved member')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('cancels a calculation on explicit instant changes and ignores a late body/error', async () => {
  const later = deferred<Response>()
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockImplementationOnce(() => later.promise)
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Calculate saved queue' }))
  const signal = request.mock.calls[1][1]!.signal!
  expect(screen.getByLabelText('As-of time (UTC)')).toBeEnabled()
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T09:00:00' }
  })
  await act(async () => later.resolve(Response.json(calculation)))
  expect(signal.aborted).toBe(true)
  expect(
    screen.queryByRole('region', { name: 'Calculated queue preview' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Assignment intent draft' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('clears model details immediately when server calculation capability is revoked even if opaque context stays stable', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(Response.json(calculation))
  vi.stubGlobal('fetch', request)
  const { rerender } = render(
    <SavedCurrentQueueClient {...props} canCalculate />
  )
  await screen.findByText('Saved member')
  await calculateReady()
  rerender(<SavedCurrentQueueClient {...props} canCalculate={false} />)
  expect(
    screen.queryByRole('region', { name: 'Calculated queue preview' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: 'Assignment intent draft' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Calculate|Replace|Clear/ })
  ).not.toBeInTheDocument()
})

it.each([
  [
    'wrong source',
    (x: typeof calculation) => {
      x.source = 'live'
    }
  ],
  [
    'wrong season',
    (x: typeof calculation) => {
      x.season = '102'
    }
  ],
  [
    'wrong instant',
    (x: typeof calculation) => {
      x.asOf = '2026-06-02T09:00:00.000Z'
    }
  ],
  [
    'missing config',
    (x: typeof calculation) => {
      x.configId = ''
    }
  ],
  [
    'invalid timezone',
    (x: typeof calculation) => {
      x.timeZone = 'Not/A_Zone'
    }
  ],
  [
    'duplicate stable identity',
    (x: typeof calculation) => {
      x.players.push({ ...x.players[0] })
    }
  ],
  [
    'oversize identity',
    (x: typeof calculation) => {
      x.players[0].playerId = 'x'.repeat(257)
    }
  ],
  [
    'oversize name',
    (x: typeof calculation) => {
      x.players[0].displayName = 'x'.repeat(1025)
    }
  ],
  [
    'player cap',
    (x: typeof calculation) => {
      x.players = Array.from({ length: 31 }, (_, i) => ({
        ...x.players[0],
        playerId: `synthetic-${i}`
      }))
    }
  ],
  [
    'stage cap',
    (x: typeof calculation) => {
      x.stages = Array.from({ length: 51 }, (_, i) => ({
        ...x.stages[0],
        loopIndex: i
      }))
    }
  ],
  [
    'unscoped stage player',
    (x: typeof calculation) => {
      x.stages[0].assignments[0].playerId = 'foreign-private-id'
    }
  ],
  [
    'fractional allocation',
    (x: typeof calculation) => {
      x.stages[0].assignments[0].tokens = 1.5
    }
  ],
  [
    'duplicate stage allocation',
    (x: typeof calculation) => {
      x.stages[0].assignments = [
        { ...x.stages[0].assignments[0], tokens: 1 },
        { ...x.stages[0].assignments[0], tokens: 2 }
      ]
    }
  ],
  [
    'replacement sum mismatch',
    (x: typeof calculation) => {
      x.replacement.assignments[0].token_allocations.L1 = 2
    }
  ],
  [
    'overreported metrics',
    (x: typeof calculation) => {
      x.metrics.totalTokensPlanned = 4
    }
  ],
  [
    'unknown warning',
    (x: typeof calculation) => {
      x.warnings = ['RAW_DIAGNOSTIC_CANARY']
    }
  ],
  [
    'invalid feasibility',
    (x: typeof calculation) => {
      x.feasibility.projectedPrefix.fullyClearedStageCount = 2
    }
  ],
  [
    'duplicate boss choice',
    (x: typeof calculation) => {
      x.replacement.bosses.push({ ...x.replacement.bosses[0] })
    }
  ]
])(
  'fails closed for malformed calculated %s without retaining partial players or projections',
  async (_name, change) => {
    const invalid = structuredClone(calculation)
    change(invalid)
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(writable))
      .mockResolvedValueOnce(Response.json(invalid))
    vi.stubGlobal('fetch', request)
    render(<SavedCurrentQueueClient {...props} canCalculate />)
    await screen.findByText('Saved member')
    fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
      target: { value: '2026-06-02T08:00:00' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved queue' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved queue could not be calculated'
    )
    expect(
      screen.queryByRole('region', { name: 'Assignment intent draft' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Calculated queue preview' })
    ).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toMatch(
      /RAW_DIAGNOSTIC_CANARY|foreign-private-id|synthetic-private-id/
    )
    expect(request).toHaveBeenCalledTimes(2)
  }
)

it.each(['', '-1', '1.5', '29'])(
  'requires an explicit bounded whole token count before allowing intent replacement (%s)',
  async (value) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(writable))
        .mockResolvedValueOnce(Response.json(calculation))
    )
    render(<SavedCurrentQueueClient {...props} canCalculate />)
    await screen.findByText('Saved member')
    await calculateReady()
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Saved member L1 tokens' }),
      { target: { value } }
    )
    expect(
      screen.getByRole('button', { name: /Replace saved assignments/ })
    ).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter whole token counts'
    )
    expect(
      screen.queryByRole('region', { name: 'Calculated queue preview' })
    ).not.toBeInTheDocument()
  }
)

it('keeps duplicate and hostile names separate, offers neutral labels for ID-equivalent names and hides every private identifier', async () => {
  const names = [
    '<img src=x onerror=alert(1)>',
    'Same name',
    'Same name',
    '__proto__',
    ' synthetic-label-4 '
  ]
  const model = structuredClone(calculation)
  model.players = names.map((displayName, index) => ({
    ...calculation.players[0],
    playerId: `synthetic-label-${index}`,
    displayName,
    tokensPlanned: 0
  }))
  model.stages = []
  model.metrics = { totalTokensPlanned: 0, projectedStages: 0 }
  model.feasibility.projectedPrefix = {
    fullyClearedStageCount: 0,
    firstUnclearedStage: null
  }
  model.replacement.assignments = model.players.map((player) => ({
    player_id: player.playerId,
    token_allocations: { L1: 0 }
  }))
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(writable))
      .mockResolvedValueOnce(Response.json(model))
  )
  const { container } = render(
    <SavedCurrentQueueClient {...props} canCalculate />
  )
  await screen.findByText('Saved member')
  await calculateReady()
  expect(screen.getByText(names[0])).toBeInTheDocument()
  expect(
    screen.getAllByRole('spinbutton', { name: /Same name.*L1 tokens/ })
  ).toHaveLength(2)
  expect(
    screen.getByRole('spinbutton', { name: 'Same name (member 2) L1 tokens' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('spinbutton', { name: 'Same name (member 3) L1 tokens' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('spinbutton', { name: 'Member 5 L1 tokens' })
  ).toBeInTheDocument()
  expect(container.querySelector('img')).toBeNull()
  expect(container.innerHTML).not.toMatch(
    /synthetic-label-\d|synthetic-private-id|synthetic-opaque-context/
  )
})

it('shows budget/provenance and historical timing limitations without pretending aggregate saved intent retains loop schedule', async () => {
  const model = structuredClone(calculation)
  model.warnings = ['fallback-stage-duration', 'conditional-stage-progression']
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(writable))
      .mockResolvedValueOnce(Response.json(model))
  )
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  await calculateReady()
  expect(
    screen.getByRole('region', { name: 'Assignment intent draft' })
  ).toHaveTextContent('Spendable by season end: 3')
  expect(
    screen.getByRole('region', { name: 'Calculated queue preview' })
  ).toHaveTextContent('fallback stage duration')
  expect(
    screen.getByRole('region', { name: 'Assignment intent draft' })
  ).toHaveTextContent('Repeated-loop allocations are combined as saved intent')
})

it('offers integer edits for authorized unallocated players using only the fixed calculator target slots', async () => {
  const model = structuredClone(calculation)
  model.players.push({
    ...model.players[0],
    playerId: 'synthetic-unallocated',
    displayName: 'Unallocated member',
    tokensPlanned: 0
  })
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(Response.json(model))
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  await calculateReady()
  expect(
    screen.getByRole('spinbutton', { name: 'Unallocated member L1 tokens' })
  ).toHaveValue(0)
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Unallocated member L1 tokens' }),
    { target: { value: '1' } }
  )
  expect(screen.getByText('Uncalculated intent')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /Replace saved assignments/ })
  ).toBeEnabled()
  expect(document.body.innerHTML).not.toContain('synthetic-unallocated')
  expect(request).toHaveBeenCalledTimes(2)
})

it('does not release an unknown write through a failed reload or a read begun before the write', async () => {
  let oldBody!: ReadableStreamDefaultController<Uint8Array>
  const first = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        oldBody = controller
      }
    })
  )
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(Response.json({ ...writable, season: '102' }))
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(new Response('UNCONFIRMED', { status: 503 }))
    .mockResolvedValueOnce(new Response('READ_UNAVAILABLE', { status: 503 }))
  vi.stubGlobal('fetch', request)
  const { rerender } = render(
    <SavedCurrentQueueClient {...props} canCalculate />
  )
  await act(async () => {
    await Promise.resolve()
  })
  rerender(<SavedCurrentQueueClient {...props} canCalculate season="102" />)
  await screen.findByText('Saved member')
  rerender(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing' }))
  await screen.findByRole('alert')
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload current saved season' })
  )
  await screen.findByRole('alert')
  await act(async () => {
    expect(() =>
      oldBody.enqueue(new TextEncoder().encode(JSON.stringify(writable)))
    ).toThrow()
    await Promise.resolve()
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'outcome unavailable; reload'
  )
  expect(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  ).toBeDisabled()
  expect(request).toHaveBeenCalledTimes(5)
})

it('blocks overlapping same-season operations and fences a delayed clear body across A to B to A', async () => {
  let delayedBody!: ReadableStreamDefaultController<Uint8Array>
  const pendingClear = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        delayedBody = controller
      }
    })
  )
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(pendingClear)
    .mockResolvedValueOnce(
      Response.json({ ...writable, season: '102', assignments: [], bosses: [] })
    )
    .mockResolvedValueOnce(Response.json(writable))
  vi.stubGlobal('fetch', request)
  const { rerender } = render(
    <SavedCurrentQueueClient {...props} canCalculate />
  )
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing' }))
  expect(
    screen.getByRole('button', { name: 'Reload current saved season' })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  ).toBeDisabled()
  expect(screen.getByLabelText('As-of time (UTC)')).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload current saved season' })
  )
  expect(request).toHaveBeenCalledTimes(2)
  rerender(<SavedCurrentQueueClient {...props} canCalculate season="102" />)
  await screen.findByText('No saved assignments.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  rerender(<SavedCurrentQueueClient {...props} canCalculate />)
  expect(screen.getByRole('alert')).toHaveTextContent(
    'outcome unavailable; reload'
  )
  expect(request).toHaveBeenCalledTimes(3)
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload current saved season' })
  )
  await screen.findByText('Saved member')
  await act(async () => {
    expect(() =>
      delayedBody.enqueue(
        new TextEncoder().encode(
          JSON.stringify({
            ...writable,
            assignments: [],
            bosses: [],
            deleted: { assignmentsDeleted: 1, bossesDeleted: 1 }
          })
        )
      )
    ).toThrow()
  })
  expect(
    screen.getByRole('region', { name: 'Saved assignment intent' })
  ).toHaveTextContent('Saved member')
  expect(
    screen.queryByText('Saved intent reloaded after clearing.')
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('clears old caller data and fences a late rejected calculation without revealing raw error details', async () => {
  const pending = deferred<Response>()
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValueOnce(
      Response.json({ ...saved, assignments: [], bosses: [] })
    )
  vi.stubGlobal('fetch', request)
  const { rerender } = render(
    <SavedCurrentQueueClient {...props} canCalculate />
  )
  await screen.findByText('Saved member')
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Calculate saved queue' }))
  rerender(
    <SavedCurrentQueueClient
      {...props}
      contextKey="other-opaque-context"
      canCalculate={false}
    />
  )
  await screen.findByText('No saved assignments.')
  await act(async () => pending.reject(new Error('RAW_AUTH_TRANSPORT_CANARY')))
  expect(screen.queryByText('Saved member')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(document.body.innerHTML).not.toMatch(
    /RAW_AUTH_TRANSPORT_CANARY|other-opaque-context|synthetic-private-id/
  )
})

it('renders an authoritative concurrent saved snapshot after clear instead of optimistically claiming empty state', async () => {
  const next = {
    ...writable,
    assignments: [
      { ...saved.assignments[0], display_name: 'Concurrent writer intent' }
    ],
    canReplace: false,
    canClear: false,
    deleted: { assignmentsDeleted: 1, bossesDeleted: 1 }
  }
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(Response.json(next))
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing' }))
  expect(
    await screen.findByText('Concurrent writer intent')
  ).toBeInTheDocument()
  expect(
    screen.getByText('Saved intent reloaded after clearing.')
  ).toBeInTheDocument()
  expect(screen.queryByText('No saved assignments.')).not.toBeInTheDocument()
  expect(request.mock.calls[1][1]).toMatchObject({ method: 'DELETE' })
  expect(request.mock.calls[1][1]?.body).toBeUndefined()
  expect(
    screen.queryByRole('button', { name: /Clear saved assignments/ })
  ).not.toBeInTheDocument()
})

it.each([401, 422, 503])(
  'drains a %i calculation response to EOF while showing only a fixed safe error',
  async (status) => {
    let pulls = 0
    let ended = false
    const failure = new Response(
      new ReadableStream(
        {
          pull(controller) {
            if (pulls++ === 0)
              controller.enqueue(new Uint8Array([255, 254, 65]))
            else {
              ended = true
              controller.close()
            }
          }
        },
        { highWaterMark: 0 }
      ),
      { status }
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(writable))
        .mockResolvedValueOnce(failure)
    )
    render(<SavedCurrentQueueClient {...props} canCalculate />)
    await screen.findByText('Saved member')
    fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
      target: { value: '2026-06-02T08:00:00' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved queue' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved queue could not be calculated'
    )
    expect(ended).toBe(true)
    expect(
      screen.queryByRole('region', { name: 'Calculated queue preview' })
    ).not.toBeInTheDocument()
  }
)

it('fails safely when an error body cannot be read and when a success body exceeds the strict byte bound', async () => {
  const failed = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('RAW_BODY_CANARY'))
      }
    }),
    { status: 503 }
  )
  const tooLarge = new Response(' '.repeat(1024 * 1024 + 1))
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(failed)
    .mockResolvedValueOnce(tooLarge)
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Calculate saved queue' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Saved queue could not be calculated'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Calculate saved queue' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Saved queue could not be calculated'
  )
  expect(
    screen.queryByRole('region', { name: 'Assignment intent draft' })
  ).not.toBeInTheDocument()
  expect(document.body.innerHTML).not.toContain('RAW_BODY_CANARY')
})

it('clears displayed saved rows on an authentication refusal during authoritative reload', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(new Response('RAW_REFUSAL', { status: 403 }))
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', { name: 'Reload current saved season' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Saved assignment intent unavailable'
  )
  expect(screen.queryByText('Saved member')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Calculate saved queue' })
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: /Clear saved assignments/ })
  ).not.toBeInTheDocument()
  expect(document.body).not.toHaveTextContent('RAW_REFUSAL')
})

it('presents calculated prime damage and token slots alongside the main boss without losing their identity', async () => {
  const model = structuredClone(calculation)
  model.stages[0].assignments = [
    { playerId: 'synthetic-private-id', encounter: 'main', tokens: 2 },
    { playerId: 'synthetic-private-id', encounter: 'prime1', tokens: 1 }
  ]
  model.stages[0].projections.main = {
    ...model.stages[0].projections.main,
    tokensPlanned: 2,
    projectedDamage: 200,
    projectedRemainingHp: 4999700
  }
  model.stages[0].projections.prime1 = {
    bossName: 'Captured prime',
    startingHp: 500,
    projectedRemainingHp: 400,
    projectedDamage: 100,
    tokensPlanned: 1,
    isPrime: true
  }
  model.replacement.bosses[0].sub_bosses.sub1 = 'Captured prime'
  model.replacement.assignments[0].token_allocations = { L1: 2, L1_Sub1: 1 }
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(writable))
      .mockResolvedValueOnce(Response.json(model))
  )
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  await calculateReady()
  expect(
    screen.getByRole('region', { name: 'Calculated queue preview' })
  ).toHaveTextContent(
    'Captured prime: 100 projected damage; 400 projected HP remaining'
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Saved member L1_Sub1 tokens' })
  ).toHaveValue(1)
})

it('preserves the unknown-write barrier through ordinary controlled season buttons A to B to A', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(writable))
    .mockResolvedValueOnce(new Response('UNKNOWN', { status: 503 }))
    .mockResolvedValueOnce(
      Response.json({ ...writable, season: '102', assignments: [], bosses: [] })
    )
  vi.stubGlobal('fetch', request)
  render(<SavedCurrentQueueClient {...props} canCalculate />)
  await screen.findByText('Saved member')
  fireEvent.click(
    screen.getByRole('button', { name: /Clear saved assignments/ })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Confirm clearing' }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Saved season 102' }))
  await screen.findByText('No saved assignments.')
  fireEvent.click(screen.getByRole('button', { name: 'Saved season 101' }))
  expect(screen.getByRole('alert')).toHaveTextContent(
    'outcome unavailable; reload'
  )
  expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
  expect(request).toHaveBeenCalledTimes(3)
  expect(
    screen.getByRole('button', { name: 'Calculate saved queue' })
  ).toBeDisabled()
})

it.each([200, 503])(
  'explicitly cancels an owned stalled %i response body at the request deadline and ignores later delivery',
  async (status) => {
    vi.useFakeTimers()
    try {
      let canceled = false
      let body!: ReadableStreamDefaultController<Uint8Array>
      const stalled = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller
          },
          cancel() {
            canceled = true
          }
        }),
        { status }
      )
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => stalled)
      )
      render(<SavedCurrentQueueClient {...props} />)
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10001)
      })
      expect(canceled).toBe(true)
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Saved assignment intent unavailable'
      )
      expect(
        screen.getByRole('button', { name: 'Reload current saved season' })
      ).toBeEnabled()
      expect(() =>
        body.enqueue(new TextEncoder().encode(JSON.stringify(saved)))
      ).toThrow()
      expect(screen.queryByText('Saved member')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  }
)
