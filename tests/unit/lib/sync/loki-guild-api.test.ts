import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const OLD_SESSION = 'synthetic-old-session'
const NEW_SESSION = 'synthetic-refreshed-session'

const globalConfig = {
  general: { minRecommendedAppVersions: { Windows: '1.29.21.1056' } }
}

const guildView = {
  eventResult: {
    eventResponseData: {
      guild: {
        members: [{ userId: 'synthetic-member', displayName: 'Synthetic' }]
      }
    }
  }
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function database() {
  const updates: Record<string, unknown>[] = []
  const chain = {
    update: vi.fn((values: Record<string, unknown>) => {
      updates.push(values)
      return chain
    }),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve)
  }
  const client = { from: vi.fn(() => chain) } as unknown as TypedSupabaseClient
  return { client, updates, chain }
}

/** Answers globalConfig itself; every game event goes to `game`. */
function wireTo(
  game: (event: string, url: string) => Response | Promise<Response>
) {
  const events: Array<{ event: string; url: string }> = []
  const wire = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/globalConfig')) return Response.json(globalConfig)
    const event = JSON.parse(String(init?.body)).playerEvent.playerEventType
    events.push({ event, url })
    return game(event, url)
  })
  vi.stubGlobal('fetch', wire)
  return events
}

async function fetchMembers(client: TypedSupabaseClient) {
  const { fetchGuildMembersViaLoki } =
    await import('@/app/lib/sync/loki-guild-api')
  return fetchGuildMembersViaLoki(
    'SYNTH',
    'synthetic-guild',
    'synthetic-user',
    OLD_SESSION,
    'synthetic-secret',
    client
  )
}

it.each(['{"error":"invalid_session"}', 'Incorrect session key'])(
  'refreshes once and replays when the game rejects the session with a 500 (%s)',
  async (body) => {
    const events = wireTo((event, url) => {
      if (event === 'CONNECT') return Response.json({ sessionId: NEW_SESSION })
      if (url.endsWith(`/sessionId/${OLD_SESSION}`))
        return new Response(body, { status: 500 })
      return Response.json(guildView)
    })
    const { client, updates, chain } = database()

    const result = await fetchMembers(client)

    expect(result.authFailed).toBe(false)
    expect(result.members.map((m) => m.userId)).toEqual(['synthetic-member'])
    // The rejected session is not tried again before the refresh.
    expect(events.map((e) => e.event)).toEqual([
      'VIEW_GUILD_2',
      'CONNECT',
      'VIEW_GUILD_2'
    ])
    expect(events[2]?.url).toContain(`/sessionId/${NEW_SESSION}`)
    expect(updates).toContainEqual(
      expect.objectContaining({ session_id: NEW_SESSION })
    )
    // The refreshed session lands only on a row its minting account owns.
    expect(chain.eq).toHaveBeenCalledWith('guild_code', 'SYNTH')
    expect(chain.or).toHaveBeenCalledWith(
      'user_id.is.null,user_id.eq.synthetic-user'
    )
  }
)

it('makes one call and no CONNECT when a 5xx carries no session error', async () => {
  const events = wireTo(() => new Response('upstream down', { status: 503 }))
  const { client, updates } = database()

  const result = await fetchMembers(client)

  expect(result).toEqual({ members: [], authFailed: false })
  expect(events.map((e) => e.event)).toEqual(['VIEW_GUILD_2'])
  expect(updates).toEqual([])
})
