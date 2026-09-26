import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const SUBJECT = '00000000-0000-4000-8000-000000000003'
const PLAYER_ID = '00000000-0000-4000-8000-000000000005'
let mockAuthed: { auth: { getUser: ReturnType<typeof vi.fn> } }
let mockService: {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}
let mockGetPlayer: ReturnType<typeof vi.fn>
let queues: Record<string, Array<{ data: unknown; error: unknown }>>

function unclaimed(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    player_id: PLAYER_ID,
    display_name: 'ClaimPlayer',
    original_display_name: null,
    has_duplicate_name: false,
    user_id: null,
    ownership_attestation_id: null,
    role: 'leader',
    is_app_admin: false,
    updated_at: new Date().toISOString(),
    protected: false,
    ...overrides
  }
}

function chainFor(table: string) {
  const next = () => queues[table]?.shift() ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'order', 'limit', 'insert']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.maybeSingle = vi.fn(async () => next())
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve)
  return chain
}

function requestWith(body: unknown) {
  return new NextRequest('http://localhost/api/onboarding/leader/claim-seat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('/api/onboarding/leader/claim-seat — Player-only registrar claim', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    mockAuthed = { auth: { getUser: vi.fn() } }
    mockAuthed.auth.getUser.mockResolvedValue({
      data: { user: { id: SUBJECT } }
    })
    queues = {}
    mockService = {
      from: vi.fn((table: string) => chainFor(table)),
      rpc: vi.fn()
    }
    mockGetPlayer = vi.fn()
    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: vi.fn().mockResolvedValue(mockAuthed),
      createServiceClient: vi.fn().mockReturnValue(mockService)
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      TACTICUS_CIRCUIT_NAME: 'tacticus-api',
      tacticusAPI: { getPlayer: mockGetPlayer }
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, headers: {} }),
      getClientId: vi.fn().mockReturnValue('client'),
      getClientIp: vi.fn().mockReturnValue('203.0.113.9')
    }))
    const mod = await import('@/app/api/onboarding/leader/claim-seat/route')
    POST = mod.POST
  })

  afterEach(() => vi.restoreAllMocks())

  function arrange({
    held = [],
    authority = {
      id: 42,
      guild_code: 'ZKFPH',
      claimed_at: new Date().toISOString()
    },
    guild = {
      guild_code: 'ZKFPH',
      display_name: 'Claim Test Guild',
      last_successful_sync: new Date().toISOString()
    },
    roster = [unclaimed()],
    playerName = 'ClaimPlayer'
  }: Record<string, unknown> = {}) {
    queues.player_mapping = [
      { data: held, error: null },
      { data: roster, error: null }
    ]
    queues.player_claim_audit = [{ data: authority, error: null }]
    queues.guild_config = [{ data: guild, error: null }]
    mockGetPlayer.mockResolvedValue(
      playerName === null ? null : { details: { name: playerName } }
    )
  }

  it('requires authentication, a key, and an unlinked account', async () => {
    mockAuthed.auth.getUser.mockResolvedValue({ data: { user: null } })
    expect((await POST(requestWith({ apiKey: 'k' }))).status).toBe(401)
    mockAuthed.auth.getUser.mockResolvedValue({
      data: { user: { id: SUBJECT } }
    })
    expect((await POST(requestWith({}))).status).toBe(400)
    arrange({ held: [{ id: 7 }] })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('ALREADY_LINKED')
  })

  it('requires a server-issued registration authority receipt', async () => {
    arrange({ authority: null })
    const response = await POST(requestWith({ apiKey: 'player-key' }))
    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe(
      'REGISTRATION_AUTHORITY_REQUIRED'
    )
    expect(mockGetPlayer).not.toHaveBeenCalled()
  })

  it('uses the server receipt for the guild and calls only /player', async () => {
    arrange()
    mockService.rpc.mockResolvedValue({ data: '38DC9EC05F94', error: null })
    const response = await POST(requestWith({ apiKey: 'player-only-key' }))
    expect(response.status).toBe(200)
    expect(mockGetPlayer).toHaveBeenCalledTimes(1)
    expect(mockGetPlayer).toHaveBeenCalledWith('player-only-key')
    expect(JSON.stringify(mockService.from.mock.calls)).not.toContain(
      'onboarding_progress'
    )
  })

  it('refuses a missing registered guild', async () => {
    arrange({ guild: null })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('GUILD_NOT_FOUND')
  })

  it('asks only for Player access when /player refuses the key', async () => {
    arrange({ playerName: null })
    const response = await POST(requestWith({ apiKey: 'k' }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error.code).toBe('PLAYER_SCOPE_REQUIRED')
    expect(body.error.message).toContain('Player')
    expect(body.error.message).not.toContain('keep Guild')
  })

  it.each(['OPEN', 'HALF_OPEN'] as const)(
    'reports upstream unavailability while the circuit is %s',
    async (state) => {
      const { circuitRegistry } = await import('@/app/lib/resilience')
      vi.spyOn(circuitRegistry, 'getState').mockReturnValue(state)
      arrange({ playerName: null })
      const response = await POST(requestWith({ apiKey: 'k' }))
      expect(response.status).toBe(503)
      expect((await response.json()).error.code).toBe('TACTICUS_UNAVAILABLE')
    }
  )

  it('refuses a nameless profile', async () => {
    arrange()
    mockGetPlayer.mockResolvedValue({ details: {} })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('PLAYER_LOOKUP_FAILED')
  })

  it('requires both a fresh guild clock and fresh roster rows', async () => {
    const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    arrange({
      guild: {
        guild_code: 'ZKFPH',
        display_name: 'Guild',
        last_successful_sync: stale
      }
    })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('GUILD_SYNC_STALE')

    arrange({ roster: [unclaimed({ updated_at: stale })] })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('GUILD_SYNC_STALE')
  })

  // The invite-claim corridor shares this roster-dating witness.

  const rosterStale = new Date(
    Date.now() - 45 * 24 * 60 * 60 * 1000
  ).toISOString()
  const rosterFresh = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  function bystander(index: number, updatedAt: string) {
    return unclaimed({
      id: 100 + index,
      player_id: `bystander-${index}`,
      display_name: `Bystander${index}`,
      role: 'member',
      updated_at: updatedAt
    })
  }

  it('ACCEPTS when one straggler row is stale and the rest are fresh', async () => {
    arrange({
      roster: [
        unclaimed({ updated_at: rosterFresh }),
        bystander(1, rosterFresh),
        bystander(2, rosterFresh),
        bystander(3, rosterFresh),
        bystander(4, rosterStale)
      ]
    })
    mockService.rpc.mockResolvedValue({ data: 'CODE12345678', error: null })
    expect((await POST(requestWith({ apiKey: 'k' }))).status).toBe(200)
  })

  it('REFUSES when one freshly-touched row sits on an otherwise dead roster', async () => {
    arrange({
      roster: [
        unclaimed({ updated_at: rosterFresh }),
        bystander(1, rosterStale),
        bystander(2, rosterStale),
        bystander(3, rosterStale),
        bystander(4, rosterStale)
      ]
    })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('GUILD_SYNC_STALE')
  })

  it('REFUSES a roster that is stale across the board', async () => {
    // The guild clock stays fresh, so only the roster rows can be refusing.
    arrange({
      roster: [
        unclaimed({ updated_at: rosterStale }),
        bystander(1, rosterStale),
        bystander(2, rosterStale)
      ]
    })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe('GUILD_SYNC_STALE')
  })

  it('does not tell the blocked leader to run a sync', async () => {
    arrange({ roster: [unclaimed({ updated_at: rosterStale })] })
    const body = await (await POST(requestWith({ apiKey: 'k' }))).json()
    expect(body.error.code).toBe('GUILD_SYNC_STALE')
    expect(body.error.message).not.toMatch(/run a sync/i)
    expect(body.error.message).toMatch(/will not restore it/i)
  })

  it('excludes protected rows from the roster freshness bound', async () => {
    arrange({
      roster: [
        unclaimed(),
        unclaimed({
          id: 2,
          player_id: 'protected',
          display_name: 'Protected',
          protected: true,
          updated_at: '2020-01-01T00:00:00Z'
        })
      ]
    })
    mockService.rpc.mockResolvedValue({ data: 'CODE12345678', error: null })
    expect((await POST(requestWith({ apiKey: 'k' }))).status).toBe(200)
  })

  it.each([
    ['SomeoneElse', [unclaimed()], 'POSSESSION_NAME_MISMATCH'],
    ['claimplayer', [unclaimed()], 'POSSESSION_NAME_MISMATCH'],
    [
      'ClaimPlayer',
      [unclaimed(), unclaimed({ id: 2, player_id: 'other' })],
      'NAME_NOT_UNIQUE'
    ],
    [
      'ClaimPlayer',
      [unclaimed({ user_id: 'another-user', role: 'member' })],
      'POSSESSION_NAME_MISMATCH'
    ]
  ])('refuses unsafe name evidence %#', async (playerName, roster, code) => {
    arrange({ playerName, roster })
    expect(
      (await (await POST(requestWith({ apiKey: 'k' }))).json()).error.code
    ).toBe(code)
  })

  it('requires an invite-capable stored roster role', async () => {
    arrange({ roster: [unclaimed({ role: 'member' })] })
    const response = await POST(requestWith({ apiKey: 'k' }))
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('TARGET_NOT_INVITE_CAPABLE')
  })

  it.each(['leader', 'officer', 'Leader'])(
    'accepts the stored role %s',
    async (role) => {
      arrange({ roster: [unclaimed({ role })] })
      mockService.rpc.mockResolvedValue({ data: 'AAAABBBBCCCC', error: null })
      expect((await POST(requestWith({ apiKey: 'k' }))).status).toBe(200)
    }
  )

  it('keeps the verified registrar path open after another leader links', async () => {
    arrange({
      roster: [
        unclaimed(),
        unclaimed({
          id: 2,
          player_id: 'peer',
          display_name: 'Peer',
          user_id: 'other-user',
          role: 'officer'
        })
      ]
    })
    mockService.rpc.mockResolvedValue({ data: 'AAAABBBBCCCC', error: null })
    expect((await POST(requestWith({ apiKey: 'k' }))).status).toBe(200)
  })

  it('mints a subject-bound code without deriving the digest from the key', async () => {
    arrange()
    mockService.rpc.mockResolvedValue({ data: '38DC9EC05F94', error: null })
    const response = await POST(
      requestWith({ apiKey: 'super-secret-player-key' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      code: '38DC9EC05F94',
      playerName: 'ClaimPlayer',
      guildCode: 'ZKFPH'
    })
    const mintCall = mockService.rpc.mock.calls.find(
      ([name]) => name === 'mint_registrar_seat_invite'
    )
    expect(mintCall?.[1]).toEqual({
      p_subject: SUBJECT,
      p_player_id: PLAYER_ID,
      p_upstream_digest: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(JSON.stringify(mintCall)).not.toContain('super-secret-player-key')
  })

  it('does not echo an unknown mint error', async () => {
    arrange()
    mockService.rpc.mockResolvedValue({
      data: null,
      error: { details: 'SECRET_DB_CODE' }
    })
    const response = await POST(requestWith({ apiKey: 'k' }))
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toContain('SECRET_DB_CODE')
  })
})
