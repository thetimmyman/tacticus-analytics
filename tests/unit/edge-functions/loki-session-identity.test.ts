import { beforeEach, describe, expect, it, vi } from 'vitest'

const edgeProviderFetch = vi.fn()

vi.mock('../../../supabase/functions/_shared/provider-fetch.ts', () => ({
  edgeProviderFetch: (...args: unknown[]) => edgeProviderFetch(...args)
}))

vi.mock('../../../supabase/functions/_shared/loki-build-version.ts', () => ({
  getRecommendedLokiBuildString: async () => '1.34.49.1617'
}))

import { refreshLokiSession } from '../../../supabase/functions/_shared/sync-modules/loki-session.ts'

/** Header names, lower-cased, exactly as they were handed to the transport. */
async function connectHeaders(): Promise<Record<string, string>> {
  edgeProviderFetch.mockResolvedValue(
    new Response(
      JSON.stringify({
        eventResult: { eventResponseData: { userData: { sessionId: 'session-1' } } }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  )

  await refreshLokiSession('user-1', 'secret-1')
  expect(edgeProviderFetch).toHaveBeenCalledTimes(1)

  const init = edgeProviderFetch.mock.calls[0][1] as { headers?: Record<string, string> }
  return Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
  )
}

describe('Loki session CONNECT identity', () => {
  beforeEach(() => {
    edgeProviderFetch.mockReset()
  })

  it('does not present itself as the Unity game client', async () => {
    const headers = await connectHeaders()

    expect(headers['user-agent']).toBeUndefined()
    expect(headers['x-unity-version']).toBeUndefined()
  })

  it('carries no game-client identity in the serialised body', async () => {
    await connectHeaders()

    const init = edgeProviderFetch.mock.calls[0][1] as { body?: string }
    const body = init.body ?? ''

    expect(body).not.toMatch(/UnityPlayer|UnityWebRequest|libcurl/i)
  })

  it('keeps the request a plain JSON POST', async () => {
    const headers = await connectHeaders()

    expect(headers['content-type']).toBe('application/json')
    expect(headers.accept).toBe('*/*')
  })
})
