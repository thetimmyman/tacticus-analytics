import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderAdmissionError } from '@/supabase/functions/_shared/provider-admission'
import {
  SHARED_SESSION_MAX_AGE_MS,
  createRestSharedSessionStore,
  ensureSharedLokiSession,
  type StoredSharedSession
} from '@/app/lib/loki/batch-session-refresh'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const SCRAPER = 'synthetic-scraper-account'
const STORED = 'stored-session-0000000000'
const CONNECTED = 'connected-session-1111111111'
const PROBE_GUILD = 'synthetic-guild'

const connectBody = {
  eventResult: { eventResponseData: { userData: { sessionId: CONNECTED } } }
}
const guildViewBody = {
  eventResult: { eventResponseData: { guild: { guildId: PROBE_GUILD } } }
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body
  } as unknown as Response
}

type FetchCall = [string, { body?: string; method?: string }]

function eventTypes(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return (fetchImpl.mock.calls as FetchCall[]).map(
    ([, init]) => JSON.parse(init.body ?? '{}').playerEvent.playerEventType
  )
}

function storedAt(
  ageMs: number | null,
  over: Partial<StoredSharedSession> = {}
): StoredSharedSession {
  return {
    sessionId: STORED,
    refreshedAt: ageMs === null ? null : new Date(NOW - ageMs).toISOString(),
    allRowsMatch: true,
    ...over
  }
}

function fakeStore(stored: StoredSharedSession | null) {
  return {
    read: vi.fn().mockResolvedValue(stored),
    write: vi.fn().mockResolvedValue(true)
  }
}

function run(
  store: ReturnType<typeof fakeStore>,
  fetchImpl: ReturnType<typeof vi.fn>,
  probeGuildId: string | null = PROBE_GUILD
) {
  return ensureSharedLokiSession({
    store,
    probeGuildId,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => NOW
  })
}

