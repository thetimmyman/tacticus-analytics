import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A working key for a DIFFERENT account is rejected. The witness comes from a column the caller
 * cannot write (`display_name` is caller-writable); anything unverifiable fails closed.
 */
describe('POST /api/player-api-key — possession check', () => {
  let POST: (request: unknown) => Promise<Response>
  let mockTacticusAPI: { getPlayer: ReturnType<typeof vi.fn> }
  let mockPersist: ReturnType<typeof vi.fn>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  type RosterRow = {
    id: number
    player_id: string
    original_display_name: string | null
    has_duplicate_name: boolean
  }

  const ROSTER: RosterRow = {
    id: 1,
    player_id: 'p-1',
    original_display_name: null,
    has_duplicate_name: false
  }

  const request = (apiKey = 'a-working-key') =>
    ({ json: async () => ({ apiKey }) }) as unknown

  /** Roster and witness come from separate sources. */
  function setRosterRow(
    row: RosterRow | null,
    syncedName?: string | null
  ): void {
    mockSupabase.from.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = vi.fn(() => chain)
      chain.eq = vi.fn(() => chain)
      chain.order = vi.fn(() => chain)
      chain.limit = vi.fn(() => chain)
      if (table === 'EOT_GR_data') {
        chain.maybeSingle = vi.fn(async () => ({
          data: syncedName ? { displayName: syncedName } : null,
          error: null
        }))
        return chain
      }
      chain.single = vi.fn(async () => ({
        data: row,
        error: row ? null : { code: 'PGRST116' }
      }))
      return chain
    })
  }

  beforeEach(async () => {
    vi.resetModules()

    mockTacticusAPI = {
      getPlayer: vi.fn(),
      getCurrentGuildRaid: vi.fn().mockResolvedValue(null)
    }
    mockPersist = vi.fn().mockResolvedValue({ ok: true })
    mockSupabase = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
      },
      from: vi.fn()
    }

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: vi.fn(async () => mockSupabase),
      createServiceClient: () => mockSupabase
    }))
    vi.doMock('@/app/lib/auth/user-bans', () => ({
      findActiveBanForAuthUser: vi.fn(async () => null)
    }))
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI
    }))
    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: vi.fn(async () => ({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildName: 'TU' }
      })),
      logApiKeyOperation: vi.fn()
    }))
    vi.doMock('@/app/lib/profile/persist-player-api-key', () => ({
      persistPlayerApiKey: mockPersist
    }))

    const mod = await import('@/app/api/player-api-key/route')
    POST = mod.POST as unknown as (request: unknown) => Promise<Response>
  })

  it('tells a guild-mover about the reweave corridor instead of accusing them', async () => {
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'SomeoneElse', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(JSON.stringify(body)).toContain('POSSESSION_NAME_MISMATCH')
    expect(JSON.stringify(body)).toContain('Change player account')
  })

  it('accepts a privacy-aliased account via raid-entry user-id corroboration', async () => {
    // Raid rows pairing player_id with the key's name attest possession despite a privacy alias.
    setRosterRow({ ...ROSTER, player_id: '0a0b0c0d-0ef0' }, 'Player#0A0B0C')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'TestPlayerB', powerLevel: 100 }
    })
    mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
      season: 11,
      seasonConfigId: 'c',
      entries: [
        {
          userId: '0a0b0c0d-0ef0',
          username: 'TestPlayerB',
          damageType: 'Battle',
          startedOn: 1,
          completedOn: 2,
          unitId: 'u',
          damageDealt: 3,
          encounterType: 'GR',
          tier: 1,
          set: 1
        },
        {
          userId: 'p-other',
          username: 'SomeoneElse',
          damageType: 'Bomb',
          startedOn: 1,
          completedOn: 2,
          unitId: 'u',
          damageDealt: 1,
          encounterType: 'GR',
          tier: 1,
          set: 1
        }
      ]
    })

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(mockPersist).toHaveBeenCalledTimes(1)
  })

  it('rejects a probing key even when a raid entry exists for a co-member', async () => {
    setRosterRow(ROSTER, 'TheRealOwner')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'SomeoneElse', powerLevel: 100 }
    })
    mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
      season: 11,
      seasonConfigId: 'c',
      entries: [
        {
          userId: 'p-other',
          username: 'SomeoneElse',
          damageType: 'Battle',
          startedOn: 1,
          completedOn: 2,
          unitId: 'u',
          damageDealt: 1,
          encounterType: 'GR',
          tier: 1,
          set: 1
        }
      ]
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toContain(
      'POSSESSION_NAME_MISMATCH'
    )
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('rejects a same-userId but name-divergent raid row', async () => {
    // A differing upstream name is a rename signal, not evidence.
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'SomeoneElse', powerLevel: 100 }
    })
    mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
      season: 11,
      seasonConfigId: 'c',
      entries: [
        {
          userId: 'p-1',
          username: 'TestPlayerA【TG】',
          damageType: 'Battle',
          startedOn: 1,
          completedOn: 2,
          unitId: 'u',
          damageDealt: 1,
          encounterType: 'GR',
          tier: 1,
          set: 1
        }
      ]
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('still fails closed when the raid corroboration upstream call throws', async () => {
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'SomeoneElse', powerLevel: 100 }
    })
    mockTacticusAPI.getCurrentGuildRaid.mockRejectedValue(new Error('ra down'))

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('rejects a key that opens a different account, and never persists it', async () => {
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'SomeoneElse', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toContain(
      'POSSESSION_NAME_MISMATCH'
    )
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('accepts a key whose account matches the sync-owned name', async () => {
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'TestPlayerA【TG】', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(mockPersist).toHaveBeenCalledTimes(1)
  })

  it('does not accept a name the caller could have written themselves', async () => {
    setRosterRow({ ...ROSTER, original_display_name: null }, 'TheRealOwner')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'SomeoneElse', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('falls back to original_display_name when no synced rows exist', async () => {
    // Not in the authenticated UPDATE grant, so still a valid witness.
    setRosterRow(
      { ...ROSTER, original_display_name: 'TestPlayerA【TG】' },
      null
    )
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'TestPlayerA【TG】', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(200)
    expect(mockPersist).toHaveBeenCalledTimes(1)
  })

  it('refuses to guess when the roster name is duplicated', async () => {
    // Duplicate names share the raw original_display_name, so it identifies nobody.
    setRosterRow({ ...ROSTER, has_duplicate_name: true }, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'TestPlayerA【TG】', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toContain(
      'POSSESSION_NAME_AMBIGUOUS'
    )
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('is case-sensitive, so same-guild case variants cannot pass', async () => {
    setRosterRow(ROSTER, 'Bob')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'bob', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(403)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('fails closed when the identity lookup throws', async () => {
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockRejectedValue(new Error('upstream down'))

    const res = await POST(request())

    expect(res.status).toBe(502)
    expect(JSON.stringify(await res.json())).toContain('PLAYER_LOOKUP_FAILED')
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('fails closed when the upstream returns no player name', async () => {
    setRosterRow(ROSTER, 'TestPlayerA【TG】')
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(502)
    expect(mockPersist).not.toHaveBeenCalled()
  })

  it('fails closed when no non-writable witness exists at all', async () => {
    setRosterRow({ ...ROSTER, original_display_name: null }, null)
    mockTacticusAPI.getPlayer.mockResolvedValue({
      details: { name: 'TestPlayerA【TG】', powerLevel: 100 }
    })

    const res = await POST(request())

    expect(res.status).toBe(502)
    expect(mockPersist).not.toHaveBeenCalled()
  })
})
