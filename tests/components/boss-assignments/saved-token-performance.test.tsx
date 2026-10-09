import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import SavedTokenPerformanceClient from '@/app/(dashboard)/boss-assignments/performance/SavedTokenPerformanceClient'
import type { SavedTokenPerformance } from '@/app/lib/boss-assignments/saved-token-performance-types'
import PerformancePage from '@/app/(dashboard)/boss-assignments/performance/page'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { getSavedTokenPerformancePageContext } from '@/app/lib/boss-assignments/saved-token-performance'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { Errors } from '@/app/lib/errors/AppError'

const hosted = vi.hoisted(() => vi.fn())
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: vi.fn(() => 'desktop')
}))
vi.mock('@/app/lib/boss-assignments/saved-token-performance', () => ({
  getSavedTokenPerformancePageContext: vi.fn()
}))
vi.mock('@/app/(dashboard)/boss-assignments/_lib/access', () => ({
  requireBossAssignmentsAccess: vi.fn()
}))
vi.mock('@/app/(dashboard)/boss-assignments/BossAssignments', () => ({
  BossAssignments: (value: unknown) => {
    hosted(value)
    return <p>Hosted performance</p>
  }
}))

const props = {
  contextKey: 'synthetic-caller-scope-canary',
  season: '101',
  seasons: ['102', '101'],
  canCalculate: true
}
const asOf = '2026-06-02T08:00:00.000Z'
function result(): SavedTokenPerformance {
  return {
    source: 'saved-local',
    season: '101',
    configId: 'captured-example',
    asOf,
    timeZone: 'Pacific/Auckland',
    cohort: 'own-guild',
    rarities: ['Legendary', 'Mythic'],
    encounters: 'main',
    currentSavedRoster: true,
    targets: 'current-saved',
    summary: { playerCount: 2, mean: 0, median: 0, pctAtOrAbove: 0 },
    players: [
      {
        rowKey: 'a'.repeat(64),
        name: '<script>synthetic label</script>',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 2,
        expectedTokens: 4,
        weightedScore: 0,
        tierCounts: { officer_target: 1 },
        bosses: [
          {
            bossKey: 'Riptide_L1',
            bossName: 'Riptide',
            rarity: 'Legendary',
            set: 1,
            encounterId: 0,
            score: 0,
            tier: 'officer_target',
            tokensSpent: 2,
            expectedTokens: 4,
            actualDamage: 0,
            expectedDamage: 2500000,
            perLoop: [
              { loopIndex: 0, score: 0, tokensSpent: 2, actualDamage: 0 }
            ]
          }
        ]
      },
      {
        rowKey: 'b'.repeat(64),
        name: 'Current saved member',
        bossCount: 1,
        scoredBossCount: 0,
        tokensSpent: 1,
        expectedTokens: 0,
        weightedScore: null,
        tierCounts: { insufficient: 1 },
        bosses: [
          {
            bossKey: 'Avatar_M1',
            bossName: 'Avatar',
            rarity: 'Mythic',
            set: 1,
            encounterId: 0,
            score: null,
            tier: 'insufficient',
            tokensSpent: 1,
            expectedTokens: null,
            actualDamage: 100,
            expectedDamage: null,
            perLoop: [
              { loopIndex: 1, score: null, tokensSpent: 1, actualDamage: 100 }
            ]
          }
        ]
      }
    ]
  }
}
function input(value = '2026-06-02T08:00:00') {
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value }
  })
}
function calculate() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Calculate saved performance' })
  )
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ordinary saved token performance', () => {
  it('aborts an in-progress prime body on scope change and fences its late error/finally', async () => {
    let canceled = 0
    let fail!: (error: Error) => void
    const pending = new ReadableStream<Uint8Array>({
      start(controller) {
        fail = (error) => controller.error(error)
      },
      cancel() {
        canceled++
      }
    })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(pending, {
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(Response.json(result()))
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main-and-primes' }
    })
    input()
    calculate()
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main' }
    })
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true)
    expect(canceled).toBe(1)
    expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
    input()
    calculate()
    await screen.findByRole('region', { name: 'Calculated saved performance' })
    await act(async () => {
      fail(new Error('Synthetic private late body failure'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Calculated saved performance' })
    ).toHaveTextContent('main bosses')
  })
  it.each(['wrong-scope', 'unexpected-id', 'unsupported-encounter'])(
    'refuses %s prime responses with a static error',
    async (kind) => {
      const body = result()
      if (kind !== 'wrong-scope') body.encounters = 'main-and-primes'
      if (kind === 'unexpected-id')
        Object.assign(body.players[0]!.bosses[0]!, {
          playerId: 'SYN-PRIVATE-ID'
        })
      if (kind === 'unsupported-encounter')
        Object.assign(body.players[0]!.bosses[0]!, { encounterId: 3 })
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
      const { container } = render(<SavedTokenPerformanceClient {...props} />)
      fireEvent.change(screen.getByLabelText('Boss encounters'), {
        target: { value: 'main-and-primes' }
      })
      input()
      calculate()
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Saved token performance unavailable'
      )
      expect(
        screen.queryByRole('region', { name: 'Calculated saved performance' })
      ).not.toBeInTheDocument()
      expect(container.innerHTML).not.toContain('SYN-PRIVATE-ID')
      expect(container.innerHTML).not.toContain(props.contextKey)
    }
  )
  it('preserves prime null denominators distinctly from zero and escapes hostile labels', async () => {
    const body = result()
    body.encounters = 'main-and-primes'
    body.players[0]!.bosses[0]!.encounterId = 1
    body.players[1]!.bosses[0]!.encounterId = 2
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)))
    const { container } = render(<SavedTokenPerformanceClient {...props} />)
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main-and-primes' }
    })
    input()
    calculate()
    const region = await screen.findByRole('region', {
      name: 'Calculated saved performance'
    })
    expect(region).toHaveTextContent('Prime 1')
    expect(region).toHaveTextContent('Prime 2')
    expect(region).toHaveTextContent('Not available')
    expect(region).toHaveTextContent('0.00×')
    expect(region).toHaveTextContent('<script>synthetic label</script>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('a'.repeat(64))
    expect(container.innerHTML).not.toContain(props.contextKey)
  })
  it('requires explicit prime opt-in and shows its encounter provenance', async () => {
    const prime = result()
    // The response oracle is synthetic; the route tests separately use canonical math.
    Object.assign(prime, { encounters: 'main-and-primes' })
    Object.assign(prime.players[0]!.bosses[0]!, { encounterId: 1 })
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(prime))
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    expect(screen.getByLabelText('Boss encounters')).toHaveValue('main')
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main-and-primes' }
    })
    expect(fetcher).not.toHaveBeenCalled()
    input()
    calculate()
    expect(
      await screen.findByRole('region', {
        name: 'Calculated saved performance'
      })
    ).toHaveTextContent('Prime 1')
    expect(
      new URL(
        String(fetcher.mock.calls[0]![0]),
        'https://synthetic.invalid'
      ).searchParams.get('encounters')
    ).toBe('main-and-primes')
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main' }
    })
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Calculate saved performance' })
    ).toBeDisabled()
  })
  it.each([
    ['2026-06-02T08:00', '2026-06-02T08:00:00.000Z'],
    ['2026-06-02T08:00:01', '2026-06-02T08:00:01.000Z'],
    ['2026-06-02T08:00:00.123', '2026-06-02T08:00:00.123Z']
  ])(
    'preserves explicit UTC input %s without browser-local conversion',
    async (entered, canonical) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ ...result(), asOf: canonical })
      )
      vi.stubGlobal('fetch', fetcher)
      render(<SavedTokenPerformanceClient {...props} />)
      input(entered)
      expect(screen.getByLabelText('As-of time (UTC)')).toBeValid()
      calculate()
      expect(
        await screen.findByRole('region', {
          name: 'Calculated saved performance'
        })
      ).toHaveTextContent(canonical)
      expect(
        new URL(
          String(fetcher.mock.calls[0][0]),
          'https://synthetic.invalid'
        ).searchParams.get('asOf')
      ).toBe(canonical)
    }
  )
  it('requires an explicit valid UTC instant and never fetches on mount or input changes', () => {
    const fetcher = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Calculate saved performance' })
    ).toBeDisabled()
    input()
    expect(
      screen.getByRole('button', { name: 'Calculate saved performance' })
    ).toBeEnabled()
    input('2026-02-30T08:00:00')
    expect(
      screen.getByRole('button', { name: 'Calculate saved performance' })
    ).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('calculates with exactly season and canonical UTC asOf, displays provenance and preserves null versus zero', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result()))
    vi.stubGlobal('fetch', fetcher)
    const { container } = render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    const region = await screen.findByRole('region', {
      name: 'Calculated saved performance'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(
      '/api/upcoming/token-performance?view=saved&season=101&asOf=2026-06-02T08%3A00%3A00.000Z'
    )
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      signal: expect.any(AbortSignal)
    })
    expect(region).toHaveTextContent(asOf)
    expect(region).toHaveTextContent('Pacific/Auckland')
    expect(region).toHaveTextContent('captured-example')
    expect(region).toHaveTextContent('current saved roster')
    expect(region).toHaveTextContent('current saved targets')
    expect(region).toHaveTextContent('Legendary and Mythic main bosses')
    const table = within(region).getByRole('table', {
      name: 'Saved player performance'
    })
    expect(
      within(table).getByRole('row', { name: /synthetic label/ })
    ).toHaveTextContent('0.00×')
    expect(
      within(table).getByRole('row', { name: /Current saved member/ })
    ).toHaveTextContent('Not available')
    expect(region).toHaveTextContent('Officer target')
    expect(region).toHaveTextContent('Insufficient history')
    expect(region).toHaveTextContent('Loop 0')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain(props.contextKey)
    expect(container.innerHTML).not.toContain('a'.repeat(64))
    expect(container.innerHTML).not.toContain('b'.repeat(64))
  })
  it('refreshes only on explicit action and clears prior results during a failed refresh without exposing error text', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(result()))
      .mockResolvedValueOnce(
        Response.json({ secret: 'PRIVATE_ERROR_CANARY' }, { status: 503 })
      )
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await screen.findByRole('region', { name: 'Calculated saved performance' })
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh saved performance' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved token performance unavailable'
    )
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('PRIVATE_ERROR_CANARY')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('fences pending headers, errors and finally when the selected season changes', async () => {
    const old = deferred<Response>()
    const fresh = deferred<Response>()
    const fetcher = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    const oldSignal = fetcher.mock.calls[0][1]?.signal
    fireEvent.change(screen.getByLabelText('Saved season'), {
      target: { value: '102' }
    })
    expect(oldSignal?.aborted).toBe(true)
    expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
    input('2026-06-16T08:00:00')
    calculate()
    await act(async () => old.reject(new Error('PRIVATE_LATE_ERROR_CANARY')))
    expect(
      screen.getByRole('button', { name: 'Calculating saved performance…' })
    ).toBeDisabled()
    expect(screen.queryByRole('alert')).toBeNull()
    const next = {
      ...result(),
      season: '102',
      asOf: '2026-06-16T08:00:00.000Z'
    }
    await act(async () => fresh.resolve(Response.json(next)))
    expect(
      await screen.findByRole('region', {
        name: 'Calculated saved performance'
      })
    ).toHaveTextContent(next.asOf)
    expect(document.body).not.toHaveTextContent('PRIVATE_LATE_ERROR_CANARY')
  })
  it('clears completed rows synchronously on as-of edits, scope changes and server season changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(result()))
    )
    const { rerender } = render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await screen.findByRole('region', { name: 'Calculated saved performance' })
    input('2026-06-02T09:00:00')
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).toBeNull()
    rerender(
      <SavedTokenPerformanceClient {...props} contextKey="changed-caller" />
    )
    expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
    rerender(<SavedTokenPerformanceClient {...props} season="102" />)
    expect(screen.getByLabelText('Saved season')).toHaveValue('102')
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).toBeNull()
  })
  it('aborts and disposes a late header response after caller-scope replacement without exposing old rows', async () => {
    const pending = deferred<Response>()
    const cancel = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise)
    vi.stubGlobal('fetch', fetcher)
    const { rerender } = render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    rerender(
      <SavedTokenPerformanceClient {...props} contextKey="new-signed-caller" />
    )
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
    await act(async () =>
      pending.resolve(
        new Response(new ReadableStream({ cancel }), {
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    expect(cancel).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('cancels an in-progress body on input edit and ignores late completion and finally', async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
        },
        cancel
      }),
      { headers: { 'content-type': 'application/json' } }
    )
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(Response.json(result()))
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await act(async () => {})
    input('2026-06-02T09:00:00')
    expect(cancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
    input()
    calculate()
    expect(
      await screen.findByRole('region', {
        name: 'Calculated saved performance'
      })
    ).toHaveTextContent(asOf)
  })
  it.each(['headers', 'body'] as const)(
    'enforces one 7-second deadline including stalled %s, without automatic retry',
    async (phase) => {
      vi.useFakeTimers()
      const cancel = vi.fn()
      const fetcher = vi.fn<typeof fetch>(() =>
        phase === 'headers'
          ? new Promise(() => {})
          : Promise.resolve(
              new Response(new ReadableStream({ cancel }), {
                headers: { 'content-type': 'application/json' }
              })
            )
      )
      vi.stubGlobal('fetch', fetcher)
      render(<SavedTokenPerformanceClient {...props} />)
      input()
      calculate()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6999)
      })
      expect(screen.queryByRole('alert')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Saved token performance unavailable'
      )
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(fetcher).toHaveBeenCalledOnce()
      expect(
        screen.getByRole('button', { name: 'Calculate saved performance' })
      ).toBeEnabled()
      if (phase === 'body') expect(cancel).toHaveBeenCalledOnce()
    }
  )
  it.each([401, 403, 422, 503])(
    'drains HTTP %s without decoding or showing the error body',
    async (status) => {
      let pulled = 0
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++
          controller.enqueue(new TextEncoder().encode('PRIVATE_ERROR_BODY'))
          controller.close()
        }
      })
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => new Response(body, { status }))
      )
      const { container } = render(<SavedTokenPerformanceClient {...props} />)
      input()
      calculate()
      await screen.findByRole('alert')
      expect(pulled).toBe(1)
      expect(container.innerHTML).not.toContain('PRIVATE_ERROR_BODY')
      expect(
        screen.queryByRole('region', { name: 'Calculated saved performance' })
      ).toBeNull()
    }
  )
  it.each(['bytes', 'chunks', 'utf8', 'content-type', 'empty'] as const)(
    'refuses malformed or excessive %s responses',
    async (kind) => {
      const cancel = vi.fn()
      let chunks = 0
      const response =
        kind === 'empty'
          ? new Response(null)
          : kind === 'content-type'
            ? new Response(JSON.stringify(result()))
            : kind === 'utf8'
              ? new Response(new Uint8Array([0xff]), {
                  headers: { 'content-type': 'application/json' }
                })
              : new Response(
                  new ReadableStream({
                    pull(controller) {
                      if (kind === 'bytes')
                        controller.enqueue(new Uint8Array(1024 * 1024 + 1))
                      else {
                        chunks++
                        controller.enqueue(new Uint8Array())
                      }
                    },
                    cancel
                  }),
                  { headers: { 'content-type': 'application/json' } }
                )
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => response)
      )
      render(<SavedTokenPerformanceClient {...props} />)
      input()
      calculate()
      await screen.findByRole('alert')
      expect(
        screen.queryByRole('region', { name: 'Calculated saved performance' })
      ).toBeNull()
      if (kind === 'bytes' || kind === 'chunks')
        expect(cancel).toHaveBeenCalledOnce()
      if (kind === 'chunks') expect(chunks).toBeLessThanOrEqual(4097)
    }
  )
  it('shows empty observations without inventing scores, players or live activity', async () => {
    const body = {
      ...result(),
      players: [],
      summary: { playerCount: 0, mean: null, median: null, pctAtOrAbove: null }
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(body))
    )
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    expect(
      await screen.findByText(
        'No saved main-boss battles match this season and as-of time.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })
  it('removes prior details and all calculate controls on authority downgrade', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(result()))
    )
    const { rerender } = render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await screen.findByRole('region', { name: 'Calculated saved performance' })
    rerender(<SavedTokenPerformanceClient {...props} canCalculate={false} />)
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('presents supplied token-weighted scores without recalculating from boss ratios, and keeps equal current labels separate', async () => {
    const body = result()
    body.players[0]!.name = 'Equal label'
    body.players[1]!.name = 'Equal label'
    body.players[0]!.weightedScore = 1.234567
    body.summary.mean = 1.234567
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(body))
    )
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    const region = await screen.findByRole('region', {
      name: 'Calculated saved performance'
    })
    const table = within(region).getByRole('table', {
      name: 'Saved player performance'
    })
    const rows = within(table).getAllByRole('row', { name: /Equal label/ })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('1.23×')
    expect(rows[1]).toHaveTextContent('Not available')
    expect(region).toHaveTextContent(
      'Loop details include only attacks with a recorded loop index'
    )
  })
  it('refuses nonfinite JSON numbers rather than treating them as unavailable metrics', async () => {
    const body = JSON.stringify(result()).replace(
      '"weightedScore":0',
      '"weightedScore":1e999'
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' }
          })
      )
    )
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await screen.findByRole('alert')
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).toBeNull()
  })
  it('bounds total loop presentation work across players before rendering any partial results', async () => {
    const body = result()
    for (const player of body.players)
      player.bosses[0]!.perLoop = Array.from(
        { length: 5001 },
        (_, loopIndex) => ({
          loopIndex,
          score: null,
          tokensSpent: 0,
          actualDamage: 0
        })
      )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(body))
    )
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await screen.findByRole('alert')
    expect(screen.queryByRole('table')).toBeNull()
  })
})

