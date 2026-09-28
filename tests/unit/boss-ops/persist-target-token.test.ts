/** Token-only writers omit `skip`, so a token edit cannot un-skip a prime. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveTargetToken } from '@/app/lib/boss-ops/persist-target-token'

let calls: Array<{
  url: string
  method: string
  body: Record<string, unknown>
}> = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: String(init?.method ?? 'GET').toUpperCase(),
        body: JSON.parse(String(init?.body ?? '{}'))
      })
      return new Response(JSON.stringify({ row: {} }), { status: 200 })
    })
  )
})
afterEach(() => vi.unstubAllGlobals())

const INPUT = {
  bossType: 'Magnus',
  rarity: 'Mythic' as const,
  set: 1,
  encounterId: 1 as const,
  targetTokens: 4,
  seasonNumber: '103'
}

describe('saveTargetToken skip handling (D5)', () => {
  it('OMITS skip from the body when the caller did not decide it', async () => {
    await saveTargetToken(INPUT)
    const put = calls[0]!
    expect(put.method).toBe('PUT')
    // The writer must omit `skip` deliberately, not via JSON.stringify dropping undefined.
    expect(put.body).not.toHaveProperty('skip')
    expect(put.body.target_tokens).toBe(4)
    expect(put.body.season_number).toBe('103')
  })

  it('sends an explicit skip when the caller decided it (C10)', async () => {
    await saveTargetToken({ ...INPUT, skip: true })
    expect(calls[0]!.body.skip).toBe(true)

    calls = []
    await saveTargetToken({ ...INPUT, skip: false })
    expect(calls[0]!.body.skip).toBe(false)
  })

  it('still refuses a main-boss skip client-side', async () => {
    await expect(
      saveTargetToken({ ...INPUT, encounterId: 0, skip: true })
    ).rejects.toThrow(/main boss/i)
    expect(calls).toEqual([])
  })

  it('scopes the write with the guild_code query param when given', async () => {
    await saveTargetToken({ ...INPUT, guildCode: 'PEERGUILD' })
    expect(calls[0]!.url).toContain('guild_code=PEERGUILD')
  })
})

describe('saveTargetToken error passthrough (review F4)', () => {
  const respondWith = (status: number, body: string) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status }))
    )
  }

  it('surfaces the AppError-envelope message from a 403', async () => {
    const serverText =
      'Not authorized to write target tokens for guild PEERGUILD. ...'
    respondWith(
      403,
      JSON.stringify({ error: { code: 'FORBIDDEN', message: serverText } })
    )
    const err = await saveTargetToken(INPUT).catch((e) => e)
    expect(err.status).toBe(403)
    expect(err.message).toBe(serverText)
  })

  it('falls back to the generic 403 string when the body is not JSON', async () => {
    respondWith(403, 'Forbidden')
    const err = await saveTargetToken(INPUT).catch((e) => e)
    expect(err.status).toBe(403)
    expect(err.message).toBe(
      'You must be an officer or leader of this guild to set targets'
    )
  })

  it('surfaces a flat { error: string } body on other statuses', async () => {
    respondWith(500, JSON.stringify({ error: 'sub_bosses merge failed' }))
    const err = await saveTargetToken(INPUT).catch((e) => e)
    expect(err.status).toBe(500)
    expect(err.message).toBe('sub_bosses merge failed')
  })

  it('falls back to the generic string on a shapeless JSON body', async () => {
    respondWith(500, JSON.stringify({ ok: false }))
    const err = await saveTargetToken(INPUT).catch((e) => e)
    expect(err.message).toBe('Failed to save target')
  })
})
