import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

const requireActiveMembershipForApi = vi.fn()
const serviceDb = vi.fn()

describe('GET /api/sync/freshness', () => {
  let GET: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireActiveMembershipForApi
    }))
    vi.doMock('@/app/lib/db', () => ({ serviceDb }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))
    ;({ GET } = await import('@/app/api/sync/freshness/route'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves inactive-membership AuthError before any service-role read', async () => {
    requireActiveMembershipForApi.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/sync/freshness')
    )

    expect(response.status).toBe(403)
    expect(serviceDb).not.toHaveBeenCalled()
  })

  it('keeps the active no-guild response private and avoids service-role access', async () => {
    requireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: null, role: 'member' }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/sync/freshness')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      feeds: [],
      guildCode: null,
      reason: 'no-guild'
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(serviceDb).not.toHaveBeenCalled()
  })

  /** The manual sync button stamps last_sync before any work, so it cannot date the last ingest. */
  function mockGuildRow(row: {
    last_successful_sync: string | null
    realtime_sync?: boolean
    sync_tier?: string | null
  }) {
    const seen: { tables: string[]; columns: string[] } = {
      tables: [],
      columns: []
    }
    serviceDb.mockReturnValue({
      from(table: string) {
        seen.tables.push(table)
        const chain: Record<string, unknown> = {
          select(columns: string) {
            seen.columns.push(columns)
            return chain
          },
          eq: () => chain,
          maybeSingle: async () => ({ data: row, error: null })
        }
        return chain
      }
    })
    requireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'GUILD', role: 'member' }
    })
    return seen
  }

  it('takes the age from the success clock, never from the attempt clock', async () => {
    const seen = mockGuildRow({
      last_successful_sync: new Date(Date.now() - 45 * 60_000).toISOString()
    })

    const response = await GET(
      new NextRequest('http://localhost/api/sync/freshness')
    )
    const body = await response.json()

    expect(seen.tables).toEqual(['guild_config'])
    expect(seen.tables).not.toContain('guild_sync_status')
    expect(seen.columns.join()).toContain('last_successful_sync')
    expect(body.feeds[0].ageSeconds).toBeGreaterThanOrEqual(45 * 60 - 5)
  })

  it('judges the age against the guild tier, not the shared cron interval', async () => {
    // Graded on the hourly tier, not the five-minute cron.
    const hourly = mockGuildRow({
      last_successful_sync: new Date(Date.now() - 45 * 60_000).toISOString(),
      sync_tier: 'active'
    })
    let body = await (
      await GET(new NextRequest('http://localhost/api/sync/freshness'))
    ).json()

    expect(hourly.columns.join()).toContain('sync_tier')
    expect(body.feeds[0].cadenceSeconds).toBe(3600)
    expect(body.feeds[0].status).toBe('current')

    mockGuildRow({
      last_successful_sync: new Date(Date.now() - 45 * 60_000).toISOString(),
      realtime_sync: true
    })
    body = await (
      await GET(new NextRequest('http://localhost/api/sync/freshness'))
    ).json()

    expect(body.feeds[0].cadenceSeconds).toBe(90)
    expect(body.feeds[0].status).toBe('overdue')
  })

  it('reports a guild that has never had a successful sync as never', async () => {
    mockGuildRow({ last_successful_sync: null })

    const body = await (
      await GET(new NextRequest('http://localhost/api/sync/freshness'))
    ).json()

    expect(body.feeds[0].ageSeconds).toBeNull()
    expect(body.feeds[0].status).toBe('never')
    expect(body.feeds[0].ageLabel).toBe('never')
  })
})