const malformed: [string, (body: SavedTokenPerformance) => unknown][] = [
  ['unknown root fields', (b) => ({ ...b, playerId: 'PRIVATE_ID_CANARY' })],
  ['wrong season', (b) => ({ ...b, season: '102' })],
  ['wrong as-of', (b) => ({ ...b, asOf: '2026-06-02T09:00:00.000Z' })],
  ['foreign cohort', (b) => ({ ...b, cohort: 'cluster' })],
  ['unsupported encounter', (b) => ({ ...b, encounters: 'primes' })],
  ['historical roster claim', (b) => ({ ...b, currentSavedRoster: false })],
  ['invalid time zone', (b) => ({ ...b, timeZone: 'Invalid/Zone' })],
  ['wrong rarities', (b) => ({ ...b, rarities: ['Legendary'] })],
  [
    'array boss rarity',
    (b) => {
      Object.assign(b.players[0]!.bosses[0]!, { rarity: ['Legendary'] })
      return b
    }
  ],
  [
    'duplicate opaque keys',
    (b) => {
      b.players[1]!.rowKey = b.players[0]!.rowKey
      return b
    }
  ],
  [
    'excessive roster',
    (b) => ({ ...b, players: Array.from({ length: 31 }, () => b.players[0]) })
  ],
  [
    'unknown player field',
    (b) => {
      Object.assign(b.players[0]!, { playerId: 'PRIVATE_ID_CANARY' })
      return b
    }
  ],
  [
    'nonopaque row key',
    (b) => {
      b.players[0]!.rowKey = 'PRIVATE_ID_CANARY'
      return b
    }
  ],
  [
    'excessive bosses',
    (b) => {
      b.players[0]!.bosses = Array.from(
        { length: 11 },
        () => b.players[0]!.bosses[0]!
      )
      return b
    }
  ],
  [
    'duplicate bosses',
    (b) => {
      b.players[0]!.bosses.push(b.players[0]!.bosses[0]!)
      return b
    }
  ],
  [
    'unsupported tier',
    (b) => {
      b.players[0]!.bosses[0]!.tier = 'rarity_set_global'
      return b
    }
  ],
  [
    'invalid set',
    (b) => {
      b.players[0]!.bosses[0]!.set = 0
      return b
    }
  ],
  [
    'duplicate loop',
    (b) => {
      b.players[0]!.bosses[0]!.perLoop.push(
        b.players[0]!.bosses[0]!.perLoop[0]!
      )
      return b
    }
  ],
  [
    'fractional token count',
    (b) => {
      b.players[0]!.tokensSpent = 1.5
      return b
    }
  ],
  [
    'wrong summary count',
    (b) => ({ ...b, summary: { ...b.summary, playerCount: 3 } })
  ],
  [
    'invalid percent',
    (b) => ({ ...b, summary: { ...b.summary, pctAtOrAbove: 101 } })
  ]
]
it.each(malformed)(
  'refuses %s without partial rows or response data disclosure',
  async (_name, change) => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json(change(result())))
    )
    const { container } = render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    await screen.findByRole('alert')
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).toBeNull()
    expect(container.innerHTML).not.toContain('PRIVATE_ID_CANARY')
    expect(container.innerHTML).not.toContain('captured-example')
  }
)

