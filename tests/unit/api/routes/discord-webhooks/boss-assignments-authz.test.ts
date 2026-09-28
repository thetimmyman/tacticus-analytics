// Only db, formatter and poster are mocked, so a 403 proves the route's own cross-guild guard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockDb: ReturnType<typeof vi.fn>
let mockFormatBossAssignmentEmbed: ReturnType<typeof vi.fn>
let mockPostToWebhook: ReturnType<typeof vi.fn>
let mockLogDiscordWebhookDelivery: ReturnType<typeof vi.fn>
let mockLoadWebhookUrlById: ReturnType<typeof vi.fn>
const webhookId = '10000000-0000-4000-8000-000000000001'
const webhookUrl = 'https://discord.com/api/webhooks/1001/test-token'

const makeQuery = (result: { data: unknown; error: unknown }) => {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const m of ['select', 'eq', 'is', 'not', 'order', 'update']) {
    builder[m] = vi.fn(chain)
  }
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.limit = vi.fn().mockResolvedValue(result)
  return builder
}

describe('POST /api/discord-webhooks/boss-assignments — leader cross-guild authz', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    mockFormatBossAssignmentEmbed = vi.fn().mockReturnValue({ embeds: [] })
    mockPostToWebhook = vi.fn().mockResolvedValue({ ok: true })
    mockLogDiscordWebhookDelivery = vi.fn()
    mockLoadWebhookUrlById = vi.fn().mockResolvedValue(webhookUrl)
    vi.doMock('@/app/lib/webhooks/webhook-url-lookup', () => ({
      loadWebhookUrlById: mockLoadWebhookUrlById
    }))

    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))
    vi.doMock('@/app/lib/discord/formatters', () => ({
      formatBossAssignmentEmbed: mockFormatBossAssignmentEmbed
    }))
    vi.doMock('@/app/lib/discord/webhook-service', () => ({
      postToWebhook: mockPostToWebhook,
      logDiscordWebhookDelivery: mockLogDiscordWebhookDelivery
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }
    mockDb.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/discord-webhooks/boss-assignments/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) =>
    new NextRequest('http://localhost/api/discord-webhooks/boss-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  const assignment = { tier: 'T1', boss_name: 'Boss', boss_code: 'BOSS' }

  /** First `player_mapping` call is the caller's profile, later ones the target membership. */
  const wireTables = (opts: {
    profile: { role: string; guild_code: string | null }
    targetMembership?: { guild_code: string }[] | null
    callerCluster?: { id: number } | null
    guildWebhook?: { webhook_url: string } | null
    clusterRow?: { id: number; display_name: string } | null
    clusterWebhook?: { webhook_url: string } | null
  }) => {
    let playerMappingCalls = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        playerMappingCalls += 1
        if (playerMappingCalls === 1) {
          return makeQuery({ data: opts.profile, error: null })
        }
        return makeQuery({ data: opts.targetMembership ?? null, error: null })
      }
      if (table === 'clusters') {
        // Both the guard and webhook discovery read `clusters` via .single().
        return makeQuery({
          data: opts.clusterRow ?? opts.callerCluster ?? null,
          error: null
        })
      }
      if (table === 'webhook_config') {
        return makeQuery({
          data: opts.guildWebhook ?? opts.clusterWebhook ?? null,
          error: null
        })
      }
      return makeQuery({ data: null, error: null })
    })
  }

  it('403: officer posting to a FOREIGN guild', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-officer' } }
    })
    wireTables({ profile: { role: 'officer', guild_code: 'HOME' } })

    const res = await POST(
      createRequest({ assignments: [assignment], guild_code: 'OTHER' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toContain(
      'Officers can only post assignments for their own guild'
    )
    expect(mockPostToWebhook).not.toHaveBeenCalled()
  })

  it('403: leader posting cross-guild with NO cluster_code', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-leader' } }
    })
    wireTables({ profile: { role: 'leader', guild_code: 'HOME' } })

    const res = await POST(
      createRequest({ assignments: [assignment], guild_code: 'OTHER' })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toContain(
      'Cross-guild posting requires a cluster context'
    )
    expect(mockPostToWebhook).not.toHaveBeenCalled()
  })

  it('403: leader posting to a guild NOT in their cluster', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-leader' } }
    })
    wireTables({
      profile: { role: 'leader', guild_code: 'HOME' },
      targetMembership: [], // target guild is empty -> not in cluster
      callerCluster: null
    })

    const res = await POST(
      createRequest({
        assignments: [assignment],
        guild_code: 'OTHER',
        cluster_code: 'EOT'
      })
    )
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.message).toContain('Target guild is not in your cluster')
    expect(mockPostToWebhook).not.toHaveBeenCalled()
  })

  it('200: leader posting cross-guild with VALID cluster membership', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u-leader' } }
    })
    let playerMappingCalls = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        playerMappingCalls += 1
        if (playerMappingCalls === 1) {
          return makeQuery({
            data: { role: 'leader', guild_code: 'HOME' },
            error: null
          })
        }
        return makeQuery({ data: [{ guild_code: 'OTHER' }], error: null })
      }
      if (table === 'clusters') {
        return makeQuery({
          data: { id: 7, display_name: 'EOT Cluster' },
          error: null
        })
      }
      if (table === 'webhook_config') {
        return makeQuery({
          data: { id: webhookId },
          error: null
        })
      }
      return makeQuery({ data: null, error: null })
    })

    const res = await POST(
      createRequest({
        assignments: [assignment],
        guild_code: 'OTHER',
        cluster_code: 'EOT'
      })
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    // Posts to both channels: authz passed.
    expect(body.webhooks_sent).toBe(2)
    expect(body.webhooks_failed).toBe(0)
    expect(mockPostToWebhook).toHaveBeenCalledTimes(2)
    expect(mockLoadWebhookUrlById).toHaveBeenCalledTimes(2)
    expect(mockLoadWebhookUrlById).toHaveBeenCalledWith(webhookId)
    expect(mockPostToWebhook).toHaveBeenCalledWith(
      webhookUrl,
      expect.anything(),
      expect.anything()
    )
    const webhookQueries = mockSupabase.from.mock.calls.flatMap(
      ([table], index) =>
        table === 'webhook_config'
          ? [mockSupabase.from.mock.results[index].value]
          : []
    )
    expect(
      webhookQueries.filter((query) => query.select.mock.calls.length)
    ).toHaveLength(2)
    for (const query of webhookQueries) {
      if (query.select.mock.calls.length > 0) {
        expect(query.select).toHaveBeenCalledWith('id')
      }
    }
    const postedGuildCodes = mockPostToWebhook.mock.calls.map(
      (call) => (call[2] as { guildCode?: string })?.guildCode
    )
    expect(postedGuildCodes).toContain('OTHER')
  })
})
