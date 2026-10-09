import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SavedSeasonOutlookCard } from '@/app/components/token-usage/SavedSeasonOutlookCard'
import type { SavedSeasonOutlook } from '@/app/lib/season-forecast/saved-outlook-types'

function calculate() {
  fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
    target: { value: '2026-06-02T08:00:00' }
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Calculate saved outlook' })
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('saved outlook non-OK response lifecycle', () => {
  it.each([422, 503, 401])(
    'finishes and discards the actual %s response body before presenting a static error',
    async (status) => {
      let sentEof = false
      let chunks = 0
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (chunks++ === 0) {
              controller.enqueue(
                new TextEncoder().encode('RAW_NON_OK_SERVICE_CANARY')
              )
            } else {
              sentEof = true
              controller.close()
            }
          }
        },
        { highWaterMark: 0 }
      )
      const response = new Response(stream, { status })
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => response)
      )
      render(
        <SavedSeasonOutlookCard
          guildCode="SYN001"
          season="101"
          contextKey="synthetic-current-caller"
        />
      )
      calculate()
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(
        status === 422
          ? 'Saved outlook unavailable for this season and as-of time.'
          : 'Saved outlook could not be calculated. Cached token usage is unchanged.'
      )
      expect(response.bodyUsed).toBe(true)
      expect(sentEof).toBe(true)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('region', { name: 'Saved outlook calculation' })
      ).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent('RAW_NON_OK_SERVICE_CANARY')
    }
  )

  it('waits for error-body EOF before showing the static refusal', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller
        }
      }),
      { status: 422 }
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => response)
    )
    render(
      <SavedSeasonOutlookCard
        guildCode="SYN001"
        season="101"
        contextKey="synthetic-current-caller"
      />
    )
    calculate()
    await waitFor(() => expect(response.bodyUsed).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent(
      'Calculating saved outlook'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => {
      body.enqueue(new Uint8Array([0xff, 0xfe, 0x00]))
      body.close()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved outlook unavailable for this season and as-of time.'
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Saved outlook calculation' })
    ).not.toBeInTheDocument()
  })

  it.each([422, 503])(
    'keeps a failed %s body read behind the same static safe error',
    async (status) => {
      const response = new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              controller.error(new Error('RAW_BODY_READ_FAILURE_CANARY'))
            }
          },
          { highWaterMark: 0 }
        ),
        { status }
      )
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => response)
      )
      render(
        <SavedSeasonOutlookCard
          guildCode="SYN001"
          season="101"
          contextKey="synthetic-current-caller"
        />
      )
      calculate()
      expect(await screen.findByRole('alert')).toHaveTextContent(
        status === 422
          ? 'Saved outlook unavailable'
          : 'Saved outlook could not be calculated'
      )
      expect(response.bodyUsed).toBe(true)
      expect(document.body).not.toHaveTextContent(
        'RAW_BODY_READ_FAILURE_CANARY'
      )
      expect(
        screen.queryByRole('region', { name: 'Saved outlook calculation' })
      ).not.toBeInTheDocument()
    }
  )

  it.each(['guild', 'season', 'caller', 'as-of'])(
    'fences a rejected old error body after %s changes while keeping the new calculation',
    async (kind) => {
      let body!: ReadableStreamDefaultController<Uint8Array>
      const oldResponse = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            body = controller
          }
        }),
        { status: 503 }
      )
      const next = {
        guildCode: kind === 'guild' ? 'SYN002' : 'SYN001',
        season: kind === 'season' ? '102' : '101',
        contextKey:
          kind === 'caller'
            ? 'synthetic-new-caller'
            : 'synthetic-current-caller'
      }
      const nextAsOf =
        kind === 'as-of'
          ? '2026-06-02T07:00:00.000Z'
          : '2026-06-02T08:00:00.000Z'
      const ready: SavedSeasonOutlook = {
        projection: {
          guildCode: next.guildCode,
          season: Number(next.season),
          generatedAt: nextAsOf,
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
            playerId: 'SYN_CURRENT_PLAYER',
            displayName: 'Synthetic current scope',
            tokensUsed: 1,
            tokensRemaining: 3,
            projectedWaste: 0,
            atCapRisk: false
          }
        ],
        saved: {
          status: 'ready',
          source: 'saved-season',
          season: next.season,
          configId: 'synthetic-config',
          asOf: nextAsOf,
          timeZone: 'UTC'
        },
        model: { appliedDamage: 300 }
      }
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(oldResponse)
        .mockResolvedValueOnce(new Response(JSON.stringify(ready)))
      vi.stubGlobal('fetch', request)
      const { rerender } = render(
        <SavedSeasonOutlookCard
          guildCode="SYN001"
          season="101"
          contextKey="synthetic-current-caller"
        />
      )
      calculate()
      await waitFor(() => expect(oldResponse.bodyUsed).toBe(true))
      if (kind !== 'as-of') rerender(<SavedSeasonOutlookCard {...next} />)
      fireEvent.change(screen.getByLabelText('As-of time (UTC)'), {
        target: { value: nextAsOf.slice(0, -5) }
      })
      expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true)
      fireEvent.click(
        screen.getByRole('button', { name: 'Calculate saved outlook' })
      )
      await screen.findByRole('row', { name: /Synthetic current scope/ })
      await act(async () => {
        body.error(new Error('RAW_LATE_BODY_FAILURE_CANARY'))
        await Promise.resolve()
      })
      expect(
        screen.getByRole('row', { name: /Synthetic current scope/ })
      ).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent(
        'RAW_LATE_BODY_FAILURE_CANARY'
      )
      expect(
        screen.getByRole('button', { name: 'Refresh saved outlook' })
      ).toBeEnabled()
      expect(request).toHaveBeenCalledTimes(2)
    }
  )
})
