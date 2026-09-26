import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

// The real requireGuildOfficerOrClusterLeader, so the cross-guild 403 path is genuinely covered.

let mockDb: ReturnType<typeof vi.fn>

interface ProfileRow {
  role: string | null
  guild_code: string | null
  display_name: string | null
}

describe('POST /api/season-config/skip-prime', () => {
  let POST: (req: NextRequest) => Promise<Response>

  let updateSpy: ReturnType<typeof vi.fn>
  let insertSpy: ReturnType<typeof vi.fn>

  const buildSupabase = ({
    user = { id: 'user-123' } as { id: string } | null,
    profile = {
      role: 'leader',
      guild_code: 'AAAA',
      display_name: 'Boss'
    } as ProfileRow | null,
    profileError = null as unknown,
    existingRow = {
      id: 'row-1',
      sub_bosses: { sub1: 'X', target_tokens: 10 },
      boss_name: 'Magnus'
    } as Record<string, unknown> | null,
    lookupError = null as unknown,
    updateError = null as unknown,
    insertError = null as unknown,
    guildConfigRows = [] as Array<{ guild_code: string; cluster_code: string }>
  } = {}) => {
    updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: updateError ? null : [{ id: 'row-1' }],
          error: updateError
        })
      })
    })
    insertSpy = vi.fn().mockResolvedValue({ error: insertError })

    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user } })
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: profile, error: profileError })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi
              .fn()
              .mockResolvedValue({ data: guildConfigRows, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: existingRow ? [existingRow] : [],
            error: lookupError
          }),
          update: updateSpy,
          insert: insertSpy
        }
      })
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    vi.doMock('@/app/lib/db', () => ({ db: mockDb }))

    mockDb.mockResolvedValue(buildSupabase())

    const mod = await import('@/app/api/season-config/skip-prime/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makeRequest = (body: unknown) =>
    new NextRequest('http://localhost/api/season-config/skip-prime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  const validBody = {
    guild_code: 'AAAA',
    season_number: '5',
    level: 'L4',
    sub_index: 1,
    skip: true
  }

  it('returns 401 when unauthenticated', async () => {
    mockDb.mockResolvedValue(buildSupabase({ user: null }))
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(401)
  })

  it('returns 400 when the body is invalid (bad level)', async () => {
    const res = await POST(makeRequest({ ...validBody, level: 'ZZ' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when sub_index is out of range', async () => {
    const res = await POST(makeRequest({ ...validBody, sub_index: 9 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when guild_code is missing', async () => {
    const res = await POST(
      makeRequest({ season_number: '5', level: 'L4', sub_index: 1, skip: true })
    )
    expect(res.status).toBe(400)
  })

  it('GUILD-OWNERSHIP 403: a member of another guild cannot mutate this guild config', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'officer', guild_code: 'BBBB', display_name: 'Other' }
      })
    )
    const res = await POST(makeRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error.message).toContain('officer/leader')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('GUILD-OWNERSHIP 403: a plain member (no officer role) of the SAME guild cannot mutate', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'member', guild_code: 'AAAA', display_name: 'Grunt' }
      })
    )
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(403)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller has no current guild membership', async () => {
    mockDb.mockResolvedValue(buildSupabase({ profile: null }))
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(403)
  })

  it('SUCCESS: an officer of the target guild updates the existing row, merging only the skip flag', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'officer', guild_code: 'AAAA', display_name: 'Boss' }
      })
    )
    const res = await POST(makeRequest(validBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const payload = updateSpy.mock.calls[0][0]
    expect(payload.sub_bosses.sub1_skip).toBe(true)
    expect(payload.sub_bosses.sub1).toBe('X')
    expect(payload.sub_bosses.target_tokens).toBe(10)
    expect(payload.selected_by).toBe('user-123')
  })

  it('SUCCESS (cluster leader): leader of a peer guild in the same cluster may mutate', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'leader', guild_code: 'BBBB', display_name: 'CL' },
        guildConfigRows: [
          { guild_code: 'BBBB', cluster_code: 'CL1' },
          { guild_code: 'AAAA', cluster_code: 'CL1' }
        ]
      })
    )
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledTimes(1)
  })

  it('SUCCESS (insert branch): officer with no existing planner row inserts a sentinel row', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'officer', guild_code: 'AAAA', display_name: 'Boss' },
        existingRow: null
      })
    )
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    const inserted = insertSpy.mock.calls[0][0]
    expect(inserted.sub_bosses.sub1_skip).toBe(true)
    expect(inserted.boss_name).toBe('__pending__')
  })

  it('returns 500 when the planner-row update fails', async () => {
    mockDb.mockResolvedValue(
      buildSupabase({
        profile: { role: 'officer', guild_code: 'AAAA', display_name: 'Boss' },
        updateError: { message: 'permission denied' }
      })
    )
    const res = await POST(makeRequest(validBody))
    expect(res.status).toBe(500)
  })
})
