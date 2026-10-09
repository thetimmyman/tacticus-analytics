import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { SavedSeasonOutlookCard } from '@/app/components/token-usage/SavedSeasonOutlookCard'
import type { SavedSeasonOutlook } from '@/app/lib/season-forecast/saved-outlook-types'

const asOf = '2026-06-02T08:00:00.000Z'
const ready: SavedSeasonOutlook = {
  projection: {
    guildCode: 'SYN001',
    season: 101,
    generatedAt: asOf,
    secondsRemaining: 7200,
    memberCount: 2,
    seasonMaxTokensPerPlayer: 28,
    seasonBudget: 56,
    tokensUsed: 6,
    tokensRemaining: 8,
    projectedWaste: 2,
    playersAtCapRisk: 1,
    projectedForwardSpend: 3,
    finish: null,
    confidence: 'low'
  },
  players: [
    {
      playerId: 'SYN_PACE_A',
      displayName: 'Synthetic Pace Alpha',
      tokensUsed: 4,
      tokensRemaining: 5,
      projectedWaste: 2,
      atCapRisk: true
    },
    {
      playerId: 'SYN_PACE_B',
      displayName: 'Synthetic Pace Beta',
      tokensUsed: 2,
      tokensRemaining: 3,
      projectedWaste: 0,
      atCapRisk: false
    }
  ],
  saved: {
    status: 'ready',
    source: 'saved-season',
    season: '101',
    configId: 'synthetic-config',
    asOf,
    timeZone: 'UTC'
  },
  model: { appliedDamage: 300 }
}

function mount() {
  return render(
    <SavedSeasonOutlookCard
      guildCode="SYN001"
      season="101"
      contextKey="synthetic-officer-context"
    />
  )
}
function calculate() {
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Calculate saved outlook' })
  )
}
afterEach(() => vi.unstubAllGlobals())

