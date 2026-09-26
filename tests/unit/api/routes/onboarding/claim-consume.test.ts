import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * validate_and_use_invite_code binds the caller, not the target, so the server checks the key
 * belongs to the invite's guild AND player. Rejections never reach the claim RPC.
 */

const SUBJECT = '00000000-0000-4000-8000-000000000003'
const TARGET_PLAYER = '00000000-0000-4000-8000-000000000005'
const INVITE_GUILD = 'ZKFPH'
const INVITE_GUILD_ID = 'guild-uuid-zkfph'
const CODE = 'A1B2C3D4E5F6'

let mockAuthed: {
  auth: { getUser: ReturnType<typeof vi.fn> }
  rpc: ReturnType<typeof vi.fn>
}
let mockService: {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}
let mockGetGuild: ReturnType<typeof vi.fn>
let mockGetPlayer: ReturnType<typeof vi.fn>
let queues: Record<string, Array<{ data: unknown; error: unknown }>>
let inserts: Record<string, unknown[]>

function chainFor(table: string) {
  const next = () => queues[table]?.shift() ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.insert = vi.fn((row: unknown) => {
    inserts[table] = [...(inserts[table] ?? []), row]
    return Promise.resolve({ data: null, error: null })
  })
  chain.maybeSingle = vi.fn(async () => next())
  chain.single = vi.fn(async () => next())
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve)
  return chain
}

function requestWith(body: unknown) {
  return new NextRequest('http://localhost/api/onboarding/claim/consume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const FRESH_SYNC = new Date(Date.now() - 60 * 60 * 1000).toISOString()
/** Roster rows carry their own observation stamp; older than 30d is stale. */
const FRESH_ROSTER = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
const STALE_ROSTER = new Date(
  Date.now() - 45 * 24 * 60 * 60 * 1000
).toISOString()

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invite-1',
    code: CODE,
    player_id: TARGET_PLAYER,
    guild_code: INVITE_GUILD,
    display_name: 'ClaimPlayer',
    expires_at: FUTURE,
    used_at: null,
    revoked_at: null,
    ...overrides
  }
}

function targetRow(overrides: Record<string, unknown> = {}) {
  return {
    player_id: TARGET_PLAYER,
    display_name: 'ClaimPlayer',
    original_display_name: null,
    has_duplicate_name: false,
    user_id: null,
    updated_at: FRESH_ROSTER,
    protected: false,
    ...overrides
  }
}

function otherRow(overrides: Record<string, unknown> = {}) {
  return {
    player_id: '00000000-0000-4000-8000-00000000000f',
    display_name: 'SomeoneElse',
    original_display_name: null,
    has_duplicate_name: false,
    user_id: null,
    updated_at: FRESH_ROSTER,
    protected: false,
    ...overrides
  }
}

// Each test overrides exactly one leg so a failure names the broken hypothesis.
function arrange({
  inviteRow = invite(),
  upstreamGuildId = INVITE_GUILD_ID,
  resolvedGuildCode = INVITE_GUILD as string | null,
  members = [{ userId: TARGET_PLAYER, role: 'MEMBER' }] as unknown[],
  lastSync = FRESH_SYNC as string | null,
  // `null` models "target not on the roster".
  roster = [targetRow()] as Record<string, unknown>[] | null,
  keyPlayerName = 'ClaimPlayer' as string | null,
  claimResult = { success: true } as unknown
} = {}) {
  mockService.rpc.mockResolvedValue({
    data: inviteRow ? [inviteRow] : [],
    error: null
  })
  // In the member fallback the first guild_config read is the freshness lookup.
  queues.guild_config = [
    ...(upstreamGuildId
      ? [
          {
            data: resolvedGuildCode ? { guild_code: resolvedGuildCode } : null,
            error: null
          }
        ]
      : []),
    { data: { last_successful_sync: lastSync }, error: null }
  ]
  queues.player_mapping = [{ data: roster, error: null }]
  mockGetGuild.mockResolvedValue(
    upstreamGuildId ? { guildId: upstreamGuildId, members } : null
  )
  mockGetPlayer.mockResolvedValue(
    keyPlayerName ? { details: { name: keyPlayerName } } : null
  )
  mockAuthed.rpc.mockResolvedValue({ data: claimResult, error: null })
}