describe('desktop page admission and hosted continuity', () => {
  beforeEach(() => {
    vi.mocked(getRuntimeProfile).mockReturnValue('desktop')
    vi.mocked(getSavedTokenPerformancePageContext).mockResolvedValue({
      source: 'saved-local',
      season: '101',
      seasons: props.seasons,
      canCalculate: true,
      contextKey: props.contextKey
    })
  })
  it('mounts the ordinary saved UI using only signed page context without starting calculation', async () => {
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const { container } = render(
      await PerformancePage({
        searchParams: Promise.resolve({ season: '101' })
      })
    )
    expect(getSavedTokenPerformancePageContext).toHaveBeenCalledWith({
      selectedSeason: '101'
    })
    expect(screen.getByLabelText('Saved season')).toHaveValue('101')
    expect(request).not.toHaveBeenCalled()
    expect(requireBossAssignmentsAccess).not.toHaveBeenCalled()
    expect(container.innerHTML).not.toContain(props.contextKey)
  })
  it('refuses duplicate season before server context and never uses a client current-season fallback', async () => {
    render(
      await PerformancePage({
        searchParams: Promise.resolve({ season: ['101', '102'] })
      })
    )
    expect(screen.getByText('Saved season unavailable')).toBeInTheDocument()
    expect(getSavedTokenPerformancePageContext).not.toHaveBeenCalled()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it.each([400, 422])(
    'renders selected-season unavailability for %s without raw exception text',
    async (status) => {
      vi.mocked(getSavedTokenPerformancePageContext).mockRejectedValue(
        status === 400
          ? Errors.validation('PRIVATE_PAGE_CANARY')
          : Errors.unprocessable('PRIVATE_PAGE_CANARY')
      )
      render(
        await PerformancePage({
          searchParams: Promise.resolve({ season: '9999' })
        })
      )
      expect(screen.getByText('Saved season unavailable')).toBeInTheDocument()
      expect(document.body).not.toHaveTextContent('PRIVATE_PAGE_CANARY')
    }
  )
  it('preserves denied authority instead of disguising it as unavailable data', async () => {
    vi.mocked(getSavedTokenPerformancePageContext).mockRejectedValue(
      Errors.forbidden('Saved access refused')
    )
    await expect(
      PerformancePage({ searchParams: Promise.resolve({}) })
    ).rejects.toMatchObject({ statusCode: 403 })
  })
  it('shows import guidance for no imported captured season', async () => {
    vi.mocked(getSavedTokenPerformancePageContext).mockResolvedValue({
      source: 'saved-local',
      season: null,
      seasons: [],
      canCalculate: true,
      contextKey: props.contextKey
    })
    render(await PerformancePage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Import saved raid history')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('retains hosted access, profile, mode, permissions and season without saved reads', async () => {
    vi.mocked(getRuntimeProfile).mockReturnValue('hosted')
    vi.mocked(requireBossAssignmentsAccess).mockResolvedValue({
      profile: { guild_code: 'SYNTHETIC' },
      canEdit: false
    } as Awaited<ReturnType<typeof requireBossAssignmentsAccess>>)
    render(
      await PerformancePage({
        searchParams: Promise.resolve({ season: '9999' })
      })
    )
    expect(requireBossAssignmentsAccess).toHaveBeenCalledOnce()
    expect(hosted).toHaveBeenCalledWith({
      profile: { guild_code: 'SYNTHETIC' },
      mode: 'performance',
      canEdit: false,
      seasonOverride: '9999'
    })
    expect(getSavedTokenPerformancePageContext).not.toHaveBeenCalled()
  })
})

describe('independent prime UI scope boundary', () => {
  it('rejects a prime encounter hidden inside a main-labelled response', async () => {
    const body = result()
    body.players[0]!.bosses[0]!.encounterId = 1
    const fetcher = vi.fn().mockResolvedValue(Response.json(body))
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    input()
    calculate()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved token performance unavailable'
    )
    expect(
      screen.queryByRole('region', { name: 'Calculated saved performance' })
    ).not.toBeInTheDocument()
    expect(
      new URL(
        String(fetcher.mock.calls[0]![0]),
        'https://synthetic.invalid'
      ).searchParams.has('encounters')
    ).toBe(false)
  })
  it('fences prime late headers after an explicit main scope reset', async () => {
    const first = deferred<Response>()
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Response.json(result()))
    vi.stubGlobal('fetch', fetcher)
    render(<SavedTokenPerformanceClient {...props} />)
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main-and-primes' }
    })
    input()
    calculate()
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main' }
    })
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true)
    input()
    calculate()
    await screen.findByRole('region', { name: 'Calculated saved performance' })
    const late = result()
    late.encounters = 'main-and-primes'
    late.players[0]!.bosses[0]!.encounterId = 1
    await act(async () => {
      first.resolve(Response.json(late))
      await Promise.resolve()
    })
    expect(
      screen.getByRole('region', { name: 'Calculated saved performance' })
    ).toHaveTextContent('main bosses')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('resets opt-in on caller replacement without an automatic fetch', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const view = render(<SavedTokenPerformanceClient {...props} />)
    fireEvent.change(screen.getByLabelText('Boss encounters'), {
      target: { value: 'main-and-primes' }
    })
    input()
    view.rerender(
      <SavedTokenPerformanceClient
        {...props}
        contextKey="synthetic-next-caller"
      />
    )
    expect(screen.getByLabelText('Boss encounters')).toHaveValue('main')
    expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
