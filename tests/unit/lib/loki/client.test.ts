import { describe, it, expect, vi } from 'vitest'
import { createLokiClient } from '@/app/lib/loki/client'

const makeResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    text: async () => JSON.stringify(body)
  }) as unknown as Response

describe('LokiClient session extraction (findSessionId)', () => {
  it('replays once after auth refresh even when ordinary retries are disabled', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ message: 'expired' }, false, 401))
      .mockResolvedValueOnce(
        makeResponse({
          eventResult: {
            eventResponseData: {
              userData: { sessionId: 'refreshed-session-1234' }
            }
          }
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          eventResult: {
            eventResponseData: {
              heroInfo: { player: { powerLevel: 42 } }
            }
          }
        })
      )

    const client = createLokiClient(
      {
        userId: 'u',
        sessionId: 'expired-session',
        clientSecret: 's'
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retryAttempts: 0
      }
    )

    const result = await client.getPlayerInfo('target')

    expect(result.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(
      JSON.parse(fetchImpl.mock.calls[1][1].body as string).playerEvent
        .playerEventType
    ).toBe('CONNECT')
  })

  it('prefers the canonical userData.sessionId over a decoy *session* key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        // The decoy comes first in iteration order and matches the heuristic.
        sessionConfigId: 'decoy-session-config-0000000000',
        eventResult: {
          eventResponseData: { userData: { sessionId: 'real-session-id-1234' } }
        }
      })
    )

    const client = createLokiClient(
      { userId: 'u', clientSecret: 's' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const result = await client.refreshSession()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.sessionId).toBe('real-session-id-1234')
    }
  })

  it('falls back to the heuristic scan when no canonical path is present', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ data: { sessionId: 'heuristic-session-9876' } })
      )

    const client = createLokiClient(
      { userId: 'u', clientSecret: 's' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const result = await client.refreshSession()

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.sessionId).toBe('heuristic-session-9876')
    }
  })

  it('returns a failure result when CONNECT is rejected', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ message: 'forbidden' }, false, 403))

    const client = createLokiClient(
      { userId: 'u', clientSecret: 's' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const result = await client.refreshSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.status).toBe(403)
      expect(result.error.isAuthError).toBe(true)
    }
  })

  it('returns a timed-out failure when the request aborts', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('Aborted'), { name: 'AbortError' })
      )

    const client = createLokiClient(
      { userId: 'u', clientSecret: 's' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const result = await client.refreshSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message.toLowerCase()).toContain('timed out')
    }
  })

  it('returns a failed-to-reach failure when LOKI is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('boom'))

    const client = createLokiClient(
      { userId: 'u', clientSecret: 's' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const result = await client.refreshSession()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message.toLowerCase()).toContain('failed to reach')
    }
  })

  it('sends a well-formed CONNECT request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          eventResult: {
            eventResponseData: { userData: { sessionId: 'sess-1234567890' } }
          }
        })
    })

    const client = createLokiClient(
      { userId: 'user-abc', clientSecret: 'secret-xyz' },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    )

    const result = await client.refreshSession()

    expect(result.ok).toBe(true)

    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(sentBody.playerEvent.playerEventType).toBe('CONNECT')
    expect(sentBody.playerEvent.playerEventData.userId).toBe('user-abc')
    expect(sentBody.playerEvent.playerEventData.clientSecret).toBe('secret-xyz')

    const deviceData = sentBody.playerEvent.playerEventData.deviceData
    expect(typeof deviceData).toBe('object')
    expect(deviceData).not.toBeNull()
    expect(deviceData).toHaveProperty('deviceId')
    expect(deviceData).toHaveProperty('buildString')

    expect(typeof sentBody.playerEvent.gameConfigVersion).toBe('string')
  })
})