describe('ensureSharedLokiSession', () => {
  beforeEach(() => {
    process.env.LOKI_SCRAPER_USER_ID = SCRAPER
    process.env.LOKI_SCRAPER_CLIENT_SECRET = 'synthetic-secret'
  })

  afterEach(() => {
    delete process.env.LOKI_SCRAPER_USER_ID
    delete process.env.LOKI_SCRAPER_CLIENT_SECRET
  })

  it('reuses a fresh stored session the game accepts, without a CONNECT', async () => {
    const store = fakeStore(storedAt(5 * 60 * 1000))
    const fetchImpl = vi.fn().mockResolvedValue(response(guildViewBody))

    const result = await run(store, fetchImpl)

    expect(result).toMatchObject({
      sessionId: STORED,
      reused: true,
      connected: false
    })
    expect(eventTypes(fetchImpl)).toEqual(['VIEW_GUILD_2'])
    const [url, init] = fetchImpl.mock.calls[0] as FetchCall
    expect(url).toContain(`/userId/${SCRAPER}/sessionId/${STORED}`)
    // Same event the sync sends: the session travels in the path only.
    expect(JSON.parse(init.body ?? '{}').playerEvent.playerEventData).toEqual({
      guildId: PROBE_GUILD
    })
    expect(store.write).not.toHaveBeenCalled()
  })

  it('points every cohort row at a reused session when some row differs, keeping its age', async () => {
    const store = fakeStore(storedAt(5 * 60 * 1000, { allRowsMatch: false }))
    const fetchImpl = vi.fn().mockResolvedValue(response(guildViewBody))

    await run(store, fetchImpl)

    expect(store.write).toHaveBeenCalledTimes(1)
    expect(store.write).toHaveBeenCalledWith(STORED, null)
  })

  it.each([
    ['a 401', 401, 'expired'],
    ['a 500 invalid_session body', 500, '{"error":"invalid_session"}'],
    ['a 500 incorrect session key body', 500, 'Incorrect session key']
  ])(
    'connects once when the game rejects the stored session with %s',
    async (_label, status, body) => {
      const store = fakeStore(storedAt(5 * 60 * 1000))
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(body, status))
        .mockResolvedValueOnce(response(connectBody))

      const result = await run(store, fetchImpl)

      expect(result).toMatchObject({
        sessionId: CONNECTED,
        connected: true,
        reused: false
      })
      expect(eventTypes(fetchImpl)).toEqual(['VIEW_GUILD_2', 'CONNECT'])
      expect(store.write).toHaveBeenCalledWith(
        CONNECTED,
        new Date(NOW).toISOString()
      )
    }
  )

  it.each([
    ['nothing is stored', null],
    [
      'the stored session is past its max age',
      storedAt(SHARED_SESSION_MAX_AGE_MS + 1)
    ],
    ['the stored stamp is in the future', storedAt(-60 * 1000)],
    ['the stored session has no stamp', storedAt(null)]
  ])('connects without a probe when %s', async (_label, stored) => {
    const store = fakeStore(stored)
    const fetchImpl = vi.fn().mockResolvedValue(response(connectBody))

    const result = await run(store, fetchImpl)

    expect(result).toMatchObject({ sessionId: CONNECTED, connected: true })
    expect(eventTypes(fetchImpl)).toEqual(['CONNECT'])
    expect(store.write).toHaveBeenCalledWith(
      CONNECTED,
      new Date(NOW).toISOString()
    )
  })

  it.each([
    ['a 503', () => Promise.resolve(response('upstream unavailable', 503))],
    [
      'a 500 without a session error',
      () => Promise.resolve(response('boom', 500))
    ],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed'))]
  ])(
    'keeps the stored session without a CONNECT when the probe gets %s',
    async (_label, outcome) => {
      const store = fakeStore(storedAt(5 * 60 * 1000, { allRowsMatch: false }))
      const fetchImpl = vi.fn(outcome)

      const result = await run(store, fetchImpl)

      expect(result).toMatchObject({
        sessionId: STORED,
        reused: true,
        connected: false
      })
      expect(eventTypes(fetchImpl)).toEqual(['VIEW_GUILD_2'])
      expect(store.write).not.toHaveBeenCalled()
    }
  )

  it('makes no game call when no guild to sync has a guild id', async () => {
    const store = fakeStore(storedAt(5 * 60 * 1000))
    const fetchImpl = vi.fn()

    const result = await run(store, fetchImpl, null)

    expect(result).toMatchObject({ sessionId: null, connected: false })
    expect(result.error).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.read).not.toHaveBeenCalled()
  })

  it('returns no session when the CONNECT is refused', async () => {
    const store = fakeStore(null)
    const fetchImpl = vi.fn().mockResolvedValue(response('denied', 403))

    const result = await run(store, fetchImpl)

    expect(result.sessionId).toBeNull()
    expect(result.connected).toBe(false)
    expect(result.error).toBeTruthy()
    expect(store.write).not.toHaveBeenCalled()
  })

  it('does not CONNECT after a local provider refusal on the probe', async () => {
    const store = fakeStore(storedAt(5 * 60 * 1000))
    const fetchImpl = vi.fn(() => Promise.reject(new ProviderAdmissionError()))

    const result = await run(store, fetchImpl)

    expect(result.sessionId).toBeNull()
    expect(result.error).toBeTruthy()
    expect(eventTypes(fetchImpl)).toEqual(['VIEW_GUILD_2'])
    expect(store.write).not.toHaveBeenCalled()
  })

  it('reports missing scraper credentials without a game call', async () => {
    delete process.env.LOKI_SCRAPER_CLIENT_SECRET
    const store = fakeStore(storedAt(5 * 60 * 1000))
    const fetchImpl = vi.fn()

    const result = await run(store, fetchImpl)

    expect(result.sessionId).toBeNull()
    expect(result.error).toMatch(/not configured/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('createRestSharedSessionStore', () => {
  const BASE = 'http://supabase.local'
  const COHORT = `or=(user_id.is.null,user_id.eq.${SCRAPER})`

  function makeStore(fetchImpl: ReturnType<typeof vi.fn>) {
    return createRestSharedSessionStore({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseUrl: BASE,
      anonKey: 'anon-key',
      serviceKey: 'service-key',
      scraperUserId: SCRAPER
    })
  }

  it('reads the newest stamped session and whether every cohort row holds it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response([
        // A breaker-cleared row keeps its stamp; skip it rather than read "no session".
        { session_id: null, session_refreshed_at: '2026-10-15T11:58:00Z' },
        { session_id: STORED, session_refreshed_at: '2026-10-15T11:55:00Z' },
        { session_id: STORED, session_refreshed_at: null }
      ])
    )

    const stored = await makeStore(fetchImpl).read()

    expect(stored).toEqual({
      sessionId: STORED,
      refreshedAt: '2026-10-15T11:55:00Z',
      allRowsMatch: false
    })
    const [url, init] = fetchImpl.mock.calls[0] as FetchCall
    expect(url).toContain(`${BASE}/rest/v1/guild_config?`)
    expect(url).toContain(COHORT)
    expect(url).toContain('order=session_refreshed_at.desc.nullslast')
    expect(init.method).toBe('GET')
  })

  it('reports a match when every cohort row holds the session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response([
        { session_id: STORED, session_refreshed_at: '2026-10-15T11:55:00Z' },
        { session_id: STORED, session_refreshed_at: '2026-10-15T11:55:00Z' }
      ])
    )

    expect((await makeStore(fetchImpl).read())?.allRowsMatch).toBe(true)
  })

  it.each([
    [
      'no cohort row holds a session',
      response([{ session_id: null, session_refreshed_at: null }])
    ],
    ['the read fails', response({ message: 'boom' }, 500)]
  ])('reads nothing when %s', async (_label, reply) => {
    const fetchImpl = vi.fn().mockResolvedValue(reply)

    expect(await makeStore(fetchImpl).read()).toBeNull()
  })

  it('stamps every cohort row after a CONNECT and keeps the session out of the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(null, 204))
    const connectedAt = new Date(NOW).toISOString()

    expect(await makeStore(fetchImpl).write(CONNECTED, connectedAt)).toBe(true)

    const [url, init] = fetchImpl.mock.calls[0] as FetchCall
    expect(init.method).toBe('PATCH')
    expect(url).toBe(`${BASE}/rest/v1/guild_config?${COHORT}`)
    expect(url).not.toContain(CONNECTED)
    const body = JSON.parse(init.body ?? '{}')
    expect(body).toMatchObject({
      session_id: CONNECTED,
      session_refreshed_at: connectedAt
    })
    expect(body.updated_at).toBeTruthy()
  })

  it('leaves the stamp alone when spreading a reused session', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(null, 204))

    await makeStore(fetchImpl).write(STORED, null)

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as FetchCall)[1].body ?? '{}'
    )
    expect(body.session_id).toBe(STORED)
    expect(body).not.toHaveProperty('session_refreshed_at')
  })

  it('reports a failed write', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(response({ message: 'no' }, 500))

    expect(await makeStore(fetchImpl).write(CONNECTED, null)).toBe(false)
  })
})