describe('authorized saved player pace detail', () => {
  it('presents canonical used, spendable, waste and risk fields separately from the guild model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify(ready)))
    )
    mount()
    calculate()
    const table = await screen.findByRole('table', {
      name: 'Player token pace'
    })
    for (const name of [
      'Player',
      'Used this season',
      'Spendable by season end',
      'Projected waste (tokens)',
      'Projected cap risk'
    ])
      expect(
        within(table).getByRole('columnheader', { name })
      ).toBeInTheDocument()
    const alpha = within(table).getByRole('row', {
      name: /Synthetic Pace Alpha/
    })
    expect(
      within(alpha)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['Synthetic Pace Alpha', '4', '5', '≈2', 'At risk'])
    const beta = within(table).getByRole('row', { name: /Synthetic Pace Beta/ })
    expect(
      within(beta)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['Synthetic Pace Beta', '2', '3', '≈0', 'Not flagged'])
    expect(
      screen.getByText('Guild model: 1 player flagged for cap risk')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Player detail is limited to your current access.')
    ).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('SYN_PACE_A')
    expect(document.body).not.toHaveTextContent('SYN_PACE_B')
    expect(document.body).not.toHaveTextContent('synthetic-officer-context')
  })

  it('uses safe unnamed labels without exposing trimmed identifiers and leaves duplicate names as separate inert text', async () => {
    const payload = {
      ...ready,
      players: [
        {
          ...ready.players[0],
          playerId: ' SYN_LABEL_PRIVATE ',
          displayName: 'SYN_LABEL_PRIVATE'
        },
        {
          ...ready.players[0],
          playerId: 'SYN_BLANK_PRIVATE',
          displayName: '   '
        },
        {
          ...ready.players[0],
          playerId: 'SYN_DUPLICATE_A',
          displayName: '  Synthetic duplicate  '
        },
        {
          ...ready.players[1],
          playerId: 'SYN_DUPLICATE_B',
          displayName: 'Synthetic duplicate'
        },
        {
          ...ready.players[1],
          playerId: 'SYN_HTML_PRIVATE',
          displayName: '<img src=x onerror=alert(1)>'
        }
      ]
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload)))
    )
    mount()
    calculate()
    const table = await screen.findByRole('table', {
      name: 'Player token pace'
    })
    expect(
      within(table).getByRole('cell', { name: 'Unnamed member 1' })
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('cell', { name: 'Unnamed member 2' })
    ).toBeInTheDocument()
    expect(
      within(table).getAllByRole('cell', { name: 'Synthetic duplicate' })
    ).toHaveLength(2)
    expect(
      within(table).getByRole('cell', { name: '<img src=x onerror=alert(1)>' })
    ).toBeInTheDocument()
    expect(table.querySelector('img')).toBeNull()
    for (const player of payload.players)
      expect(document.body.innerHTML).not.toContain(player.playerId.trim())
  })

  it.each([
    ['missing player array', { players: undefined }],
    ['non-array player detail', { players: {} }],
    [
      'over canonical guild bound',
      {
        players: Array.from({ length: 31 }, (_, i) => ({
          ...ready.players[0],
          playerId: `SYN_MEMBER_${i}`
        }))
      }
    ],
    [
      'duplicate player identifier',
      {
        players: [
          ready.players[0],
          { ...ready.players[1], playerId: ready.players[0].playerId }
        ]
      }
    ],
    [
      'duplicate trimmed identifier',
      {
        players: [
          ready.players[0],
          { ...ready.players[1], playerId: ` ${ready.players[0].playerId} ` }
        ]
      }
    ],
    ['empty identifier', { players: [{ ...ready.players[0], playerId: '' }] }],
    [
      'blank identifier',
      { players: [{ ...ready.players[0], playerId: '  ' }] }
    ],
    [
      'identifier above safety bound',
      { players: [{ ...ready.players[0], playerId: 'S'.repeat(257) }] }
    ],
    [
      'display name above safety bound',
      { players: [{ ...ready.players[0], displayName: 'N'.repeat(1025) }] }
    ],
    [
      'missing name',
      { players: [{ ...ready.players[0], displayName: undefined }] }
    ],
    ['numeric string', { players: [{ ...ready.players[0], tokensUsed: '4' }] }],
    [
      'negative spendable',
      { players: [{ ...ready.players[0], tokensRemaining: -1 }] }
    ],
    [
      'null waste',
      { players: [{ ...ready.players[0], projectedWaste: null }] }
    ],
    [
      'negative waste',
      { players: [{ ...ready.players[0], projectedWaste: -0.1 }] }
    ],
    [
      'missing risk',
      { players: [{ ...ready.players[0], atCapRisk: undefined }] }
    ],
    ['string risk', { players: [{ ...ready.players[0], atCapRisk: 'true' }] }],
    [
      'fractional guild risk',
      { projection: { ...ready.projection, playersAtCapRisk: 1.5 } }
    ],
    [
      'guild risk above canonical bound',
      { projection: { ...ready.projection, playersAtCapRisk: 31 } }
    ]
  ])('refuses the entire calculation for %s', async (_name, overrides) => {
    const payload = { ...ready, ...overrides }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(JSON.stringify(payload)))
    )
    mount()
    calculate()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved outlook could not be calculated. Cached token usage is unchanged.'
    )
    expect(
      screen.queryByRole('region', { name: 'Saved outlook calculation' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: 'Player token pace' })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Synthetic Pace Alpha')
  })

  it('admits exactly thirty canonical rows and names/identifiers at the safety bounds', async () => {
    const players = Array.from({ length: 30 }, (_, i) => ({
      ...ready.players[0],
      playerId: `SYN_MEMBER_${i}`,
      displayName: `Synthetic Member ${i}`
    }))
    players[0] = {
      ...players[0],
      playerId: 'S'.repeat(256),
      displayName: 'N'.repeat(1024)
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ ...ready, players }))
      )
    )
    mount()
    calculate()
    const table = await screen.findByRole('table', {
      name: 'Player token pace'
    })
    expect(within(table).getAllByRole('row')).toHaveLength(31)
    expect(
      within(table).getByRole('cell', { name: 'N'.repeat(1024) })
    ).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('S'.repeat(256))
  })

  it('keeps guild risk separate when the signed response contains no authorized player detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ ...ready, players: [] }))
      )
    )
    mount()
    calculate()
    expect(
      await screen.findByText(
        'No player detail is available for your current access.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('Guild model: 1 player flagged for cap risk')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: 'Player token pace' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows only supplied authorized rows without deriving risk from rounded waste or the guild total', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              ...ready,
              players: [
                {
                  ...ready.players[1],
                  projectedWaste: 0.9999,
                  atCapRisk: false
                }
              ]
            })
          )
      )
    )
    mount()
    calculate()
    const table = await screen.findByRole('table', {
      name: 'Player token pace'
    })
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByRole('cell', { name: '≈1' })).toBeInTheDocument()
    expect(
      within(table).getByRole('cell', { name: 'Not flagged' })
    ).toBeInTheDocument()
    expect(within(table).queryByText('At risk')).not.toBeInTheDocument()
    expect(
      screen.getByText('Guild model: 1 player flagged for cap risk')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Spendable by season end includes modeled regeneration/)
    ).toHaveTextContent('it is not the current token bank')
    expect(
      screen.getByText(/Rounded display values do not determine the flag/)
    ).toBeInTheDocument()
  })

  it('presents independently worked canonical pace literals without changing their risk flag', async () => {
    const instant = '2026-06-01T10:00:00.000Z'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              ...ready,
              projection: {
                ...ready.projection,
                generatedAt: instant,
                secondsRemaining: 86400,
                projectedWaste: 2
              },
              saved: { ...ready.saved, asOf: instant },
              players: [
                {
                  ...ready.players[0],
                  tokensUsed: 1,
                  tokensRemaining: 4,
                  projectedWaste: 23 / 12,
                  atCapRisk: true
                }
              ]
            })
          )
      )
    )
    mount()
    fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
      target: { value: '2026-06-01T10:00:00' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    )
    const table = await screen.findByRole('table', {
      name: 'Player token pace'
    })
    const row = within(table).getByRole('row', { name: /Synthetic Pace Alpha/ })
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    ).toEqual(['Synthetic Pace Alpha', '1', '4', '≈1.92', 'At risk'])
  })

  it.each([
    {
      guildCode: 'SYN002',
      season: '101',
      contextKey: 'synthetic-officer-context'
    },
    {
      guildCode: 'SYN001',
      season: '102',
      contextKey: 'synthetic-officer-context'
    },
    {
      guildCode: 'SYN001',
      season: '101',
      contextKey: 'synthetic-new-authority-context'
    }
  ])(
    'clears visible rows on scope change and cannot reintroduce them from a late refresh ($guildCode/$season/$contextKey)',
    async (next) => {
      let complete!: (response: Response) => void
      const pending = new Promise<Response>((resolve) => {
        complete = resolve
      })
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify(ready)))
        .mockReturnValueOnce(pending)
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ...ready,
              projection: {
                ...ready.projection,
                guildCode: next.guildCode,
                season: Number(next.season)
              },
              saved: { ...ready.saved, season: next.season },
              players: [
                { ...ready.players[1], displayName: 'Synthetic current scope' }
              ]
            })
          )
        )
      vi.stubGlobal('fetch', request)
      const { rerender } = mount()
      calculate()
      await screen.findByRole('row', { name: /Synthetic Pace Alpha/ })
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh saved outlook' })
      )
      expect(
        screen.queryByRole('table', { name: 'Player token pace' })
      ).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent('Synthetic Pace Alpha')
      rerender(<SavedSeasonOutlookCard {...next} />)
      expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true)
      expect(screen.getByLabelText('As-of time (UTC)')).toHaveValue('')
      calculate()
      await screen.findByRole('row', { name: /Synthetic current scope/ })
      await act(async () => {
        complete(new Response(JSON.stringify(ready)))
        await pending
      })
      expect(
        screen.queryByRole('row', { name: /Synthetic Pace Alpha/ })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('row', { name: /Synthetic current scope/ })
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(request).toHaveBeenCalledTimes(3)
    }
  )

  it('clears ready detail on as-of change and ignores an aborted refresh body that settles later', async () => {
    let complete!: () => void
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        complete = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(ready)))
          controller.close()
        }
      }
    })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(ready)))
      .mockResolvedValueOnce(new Response(body))
    vi.stubGlobal('fetch', request)
    mount()
    calculate()
    await screen.findByRole('row', { name: /Synthetic Pace Alpha/ })
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh saved outlook' })
    )
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
      target: { value: '2026-06-02T07:00:00' }
    })
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true)
    await act(async () => {
      complete()
      await Promise.resolve()
    })
    expect(
      screen.queryByRole('table', { name: 'Player token pace' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Saved outlook calculation' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Calculate saved outlook' })
    ).toBeEnabled()
  })

  it('atomically clears all old rows when a refresh has a malformed later row', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(ready)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...ready,
            players: [
              ready.players[0],
              { ...ready.players[1], tokensUsed: 'SERVICE_DETAIL_CANARY' }
            ]
          })
        )
      )
    vi.stubGlobal('fetch', request)
    mount()
    calculate()
    await screen.findByRole('row', { name: /Synthetic Pace Alpha/ })
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh saved outlook' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved outlook could not be calculated.'
    )
    expect(
      screen.queryByRole('region', { name: 'Saved outlook calculation' })
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('Synthetic Pace Alpha')
    expect(document.body).not.toHaveTextContent('SERVICE_DETAIL_CANARY')
  })

  it.each(['tokensUsed', 'tokensRemaining', 'projectedWaste'])(
    'refuses non-finite JSON numbers in %s without exposing any detail',
    async (field) => {
      const serialized = JSON.stringify({
        ...ready,
        players: [{ ...ready.players[0], [field]: 'NUMERIC_EXPONENT_MARKER' }]
      }).replace('"NUMERIC_EXPONENT_MARKER"', '1e999')
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => new Response(serialized))
      )
      mount()
      calculate()
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Saved outlook could not be calculated.'
      )
      expect(
        screen.queryByRole('region', { name: 'Saved outlook calculation' })
      ).not.toBeInTheDocument()
    }
  )
})
