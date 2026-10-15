import { afterEach, expect, it, vi } from 'vitest'
import { fetchGuildMembersViaTacticus } from '@/app/lib/sync/tacticus-api'
import { logger } from '@/app/lib/sync/api-client'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { autoPatchGuildConfig } from '@/app/lib/sync/guild-config-discovery'
import { detectCurrentGWSeasonFromGuildData } from '@/app/lib/sync/loki-guild-api'

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

it('reuses a supplied authorized guild response without any extra request', async () => {
  const send = vi.fn(async () => Response.json(payload))
  vi.stubGlobal('fetch', send)
  expect(
    await fetchGuildMembersViaTacticus(
      'synthetic-key',
      'synthetic-target',
      'SYNTHETIC',
      payload
    )
  ).toMatchObject({
    success: true,
    memberIds: ['synthetic-a', 'synthetic-b']
  })
  expect(send).not.toHaveBeenCalled()
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
  null
])(
  'does not assert partial or cross-guild membership, or retry a supplied invalid response',
  async (supplied) => {
    const send = vi.fn(async () => Response.json(payload))
    vi.stubGlobal('fetch', send)
    expect(
      await fetchGuildMembersViaTacticus(
        'synthetic-key',
        'synthetic-target',
        'SYNTHETIC',
        supplied
      )
    ).toMatchObject({
      success: false,
      memberIds: []
    })
    expect(send).not.toHaveBeenCalled()
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

it('shares the validation response with discovery, season detection and membership in the same operation', async () => {
  const snapshot = { ...payload, currentGuildWarSeason: 42 }
  const send = vi.fn(async (input: RequestInfo | URL) =>
    Response.json(
      new URL(String(input)).pathname.endsWith('/guild')
        ? snapshot
        : { entries: [] }
    )
  )
  vi.stubGlobal('fetch', send)
  let captured: unknown
  const validation = await validateApiKeyWithTacticus(
    'synthetic-valid-guild-api-key',
    false,
    {
      onGuildResponse: (value) => {
        captured = value
      }
    }
  )
  expect(validation.isValid).toBe(true)
  expect(validation).not.toHaveProperty('guildPayload')
  expect(validation.guildInfo).not.toHaveProperty('members')
  const chain = {
    select() {
      return this
    },
    eq() {
      return this
    },
    single: async () => ({
      data: { guild_id: 'synthetic-target', guild_tag: null },
      error: null
    })
  }
  const supabase = { from: () => chain }
  await autoPatchGuildConfig(
    supabase as never,
    'SYNTHETIC',
    'synthetic-valid-guild-api-key',
    { guildPayload: captured }
  )
  expect(
    await detectCurrentGWSeasonFromGuildData(
      'SYNTHETIC',
      'synthetic-valid-guild-api-key',
      captured
    )
  ).toBe(42)
  expect(
    await fetchGuildMembersViaTacticus(
      'synthetic-valid-guild-api-key',
      'synthetic-target',
      'SYNTHETIC',
      captured
    )
  ).toMatchObject({ success: true })
  expect(
    send.mock.calls.map(([input]) => new URL(String(input)).pathname)
  ).toEqual(['/api/v1/guild', '/api/v1/guildRaid'])
})
