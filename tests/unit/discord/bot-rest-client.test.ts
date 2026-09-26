import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __clearBotRestBuckets,
  getDiscordChannel,
  getDiscordChannelMessages,
  getGuildMemberRoleSnapshot,
  removeGuildMemberRole
} from '@/app/lib/discord/bot-rest-client'

describe('discord bot REST read helpers', () => {
  beforeEach(() => {
    process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
    __clearBotRestBuckets()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.DISCORD_BOT_TOKEN
  })

  it('fetches channel metadata and message previews with GET only', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/messages?limit=1')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: '200000000000000000' }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: '100000000000000001',
            type: 15,
            name: 'test-forum'
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const channel = await getDiscordChannel('100000000000000001')
    const messages = await getDiscordChannelMessages('100000000000000001')

    expect(channel).toMatchObject({
      ok: true,
      status: 200,
      body: { type: 15, name: 'test-forum' }
    })
    expect(messages).toMatchObject({
      ok: true,
      status: 200,
      body: [{ id: '200000000000000000' }]
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      'GET',
      'GET'
    ])
  })

  it('preserves the Discord error code needed to prove an absent member', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: 10007, message: 'Unknown Member' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
    )

    await expect(
      getGuildMemberRoleSnapshot('111111111111111111', '222222222222222222')
    ).resolves.toEqual({
      ok: false,
      status: 404,
      body: null,
      errorCode: 10007
    })
  })

  it('issues an exact role DELETE with a Discord audit-log reason', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      removeGuildMemberRole(
        '111111111111111111',
        '222222222222222222',
        '333333333333333333',
        { reason: 'bounded role cleanup task' }
      )
    ).resolves.toEqual({ ok: true, status: 204, errorCode: null })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/111111111111111111/members/222222222222222222/roles/333333333333333333',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'X-Audit-Log-Reason': 'bounded%20role%20cleanup%20task'
        })
      })
    )
  })

  it('lets cleanup fail/retry instead of sleeping past its rate-limit budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 20028,
          message: 'rate limited',
          retry_after: 10
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      removeGuildMemberRole(
        '111111111111111111',
        '222222222222222222',
        '333333333333333333',
        { maxRateLimitWaitMs: 50 }
      )
    ).resolves.toEqual({ ok: false, status: 429, errorCode: 20028 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
