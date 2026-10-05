import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ normalize: vi.fn() }))
vi.mock('@/app/lib/desktop/raid-file', () => ({
  normalizeRaidFile: mocks.normalize
}))
import { POST } from '@/app/api/desktop/normalize-raid-file/route'
let secret: string
beforeEach(() => {
  vi.clearAllMocks()
  secret = randomBytes(32).toString('hex')
  vi.stubEnv('CRON_SECRET', secret)
  vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
  mocks.normalize.mockReturnValue([{ damageDealt: 250 }])
})
afterEach(() => vi.unstubAllEnvs())
const payload = () => ({
  contents: 'synthetic file',
  context: {
    guildCode: 'SYN001',
    playerMappings: [['synthetic-player', 'Synthetic Player']],
    bossMappings: {},
    clusterCode: null,
    clusterId: null
  }
})
const request = (body: unknown, authorization?: string) =>
  new NextRequest('http://127.0.0.1:1234/api/desktop/normalize-raid-file', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {})
    },
    body: JSON.stringify(body)
  })
describe('desktop internal normalization boundary', () => {
  it.each([undefined, 'Bearer invalid', 'Bearer é'])(
    'rejects unauthorized renderer calls before parsing their file',
    async (authorization) => {
      const response = await POST(request(payload(), authorization))
      expect(response.status).toBe(401)
      expect(mocks.normalize).not.toHaveBeenCalled()
    }
  )
  it('does not activate in hosted mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'hosted')
    expect((await POST(request(payload(), `Bearer ${secret}`))).status).toBe(
      404
    )
    expect(mocks.normalize).not.toHaveBeenCalled()
  })
  it('permits only the fixed normalization operation with validated context', async () => {
    const response = await POST(request(payload(), `Bearer ${secret}`))
    expect(response.status).toBe(200)
    expect(mocks.normalize).toHaveBeenCalledWith('synthetic file', {
      ...payload().context,
      playerMappings: new Map([['synthetic-player', 'Synthetic Player']])
    })
    expect(await response.json()).toEqual({ rows: [{ damageDealt: 250 }] })
  })
  it('rejects arbitrary operation, destination or identity overrides without echoing input', async () => {
    const sentinel = randomBytes(32).toString('hex')
    for (const body of [
      { ...payload(), url: sentinel },
      { ...payload(), context: { ...payload().context, subject: sentinel } },
      {
        ...payload(),
        context: { ...payload().context, playerMappings: [[sentinel, 42]] }
      }
    ]) {
      const response = await POST(request(body, `Bearer ${secret}`))
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).not.toContain(sentinel)
    }
    expect(mocks.normalize).not.toHaveBeenCalled()
  })
  it('redacts transformer failures', async () => {
    const sentinel = randomBytes(32).toString('hex')
    mocks.normalize.mockImplementation(() => {
      throw new Error(sentinel)
    })
    const response = await POST(request(payload(), `Bearer ${secret}`))
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).not.toContain(sentinel)
  })
})
