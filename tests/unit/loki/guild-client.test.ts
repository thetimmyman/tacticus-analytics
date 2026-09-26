import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { createLokiClientMock } = vi.hoisted(() => ({
  createLokiClientMock: vi.fn(() => ({ kind: 'loki-client' }))
}))

vi.mock('@/app/lib/loki/client', () => ({
  createLokiClient: createLokiClientMock
}))

import { createGuildLokiClient } from '@/app/lib/loki/guild-client'

function makeClient(row: {
  user_id: string | null
  session_id: string | null
}) {
  const updates: unknown[] = []
  const readChain = {
    select: vi.fn(() => readChain),
    eq: vi.fn(() => readChain),
    maybeSingle: vi.fn(async () => ({ data: row, error: null }))
  }
  const updateChain = {
    eq: vi.fn(async (...args: unknown[]) => {
      updates.push(args)
      return { error: null }
    })
  }
  const client = {
    from: vi.fn(() => ({
      ...readChain,
      update: vi.fn((value: unknown) => {
        updates.push(value)
        return updateChain
      })
    }))
  }
  return { client: client as never, readChain, updates }
}

describe('createGuildLokiClient', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  it('returns null when no complete credential pair exists', async () => {
    delete process.env.LOKI_SCRAPER_USER_ID
    delete process.env.LOKI_SCRAPER_CLIENT_SECRET
    const { client } = makeClient({ user_id: null, session_id: null })

    expect(await createGuildLokiClient(client, 'ABC')).toBeNull()
    expect(createLokiClientMock).not.toHaveBeenCalled()
  })

  it('uses a prefetched row, custom fetch, and central session write-back', async () => {
    delete process.env.LOKI_SCRAPER_USER_ID
    process.env.LOKI_SCRAPER_CLIENT_SECRET = 'secret'
    const { client, readChain, updates } = makeClient({
      user_id: 'unused',
      session_id: 'unused'
    })
    const fetchImpl = vi.fn() as unknown as typeof fetch

    const result = await createGuildLokiClient(client, 'ABC', {
      credentialRow: { user_id: 'guild-user', session_id: 'old-session' },
      fetchImpl
    })

    expect(result).toEqual({ kind: 'loki-client' })
    expect(readChain.maybeSingle).not.toHaveBeenCalled()
    expect(createLokiClientMock).toHaveBeenCalledWith(
      {
        userId: 'guild-user',
        sessionId: 'old-session',
        clientSecret: 'secret'
      },
      expect.objectContaining({ retryAttempts: 0, fetchImpl })
    )

    const options = createLokiClientMock.mock.calls[0]?.[1]
    await options.onSessionUpdate({ sessionId: 'new-session' })
    expect(updates[0]).toEqual(
      expect.objectContaining({ session_id: 'new-session' })
    )
    expect(updates[1]).toEqual(['guild_code', 'ABC'])
  })

  it('pairs the shared scraper secret with the scraper user id, never a legacy row user_id', async () => {
    // A legacy user_id with the shared scraper secret never matched, so LOKI returned 500 on every call.
    process.env.LOKI_SCRAPER_USER_ID = 'scraper-user'
    process.env.LOKI_SCRAPER_CLIENT_SECRET = 'secret'
    const { client } = makeClient({ user_id: 'unused', session_id: 'unused' })

    await createGuildLokiClient(client, 'ABC', {
      credentialRow: { user_id: 'legacy-guild-user', session_id: 'old-session' }
    })

    expect(createLokiClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'scraper-user' }),
      expect.anything()
    )
  })
})