describe('/api/onboarding/claim/consume', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    queues = {}
    inserts = {}
    mockAuthed = { auth: { getUser: vi.fn() }, rpc: vi.fn() }
    mockAuthed.auth.getUser.mockResolvedValue({
      data: { user: { id: SUBJECT } }
    })
    mockService = {
      from: vi.fn((table: string) => chainFor(table)),
      rpc: vi.fn()
    }
    mockGetGuild = vi.fn()
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
      tacticusAPI: { getGuild: mockGetGuild, getPlayer: mockGetPlayer }
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, headers: {} }),
      getClientId: vi.fn().mockReturnValue('client'),
      getClientIp: vi.fn().mockReturnValue('203.0.113.9')
    }))

    const mod = await import('@/app/api/onboarding/claim/consume/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function post(body: unknown = { code: CODE, apiKey: 'sk-target' }) {
    const response = await POST(requestWith(body))
    return { response, json: await response.json() }
  }

  it('requires a session', async () => {
    mockAuthed.auth.getUser.mockResolvedValue({ data: { user: null } })

    const { response } = await post()

    expect(response.status).toBe(401)
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('requires an API key — a code alone proves nothing', async () => {
    arrange()

    const { response, json } = await post({ code: CODE })

    expect(response.status).toBe(400)
    expect(json.error.code).toBe('API_KEY_REQUIRED')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('REFUSES a claim whose player key does not match the invite target', async () => {
    arrange({ keyPlayerName: 'SomeoneElse' })

    const { response, json } = await post()

    expect(response.status).toBe(403)
    expect(json.error.code).toBe('POSSESSION_NAME_MISMATCH')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
    expect(inserts.player_claim_audit?.[0]).toMatchObject({
      user_id: SUBJECT,
      player_id: TARGET_PLAYER,
      guild_code: INVITE_GUILD,
      outcome: 'rejected_user_mismatch',
      source_path: 'onboarding/invite-claim/witness'
    })
  })

  it('REFUSES a foreign guild: a valid key for another guild cannot redeem this code', async () => {
    arrange({ resolvedGuildCode: 'OTHERG' })

    const { response, json } = await post()

    expect(response.status).toBe(403)
    expect(json.error.code).toBe('KEY_NOT_IN_TARGET_GUILD')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
    expect(inserts.player_claim_audit?.[0]).toMatchObject({
      outcome: 'rejected_user_mismatch'
    })
  })

  it('REFUSES when the target is absent from the KEY’s own upstream roster', async () => {
    // The key's /guild does not list the target, so it cannot witness that player.
    arrange({ members: [{ userId: 'someone-else', role: 'MEMBER' }] })

    const { response, json } = await post()

    expect(response.status).toBe(403)
    expect(json.error.code).toBe('TARGET_NOT_IN_KEY_GUILD')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('REFUSES a duplicated roster name rather than accept an unattributable match', async () => {
    arrange({ roster: [targetRow({ has_duplicate_name: true })] })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('NAME_NOT_UNIQUE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('compares names case-sensitively', async () => {
    arrange({ keyPlayerName: 'claimplayer' })

    const { response, json } = await post()

    expect(response.status).toBe(403)
    expect(json.error.code).toBe('POSSESSION_NAME_MISMATCH')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('tolerates surrounding whitespace on an otherwise exact name', async () => {
    arrange({ keyPlayerName: '  ClaimPlayer  ' })

    const { response, json } = await post()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
  })

  it.each([
    ['unknown', null],
    ['already used', invite({ used_at: new Date().toISOString() })],
    ['revoked', invite({ revoked_at: new Date().toISOString() })],
    [
      'expired',
      invite({ expires_at: new Date(Date.now() - 1000).toISOString() })
    ],
    ['a WI-6240 transfer proof', invite({ code: 'PP6240-ABC' })]
  ])('answers one opaque INVALID_CODE for a %s code', async (_label, row) => {
    arrange({ inviteRow: row as never })

    const { response, json } = await post()

    expect(response.status).toBe(400)
    expect(json.error.code).toBe('INVALID_CODE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  // Members' keys get 403 from /guild (leaders only), so the route witnesses against the synced roster.
  it('falls back to the synced-roster witness when the key has no guild scope', async () => {
    arrange({ upstreamGuildId: null })

    const { response, json } = await post()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockAuthed.rpc).toHaveBeenCalledWith(
      'validate_and_use_invite_code',
      {
        p_code: CODE,
        p_user_id: SUBJECT
      }
    )
  })

  it('fallback still REFUSES a key whose player is not the invite target', async () => {
    arrange({ upstreamGuildId: null, keyPlayerName: 'SomeoneElse' })

    const { response, json } = await post()

    expect(response.status).toBe(403)
    expect(json.error.code).toBe('POSSESSION_NAME_MISMATCH')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('fallback still REFUSES a stale roster snapshot', async () => {
    arrange({
      upstreamGuildId: null,
      lastSync: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('fallback still REFUSES a target missing from the synced roster', async () => {
    arrange({ upstreamGuildId: null, roster: null })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('TARGET_NOT_ON_ROSTER')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('fallback REFUSES when the name is duplicated but the marker was erased', async () => {
    // A sync can reset has_duplicate_name; trusting the flag would hand the invite to the wrong player.
    arrange({
      upstreamGuildId: null,
      roster: [
        targetRow({ has_duplicate_name: false, original_display_name: null }),
        otherRow({
          display_name: 'ClaimPlayer',
          has_duplicate_name: false,
          original_display_name: null
        })
      ]
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('NAME_NOT_UNIQUE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('fallback still ACCEPTS when a same-named row is NOT current', async () => {
    // The roster read is is_current-scoped, so a departed namesake must not block.
    arrange({ upstreamGuildId: null, roster: [targetRow(), otherRow()] })

    const { response } = await post()

    expect(response.status).toBe(200)
    expect(mockAuthed.rpc).toHaveBeenCalled()
  })

  it('fallback REFUSES a roster snapshot that is itself stale', async () => {
    // Raid syncs keep last_successful_sync fresh, but roster rows are 45 days old.
    arrange({
      upstreamGuildId: null,
      lastSync: FRESH_SYNC,
      roster: [targetRow({ updated_at: STALE_ROSTER })]
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('fallback fails CLOSED on a roster row with no observation stamp', async () => {
    arrange({
      upstreamGuildId: null,
      roster: [targetRow({ updated_at: null })]
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('ignores PROTECTED rows when dating the roster snapshot', async () => {
    // Protected rows are never re-stamped; counting one would stale the guild forever.
    arrange({
      upstreamGuildId: null,
      roster: [
        targetRow({ updated_at: FRESH_ROSTER }),
        otherRow({ updated_at: STALE_ROSTER, protected: true })
      ]
    })

    const { response } = await post()

    expect(response.status).toBe(200)
    expect(mockAuthed.rpc).toHaveBeenCalled()
  })

  it('fails CLOSED when every roster row is protected', async () => {
    arrange({
      upstreamGuildId: null,
      roster: [targetRow({ updated_at: FRESH_ROSTER, protected: true })]
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('ACCEPTS when one straggler row is stale and the rest are fresh', async () => {
    // An uncleared departed member is never re-stamped, so the oldest stamp would fail forever.
    arrange({
      upstreamGuildId: null,
      roster: [
        targetRow({ updated_at: FRESH_ROSTER }),
        otherRow({ player_id: 'p-2', updated_at: FRESH_ROSTER }),
        otherRow({ player_id: 'p-3', updated_at: FRESH_ROSTER }),
        otherRow({ player_id: 'p-4', updated_at: FRESH_ROSTER }),
        otherRow({ player_id: 'p-5', updated_at: STALE_ROSTER })
      ]
    })

    const { response } = await post()

    expect(response.status).toBe(200)
    expect(mockAuthed.rpc).toHaveBeenCalled()
  })

  it('REFUSES when one freshly-touched row sits on an otherwise dead roster', async () => {
    // persist-player-api-key touches the caller's own row, so the newest stamp would let one member vouch.
    arrange({
      upstreamGuildId: null,
      roster: [
        targetRow({ updated_at: FRESH_ROSTER }),
        otherRow({ player_id: 'p-2', updated_at: STALE_ROSTER }),
        otherRow({ player_id: 'p-3', updated_at: STALE_ROSTER }),
        otherRow({ player_id: 'p-4', updated_at: STALE_ROSTER }),
        otherRow({ player_id: 'p-5', updated_at: STALE_ROSTER })
      ]
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('REFUSES a roster that is stale across the board', async () => {
    arrange({
      upstreamGuildId: null,
      lastSync: FRESH_SYNC,
      roster: [
        targetRow({ updated_at: STALE_ROSTER }),
        otherRow({ player_id: 'p-2', updated_at: STALE_ROSTER }),
        otherRow({ player_id: 'p-3', updated_at: STALE_ROSTER })
      ]
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('does not tell the blocked user to run a sync', async () => {
    arrange({
      upstreamGuildId: null,
      roster: [targetRow({ updated_at: STALE_ROSTER })]
    })

    const { json } = await post()

    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(json.error.message).not.toMatch(/run a sync/i)
    expect(json.error.message).not.toMatch(/try again/i)
    expect(json.error.message).toMatch(/will not change that/i)
  })

  it('blames Tacticus, not the key, when the circuit is open', async () => {
    arrange({ upstreamGuildId: null })
    const { circuitRegistry } = await import('@/app/lib/resilience')
    vi.spyOn(circuitRegistry, 'getState').mockReturnValue('OPEN')

    const { response, json } = await post()

    expect(response.status).toBe(503)
    expect(json.error.code).toBe('TACTICUS_UNAVAILABLE')
  })

  it('REFUSES to witness against a stale roster snapshot', async () => {
    arrange({
      lastSync: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('GUILD_SYNC_STALE')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('REFUSES when the invite target has left the synced roster', async () => {
    arrange({ roster: null })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('TARGET_NOT_ON_ROSTER')
    expect(mockAuthed.rpc).not.toHaveBeenCalled()
  })

  it('accepts an ORDINARY MEMBER key — this corridor names a guild, it does not elevate', async () => {
    // Invitees are ordinary members: no elevation witness as in data-sync/start.
    arrange({ members: [{ userId: TARGET_PLAYER, role: 'MEMBER' }] })

    const { response, json } = await post()

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockAuthed.rpc).toHaveBeenCalledWith(
      'validate_and_use_invite_code',
      {
        p_code: CODE,
        p_user_id: SUBJECT
      }
    )
  })

  it('consumes the code through the unchanged audited RPC, on the SESSION client', async () => {
    arrange()

    const { response, json } = await post()

    expect(response.status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      playerName: 'ClaimPlayer',
      guildCode: INVITE_GUILD
    })
    // service_role has no EXECUTE, and p_user_id from a service context would be an on-behalf-of bypass.
    expect(mockAuthed.rpc).toHaveBeenCalledWith(
      'validate_and_use_invite_code',
      {
        p_code: CODE,
        p_user_id: SUBJECT
      }
    )
  })

  it('normalizes the submitted code before anything looks at it', async () => {
    arrange()

    const { response } = await post({
      code: ' a1b2 c3d4e5f6 ',
      apiKey: 'sk-target'
    })

    expect(response.status).toBe(200)
    expect(mockAuthed.rpc).toHaveBeenCalledWith(
      'validate_and_use_invite_code',
      expect.objectContaining({ p_code: CODE })
    )
  })

  it('surfaces the RPC’s own refusal instead of claiming success', async () => {
    arrange({
      claimResult: {
        success: false,
        error: 'This account already has a player profile.',
        error_code: 'SUBJECT_ALREADY_LINKED'
      }
    })

    const { response, json } = await post()

    expect(response.status).toBe(409)
    expect(json.error.code).toBe('SUBJECT_ALREADY_LINKED')
  })
})
