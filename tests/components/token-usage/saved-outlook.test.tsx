import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SavedSeasonOutlookCard } from '@/app/components/token-usage/SavedSeasonOutlookCard'
import TokenUsage from '@/app/components/TokenUsage'

const asOf = '2026-06-02T08:00:00.000Z'
const ready = {
  projection: {
    guildCode: 'SYN001',
    season: 101,
    generatedAt: asOf,
    secondsRemaining: 7200,
    memberCount: 1,
    seasonMaxTokensPerPlayer: 28,
    seasonBudget: 28,
    tokensUsed: 1,
    tokensRemaining: 3,
    projectedWaste: 0,
    playersAtCapRisk: 0,
    projectedForwardSpend: 3,
    finish: null,
    confidence: 'low'
  },
  players: [
    {
      playerId: 'synthetic-private-player',
      displayName: 'Private member',
      tokensUsed: 1,
      tokensRemaining: 3,
      projectedWaste: 0,
      atCapRisk: false
    }
  ],
  model: { appliedDamage: 300 },
  saved: {
    status: 'ready',
    source: 'saved-season',
    season: '101',
    configId: 'synthetic-config',
    asOf,
    timeZone: 'Pacific/Auckland'
  }
}

function enterTime() {
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('saved season outlook interface', () => {
  it('calculates explicit UTC saved inputs and presents literal model metrics and authorized player detail', async () => {
    vi.stubEnv('TZ', 'Pacific/Honolulu')
    const request = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(ready))
    )
    vi.stubGlobal('fetch', request)
    render(
      <SavedSeasonOutlookCard
        guildCode="SYN001"
        season="101"
        contextKey="officer-session"
      />
    )
    expect(request).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    ).toBeDisabled()
    enterTime()
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    const result = await screen.findByRole('region', {
      name: 'Saved outlook calculation'
    })
    expect(
      within(result).getByText('3', { selector: 'dd' })
    ).toBeInTheDocument()
    expect(within(result).getByText('300')).toBeInTheDocument()
    expect(result).toHaveTextContent('Projected forward tokens')
    expect(result).toHaveTextContent('Applied damage')
    expect(result).toHaveTextContent('low confidence')
    expect(result).toHaveTextContent('Captured configuration: synthetic-config')
    expect(result).toHaveTextContent('As of 2026-06-02T08:00:00.000Z')
    expect(result).toHaveTextContent('Guild time zone: Pacific/Auckland')
    expect(result).toHaveTextContent(
      'Saved raid history and captured season configuration'
    )
    expect(result).toHaveTextContent('Uses the current saved roster.')
    expect(
      screen.getByRole('row', { name: /Private member/ })
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('synthetic-private-player')
    expect(document.body).not.toHaveTextContent('officer-session')
    const [url, options] = request.mock.calls[0] as unknown as [
      string,
      RequestInit
    ]
    expect(url).toBe(
      '/api/season-forecast/outlook?guildCode=SYN001&season=101&asOf=2026-06-02T08%3A00%3A00.000Z'
    )
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.cache).toBe('no-store')
  })

  it('refreshes the same explicit instant and reports a safe error without displaying service details', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(ready)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'RAW_SERVICE_CANARY' }), {
          status: 503
        })
      )
    vi.stubGlobal('fetch', request)
    render(
      <SavedSeasonOutlookCard
        guildCode="SYN001"
        season="101"
        contextKey="officer-session"
      />
    )
    enterTime()
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    await screen.findByRole('region', { name: 'Saved outlook calculation' })
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh saved outlook' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved outlook could not be calculated. Cached token usage is unchanged.'
    )
    expect(
      screen.queryByRole('region', { name: 'Saved outlook calculation' })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('RAW_SERVICE_CANARY')
    expect(request.mock.calls[1][0]).toBe(request.mock.calls[0][0])
  })

  it.each([
    { guildCode: 'SYN002', season: '101', contextKey: 'officer-session' },
    { guildCode: 'SYN001', season: '102', contextKey: 'officer-session' },
    { guildCode: 'SYN001', season: '101', contextKey: 'member-session' }
  ])(
    'clears old state and ignores late work after context changes to $guildCode/$season/$contextKey',
    async (next) => {
      let complete!: (response: Response) => void
      const pending = new Promise<Response>((resolve) => {
        complete = resolve
      })
      const request = vi.fn<typeof fetch>(() => pending)
      vi.stubGlobal('fetch', request)
      const { rerender } = render(
        <SavedSeasonOutlookCard
          guildCode="SYN001"
          season="101"
          contextKey="officer-session"
        />
      )
      enterTime()
      fireEvent.click(
        screen.getByRole('button', { name: 'Calculate saved outlook' })
      )
      const signal = request.mock.calls[0][1]?.signal as AbortSignal
      rerender(<SavedSeasonOutlookCard {...next} />)
      expect(signal.aborted).toBe(true)
      expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
      await act(async () => {
        complete(new Response(JSON.stringify(ready)))
        await pending
      })
      expect(
        screen.queryByRole('region', { name: 'Saved outlook calculation' })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(request).toHaveBeenCalledOnce()
    }
  )

  it('cancels and clears a calculation when its explicit as-of time changes', async () => {
    let complete!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => {
      complete = resolve
    })
    const request = vi.fn<typeof fetch>(() => pending)
    vi.stubGlobal('fetch', request)
    render(
      <SavedSeasonOutlookCard
        guildCode="SYN001"
        season="101"
        contextKey="officer-session"
      />
    )
    enterTime()
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
      target: { value: '2026-06-02T07:00:00' }
    })
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
    await act(async () => {
      complete(new Response(JSON.stringify(ready)))
      await pending
    })
    expect(
      screen.queryByRole('region', { name: 'Saved outlook calculation' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    ).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    { ...ready, saved: { ...ready.saved, season: '102' } },
    { ...ready, saved: { ...ready.saved, asOf: '2026-06-02T07:00:00.000Z' } },
    {
      ...ready,
      projection: { ...ready.projection, confidence: 'RAW_BODY_CANARY' }
    },
    { ...ready, model: { appliedDamage: null } }
  ])(
    'rejects malformed or mismatched calculation responses without rendering raw data',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)))
      )
      render(
        <SavedSeasonOutlookCard
          guildCode="SYN001"
          season="101"
          contextKey="officer-session"
        />
      )
      enterTime()
      fireEvent.click(
        screen.getByRole('button', { name: 'Calculate saved outlook' })
      )
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Saved outlook could not be calculated.'
      )
      expect(
        screen.queryByRole('region', { name: 'Saved outlook calculation' })
      ).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent('RAW_BODY_CANARY')
    }
  )

  it('presents unavailable saved inputs without forwarding an error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response('RAW_ERROR_CANARY', { status: 422 })
      )
    )
    render(
      <SavedSeasonOutlookCard
        guildCode="SYN001"
        season="9999"
        contextKey="officer-session"
      />
    )
    enterTime()
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved outlook unavailable for this season and as-of time.'
    )
    expect(document.body).not.toHaveTextContent('RAW_ERROR_CANARY')
  })

  it('aborts its request when the card is removed', () => {
    const request = vi.fn<typeof fetch>(() => new Promise(() => {}))
    vi.stubGlobal('fetch', request)
    const { unmount } = render(
      <SavedSeasonOutlookCard
        guildCode="SYN001"
        season="101"
        contextKey="officer-session"
      />
    )
    enterTime()
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    const signal = request.mock.calls[0][1]?.signal
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it.each([
    { profile: 'hosted', admitted: true, contextKey: 'officer-session' },
    { profile: 'desktop', admitted: false, contextKey: 'officer-session' },
    { profile: 'desktop', admitted: true, contextKey: undefined }
  ])(
    'requires separate local admission and a caller context ($profile/$admitted/$contextKey)',
    ({ profile, admitted, contextKey }) => {
      vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', profile)
      const request = vi.fn<typeof fetch>()
      vi.stubGlobal('fetch', request)
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } }
      })
      render(
        <QueryClientProvider client={client}>
          <TokenUsage
            selectedGuild=""
            selectedSeason="101"
            showSavedOutlook={admitted}
            savedOutlookContextKey={contextKey}
          />
        </QueryClientProvider>
      )
      expect(
        screen.queryByRole('region', { name: 'Saved season outlook' })
      ).not.toBeInTheDocument()
      expect(request).not.toHaveBeenCalled()
      client.clear()
    }
  )

  it('keeps actual cached token usage intact through saved outlook calculation and failure', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-public-client')
    const paths: string[] = []
    let outlookRequests = 0
    const saved = {
      player_id: 'synthetic-player',
      display_name: 'Synthetic Member',
      tokens_available: 2,
      token_next_in_seconds: 3600,
      bombs_available: 0,
      bomb_next_in_seconds: null,
      data_source: 'cached',
      last_sync_at: '2026-06-02T07:00:00Z'
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const path = String(input)
        paths.push(path)
        if (path.startsWith('/api/members/token-usage/battles?'))
          return Response.json([])
        if (path.startsWith('/api/members/token-usage?'))
          return Response.json([
            {
              ...saved,
              tokens_used: 1,
              boss_tokens: 1,
              prime_tokens: 0,
              max_possible: 28,
              computed_at: '2026-06-02T07:00:00Z'
            }
          ])
        if (path.startsWith('/api/guild-tokens?'))
          return Response.json({ players: [saved] })
        if (path.startsWith('/api/season-forecast/outlook?')) {
          outlookRequests++
          return outlookRequests === 1
            ? Response.json(ready)
            : new Response(null, { status: 503 })
        }
        if (
          path.includes('/rest/v1/guild_config?') ||
          path.endsWith('/rest/v1/rpc/get_duplicate_display_labels')
        )
          return Response.json([])
        throw new Error('Unexpected request in token usage interface')
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } }
    })
    render(
      <QueryClientProvider client={client}>
        <TokenUsage
          selectedGuild="SYN001"
          selectedSeason="101"
          showSavedOutlook
          savedOutlookContextKey="officer-session"
        />
      </QueryClientProvider>
    )
    const cached = await screen.findByRole('region', {
      name: 'Saved token availability'
    })
    const cachedText = cached.textContent
    expect(cached).toHaveTextContent('2 / 3')
    enterTime()
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    await screen.findByRole('region', { name: 'Saved outlook calculation' })
    expect(cached.textContent).toBe(cachedText)
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh saved outlook' })
    )
    await screen.findByRole('alert')
    expect(cached.textContent).toBe(cachedText)
    expect(
      screen.queryByRole('tab', { name: 'Forecast' })
    ).not.toBeInTheDocument()
    expect(
      paths.some(
        (path) =>
          path.includes('get_guild_season_forecast') ||
          path.includes('live=true')
      )
    ).toBe(false)
    client.clear()
  })
})
