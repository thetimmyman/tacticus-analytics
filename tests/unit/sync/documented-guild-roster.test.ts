import { afterEach, expect, it, vi } from 'vitest'
import { fetchGuildMembersViaTacticus } from '@/app/lib/sync/tacticus-api'
import { logger } from '@/app/lib/sync/api-client'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const payload = {
  guild: {
    guildId: 'synthetic-target',
    members: [{ userId: 'synthetic-a' }, { userId: 'synthetic-b' }]
  }
}

it('gets membership from the documented key-owner guild endpoint exactly once', async () => {
  const send = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json(payload)
  )
  vi.stubGlobal('fetch', send)
  expect(
    await fetchGuildMembersViaTacticus(
      'synthetic-key',
      'synthetic-target',
      'SYNTHETIC'
    )
  ).toMatchObject({
    success: true,
    memberIds: ['synthetic-a', 'synthetic-b']
  })
  expect(send).toHaveBeenCalledTimes(1)
  expect(new URL(String(send.mock.calls[0]?.[0])).pathname).toBe(
    '/api/v1/guild'
  )
})

it.each([
  {
    guild: { guildId: 'synthetic-other', members: [{ userId: 'synthetic-a' }] }
  },
  { guild: { members: [{ userId: 'synthetic-a' }] } },
  {
    guild: {
      guildId: 'synthetic-target',
      members: [{ userId: 'synthetic-a' }, null]
    }
  },
  { guild: { guildId: 'synthetic-target', members: [] } },
  {
    guild: {
      guildId: 'synthetic-target',
      members: [{ userId: 'synthetic-a' }, { userId: 'synthetic-a' }]
    }
  },
  null
])(
  'does not assert partial or cross-guild membership, or retry an invalid response',
  async (served) => {
    const send = vi.fn(async () => Response.json(served))
    vi.stubGlobal('fetch', send)
    expect(
      await fetchGuildMembersViaTacticus(
        'synthetic-key',
        'synthetic-target',
        'SYNTHETIC'
      )
    ).toMatchObject({
      success: false,
      memberIds: []
    })
    expect(send).toHaveBeenCalledTimes(1)
  }
)

it('releases an unread throttle body without another attempt', async () => {
  const cancel = vi.fn()
  const send = vi.fn(
    async () =>
      new Response(new ReadableStream({ cancel }), {
        status: 429,
        headers: { 'Retry-After': '7200' }
      })
  )
  vi.stubGlobal('fetch', send)
  expect(
    await fetchGuildMembersViaTacticus(
      'synthetic-key',
      'synthetic-target',
      'SYNTHETIC'
    )
  ).toMatchObject({ success: false, error: 'HTTP 429' })
  expect(send).toHaveBeenCalledTimes(1)
  expect(cancel).toHaveBeenCalledTimes(1)
})

it.each(['pending', 'rejected'])(
  'returns the throttle result when body cancellation is %s',
  async (cleanup) => {
    const cancel = vi.fn(() =>
      cleanup === 'pending'
        ? new Promise<void>(() => {})
        : Promise.reject(new Error('synthetic cleanup failure'))
    )
    const send = vi.fn(
      async () => new Response(new ReadableStream({ cancel }), { status: 429 })
    )
    vi.stubGlobal('fetch', send)
    expect(
      await fetchGuildMembersViaTacticus(
        'synthetic-key',
        'synthetic-target',
        'SYNTHETIC'
      )
    ).toMatchObject({ success: false, error: 'HTTP 429' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  },
  1000
)

it('keeps malformed response content out of results and logs', async () => {
  const privateText = 'synthetic-private-roster-response'
  const warn = vi.spyOn(logger, 'warn')
  const response = new Response(null)
  vi.spyOn(response, 'json').mockRejectedValue(new SyntaxError(privateText))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response)
  )
  const result = await fetchGuildMembersViaTacticus(
    'synthetic-key',
    'synthetic-target',
    'SYNTHETIC'
  )
  expect(result.success).toBe(false)
  expect(JSON.stringify(result)).not.toContain(privateText)
  expect(JSON.stringify(warn.mock.calls)).not.toContain(privateText)
})
