import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import type { Json } from '@tacticus/app-core/types'
import {
  RPC_ERROR_CODES,
  ROUTE_ERROR_CODES
} from '@/app/api/profile/change-player-id/error-codes'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(),
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  getClientId: vi.fn(() => 'user:user-1'),
  getClientIp: vi.fn(() => '203.0.113.7')
}))

vi.mock('@/app/lib/api/tacticus-client', () => ({
  tacticusAPI: {
    getGuild: vi.fn(),
    getPlayer: vi.fn()
  }
}))

vi.mock('@/app/lib/profile/persist-player-api-key', () => ({
  persistPlayerApiKey: vi.fn()
}))

vi.mock('@/app/lib/middleware/errorHandler', async () => {
  const { withErrorHandlerMock } =
    await import('../../helpers/mock-error-handler')
  return withErrorHandlerMock
})

const loggerSpy = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}))

// Every digest input, so a leaked API-key field is caught under any name.
const digestCapture = vi.hoisted(() => ({ inputs: [] as string[] }))

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  return {
    ...actual,
    createHash: (algorithm: string) => {
      const hash = actual.createHash(algorithm)
      const originalUpdate = hash.update.bind(hash)
      ;(hash as unknown as { update: (data: string) => unknown }).update = (
        data: string
      ) => {
        digestCapture.inputs.push(String(data))
        return originalUpdate(data)
      }
      return hash
    }
  }
})

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => loggerSpy,
  logger: loggerSpy,
  logError: vi.fn(),
  generateRequestId: () => 'req-test'
}))

const USER_ID = 'user-1'
const SOURCE_PLAYER_ID = 'source-player-id'
const TARGET_PLAYER_ID = 'target-player-id'
const TARGET_GUILD_CODE = 'TGT01'
const KEY_GUILD_ID = 'guild-uuid-1'
const SECRET_API_KEY = 'SECRET-TACTICUS-KEY-9f8e7d6c'

interface QueryError {
  message?: string
  code?: string
  details?: string
}

interface QueryResult {
  data?: Json
  error?: QueryError | null
  count?: number | null
}

interface CallRecord {
  filters: Array<['eq' | 'gte', string, Json]>
  inserts: Array<Record<string, Json>>
}

function queryChain(result: QueryResult, record?: CallRecord) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const method of ['select', 'order', 'limit', 'update', 'is']) {
    chain[method] = vi.fn(self)
  }
  chain.eq = vi.fn((column: string, value: Json) => {
    record?.filters.push(['eq', column, value])
    return chain
  })
  chain.gte = vi.fn((column: string, value: Json) => {
    record?.filters.push(['gte', column, value])
    return chain
  })
  chain.insert = vi.fn((payload: Record<string, Json>) => {
    record?.inserts.push(payload)
    return chain
  })
  chain.maybeSingle = vi.fn(() => Promise.resolve(result))
  chain.single = vi.fn(() => Promise.resolve(result))
  chain.then = (resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)
  return chain
}

interface TestState {
  authUser: { id: string } | null
  currentMapping: QueryResult
  mintCap: QueryResult
  recentSuccesses: QueryResult
  sourceMapping: QueryResult
  targetMapping: QueryResult
  guildConfig: QueryResult
  guildLookup: QueryResult
  mint: QueryResult
  bind: QueryResult
  witnessInsert: QueryResult
}

function freshState(): TestState {
  return {
    authUser: { id: USER_ID },
    witnessInsert: { data: null, error: null },
    currentMapping: { data: { player_id: SOURCE_PLAYER_ID }, error: null },
    mintCap: { count: 0, error: null },
    recentSuccesses: { data: [], error: null },
    sourceMapping: {
      data: { player_id: SOURCE_PLAYER_ID, guild_code: 'SRC01' },
      error: null
    },
    targetMapping: {
      data: {
        id: 42,
        player_id: TARGET_PLAYER_ID,
        guild_code: TARGET_GUILD_CODE,
        user_id: null,
        ownership_attestation_id: null,
        display_name: 'NewAccount',
        original_display_name: null,
        has_duplicate_name: false,
        updated_at: '2026-08-01T00:00:00Z'
      },
      error: null
    },
    guildConfig: {
      data: { last_successful_sync: new Date().toISOString() },
      error: null
    },
    guildLookup: { data: [{ guild_code: TARGET_GUILD_CODE }], error: null },
    mint: { data: 'proof-invite-uuid-1', error: null },
    bind: {
      data: {
        success: true,
        idempotent: false,
        player_id: TARGET_PLAYER_ID,
        guild_code: TARGET_GUILD_CODE
      },
      error: null
    }
  }
}

let state: TestState
let sessionRpc: ReturnType<typeof vi.fn>
let serviceRpc: ReturnType<typeof vi.fn>
let serviceFrom: ReturnType<typeof vi.fn>

async function loadRoute() {
  const dbModule = await import('@/app/lib/db')
  const rateLimitModule = await import('@/app/lib/middleware/rate-limit')
  const tacticusModule = await import('@/app/lib/api/tacticus-client')
  const persistModule = await import('@/app/lib/profile/persist-player-api-key')

  sessionRpc = vi.fn(async (fn: string) => {
    if (fn === 'change_own_player_account') return state.bind
    return { data: null, error: { message: `unexpected session rpc ${fn}` } }
  })
  const sessionClient = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: state.authUser },
        error: state.authUser ? null : { message: 'Not authenticated' }
      }))
    },
    from: vi.fn((table: string) => {
      if (table === 'player_mapping') return queryChain(state.currentMapping)
      return queryChain({ data: null, error: null })
    }),
    rpc: sessionRpc
  }

  // A third from('player_claim_audit') call is the witness-rejection INSERT.
  const claimAuditQueue = [() => state.mintCap, () => state.recentSuccesses]
  const playerMappingQueue = [
    () => state.sourceMapping,
    () => state.targetMapping
  ]
  const claimAuditRecords: CallRecord[] = []
  serviceRpc = vi.fn(async (fn: string) => {
    if (fn === 'get_guild_config_by_guild_id') return state.guildLookup
    if (fn === 'mint_player_possession_invite') return state.mint
    return { data: null, error: { message: `unexpected service rpc ${fn}` } }
  })
  serviceFrom = vi.fn((table: string) => {
    if (table === 'player_claim_audit') {
      const record: CallRecord = { filters: [], inserts: [] }
      claimAuditRecords.push(record)
      const next = claimAuditQueue.shift() ?? (() => state.witnessInsert)
      return queryChain(next(), record)
    }
    if (table === 'player_mapping') {
      const next = playerMappingQueue.shift() ?? (() => state.targetMapping)
      return queryChain(next())
    }
    if (table === 'guild_config') return queryChain(state.guildConfig)
    return queryChain({ data: null, error: null })
  })
  const serviceClient = { from: serviceFrom, rpc: serviceRpc }

  vi.mocked(dbModule.db).mockResolvedValue(
    sessionClient as unknown as Awaited<ReturnType<typeof dbModule.db>>
  )
  vi.mocked(dbModule.serviceDb).mockReturnValue(
    serviceClient as unknown as ReturnType<typeof dbModule.serviceDb>
  )
  vi.mocked(rateLimitModule.checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 10,
    resetTime: Date.now() + 60_000,
    headers: {}
  })
  vi.mocked(tacticusModule.tacticusAPI.getGuild).mockResolvedValue({
    guildId: KEY_GUILD_ID,
    guildTag: 'TGT',
    name: 'Target Guild',
    level: 30,
    members: [
      { userId: TARGET_PLAYER_ID, role: 'member', level: 40 },
      { userId: 'unrelated-member', role: 'leader', level: 50 }
    ],
    guildRaidSeasons: []
  })
  vi.mocked(tacticusModule.tacticusAPI.getPlayer).mockResolvedValue({
    details: { name: 'NewAccount', powerLevel: 1000 }
  })
  vi.mocked(persistModule.persistPlayerApiKey).mockResolvedValue({ ok: true })

  const route = await import('@/app/api/profile/change-player-id/route')
  return {
    POST: route.POST,
    captures: { claimAudit: claimAuditRecords },
    mocks: {
      checkRateLimit: vi.mocked(rateLimitModule.checkRateLimit),
      getGuild: vi.mocked(tacticusModule.tacticusAPI.getGuild),
      getPlayer: vi.mocked(tacticusModule.tacticusAPI.getPlayer),
      persistPlayerApiKey: vi.mocked(persistModule.persistPlayerApiKey)
    }
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/profile/change-player-id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

function defaultBody(): Record<string, unknown> {
  return { newPlayerId: TARGET_PLAYER_ID, apiKey: SECRET_API_KEY }
}

async function callRoute(
  body: Record<string, unknown> = defaultBody()
): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await loadRoute()
  const response = await POST(makeRequest(body))
  const json = (await response.json()) as Record<string, unknown>
  return { status: response.status, json }
}

function errorCodeOf(json: Record<string, unknown>): string | undefined {
  const error = json.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const code = (error as { code?: Json }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  digestCapture.inputs.length = 0
  state = freshState()
})

function witnessInserts(captures: {
  claimAudit: CallRecord[]
}): Array<Record<string, Json>> {
  return captures.claimAudit.flatMap((record) => record.inserts)
}

describe('POST /api/profile/change-player-id (WI-6240 Phase 2)', () => {
  it('happy path: verifies possession, mints, binds via the session client, persists the key', async () => {
    const { POST, mocks } = await loadRoute()
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.apiKeyStored).toBe(true)
    expect(json.playerId).toBe(TARGET_PLAYER_ID)
    expect(json.guildCode).toBe(TARGET_GUILD_CODE)

    const mintCall = serviceRpc.mock.calls.find(
      (call) => call[0] === 'mint_player_possession_invite'
    )
    expect(mintCall).toBeDefined()
    const mintArgs = mintCall?.[1] as Record<string, unknown>
    expect(mintArgs.p_subject).toBe(USER_ID)
    expect(mintArgs.p_player_id).toBe(TARGET_PLAYER_ID)
    expect(mintArgs.p_upstream_digest).toMatch(/^[0-9a-f]{64}$/)

    expect(mocks.persistPlayerApiKey).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      SECRET_API_KEY
    )
  })

  it("'unchanged' short-circuit (M3): no upstream call, no mint", async () => {
    const { POST, mocks } = await loadRoute()
    const response = await POST(
      makeRequest({ newPlayerId: SOURCE_PLAYER_ID, apiKey: SECRET_API_KEY })
    )
    const json = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(json.status).toBe('unchanged')
    expect(mocks.getGuild).not.toHaveBeenCalled()
    expect(mocks.getPlayer).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalled()
    expect(sessionRpc).not.toHaveBeenCalled()
  })

  it('rejects a missing API key with 400 before any upstream call', async () => {
    const { POST, mocks } = await loadRoute()
    const response = await POST(makeRequest({ newPlayerId: TARGET_PLAYER_ID }))
    expect(response.status).toBe(400)
    expect(mocks.getGuild).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('rate-limit layer (a): shared limiter rejection is a 429 before any upstream call', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: Date.now() + 60_000,
      reason: 'Rate limit exceeded',
      headers: { 'X-RateLimit-Remaining': '0' }
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(429)
    expect(errorCodeOf(json)).toBe('RATE_LIMITED')
    expect(mocks.getGuild).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('rate-limit layer (b): the durable mint cap rejects with 429 before any upstream call', async () => {
    state.mintCap = { count: 5, error: null }
    const { POST, mocks } = await loadRoute()
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(429)
    expect(errorCodeOf(json)).toBe('RATE_LIMITED')
    expect(mocks.getGuild).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('rate-limit pre-check (c/S1): a non-idempotent success in the last 7 days is a clean 429 before a mint burns', async () => {
    state.recentSuccesses = {
      data: [{ id: 9, details: { idempotent: false } }],
      error: null
    }
    const { POST, mocks } = await loadRoute()
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(429)
    expect(errorCodeOf(json)).toBe('RATE_LIMITED')
    expect(mocks.getGuild).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalledWith(
      'mint_player_possession_invite',
      expect.anything()
    )
  })

  it('rate-limit pre-check (c): an idempotent-only success does NOT block', async () => {
    state.recentSuccesses = {
      data: [{ id: 9, details: { idempotent: true } }],
      error: null
    }
    const { status } = await callRoute()
    expect(status).toBe(200)
  })

  it('step 2: no attested source mapping -> 400 NO_ATTESTED_SOURCE', async () => {
    state.sourceMapping = { data: null, error: null }
    const { status, json } = await callRoute()
    expect(status).toBe(400)
    expect(errorCodeOf(json)).toBe('NO_ATTESTED_SOURCE')
  })

  it('step 2: target absent -> 404 PLAYER_NOT_ON_TRACKED_ROSTER', async () => {
    state.targetMapping = { data: null, error: null }
    const { status, json } = await callRoute()
    expect(status).toBe(404)
    expect(errorCodeOf(json)).toBe('PLAYER_NOT_ON_TRACKED_ROSTER')
  })

  it('step 2: claimed target (user_id set) -> 409 TARGET_ALREADY_CLAIMED', async () => {
    const target = state.targetMapping.data as Record<string, unknown>
    target.user_id = 'someone-else'
    const { status, json } = await callRoute()
    expect(status).toBe(409)
    expect(errorCodeOf(json)).toBe('TARGET_ALREADY_CLAIMED')
  })

  it('step 2: stale attestation id without a user binding is still claimed -> 409', async () => {
    const target = state.targetMapping.data as Record<string, unknown>
    target.ownership_attestation_id = 'stale-attestation'
    const { status, json } = await callRoute()
    expect(status).toBe(409)
    expect(errorCodeOf(json)).toBe('TARGET_ALREADY_CLAIMED')
  })

  it('step 3a: /guild failure or missing guildId -> 400 GUILD_SCOPE_REQUIRED', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getGuild.mockResolvedValue(null)
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(400)
    expect(errorCodeOf(json)).toBe('GUILD_SCOPE_REQUIRED')
    expect(serviceRpc).not.toHaveBeenCalledWith(
      'mint_player_possession_invite',
      expect.anything()
    )
  })

  it("step 3b (H1): key guild does not resolve to the target's guild_code -> 403 KEY_NOT_IN_TARGET_GUILD", async () => {
    state.guildLookup = { data: [{ guild_code: 'OTHER' }], error: null }
    const { status, json } = await callRoute()
    expect(status).toBe(403)
    expect(errorCodeOf(json)).toBe('KEY_NOT_IN_TARGET_GUILD')
  })

  it('step 3b (H1): key guild unknown to guild_config -> 403 KEY_NOT_IN_TARGET_GUILD', async () => {
    state.guildLookup = { data: [], error: null }
    const { status, json } = await callRoute()
    expect(status).toBe(403)
    expect(errorCodeOf(json)).toBe('KEY_NOT_IN_TARGET_GUILD')
  })

  it('step 3c: target absent from the key roster -> 403 TARGET_NOT_IN_KEY_GUILD', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getGuild.mockResolvedValue({
      guildId: KEY_GUILD_ID,
      guildTag: 'TGT',
      name: 'Target Guild',
      level: 30,
      members: [{ userId: 'unrelated-member', role: 'leader', level: 50 }],
      guildRaidSeasons: []
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(403)
    expect(errorCodeOf(json)).toBe('TARGET_NOT_IN_KEY_GUILD')
  })

  it('step 3c: target appearing MORE than once is not "exactly once" -> 403 TARGET_NOT_IN_KEY_GUILD', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getGuild.mockResolvedValue({
      guildId: KEY_GUILD_ID,
      guildTag: 'TGT',
      name: 'Target Guild',
      level: 30,
      members: [
        { userId: TARGET_PLAYER_ID, role: 'member', level: 40 },
        { userId: TARGET_PLAYER_ID, role: 'member', level: 40 }
      ],
      guildRaidSeasons: []
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(403)
    expect(errorCodeOf(json)).toBe('TARGET_NOT_IN_KEY_GUILD')
  })

  it('step 3d (H2): the source account on the same roster -> 409 AMBIGUOUS_KEY_OWNERSHIP', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getGuild.mockResolvedValue({
      guildId: KEY_GUILD_ID,
      guildTag: 'TGT',
      name: 'Target Guild',
      level: 30,
      members: [
        { userId: TARGET_PLAYER_ID, role: 'member', level: 40 },
        { userId: SOURCE_PLAYER_ID, role: 'member', level: 40 }
      ],
      guildRaidSeasons: []
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(409)
    expect(errorCodeOf(json)).toBe('AMBIGUOUS_KEY_OWNERSHIP')
  })

  it('step 4: /player without a name -> 502, no mint', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getPlayer.mockResolvedValue(null)
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(502)
    expect(serviceRpc).not.toHaveBeenCalledWith(
      'mint_player_possession_invite',
      expect.anything()
    )
  })

  it('step 5: empty raw username -> 400 NO_SYNCED_ACTIVITY', async () => {
    const target = state.targetMapping.data as Record<string, unknown>
    target.display_name = '  '
    const { status, json } = await callRoute()
    expect(status).toBe(400)
    expect(errorCodeOf(json)).toBe('NO_SYNCED_ACTIVITY')
  })

  it('step 5: duplicate name reads original_display_name, then rejects 409 NAME_NOT_UNIQUE', async () => {
    const target = state.targetMapping.data as Record<string, unknown>
    target.has_duplicate_name = true
    target.original_display_name = 'NewAccount'
    target.display_name = 'NewAccount (2)'
    const { status, json } = await callRoute()
    expect(status).toBe(409)
    expect(errorCodeOf(json)).toBe('NAME_NOT_UNIQUE')
  })

  it('step 5: null last_successful_sync -> 409 GUILD_SYNC_STALE', async () => {
    state.guildConfig = { data: { last_successful_sync: null }, error: null }
    const { status, json } = await callRoute()
    expect(status).toBe(409)
    expect(errorCodeOf(json)).toBe('GUILD_SYNC_STALE')
  })

  it('step 5: last_successful_sync older than 30 days -> 409 GUILD_SYNC_STALE', async () => {
    state.guildConfig = {
      data: {
        last_successful_sync: new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000
        ).toISOString()
      },
      error: null
    }
    const { status, json } = await callRoute()
    expect(status).toBe(409)
    expect(errorCodeOf(json)).toBe('GUILD_SYNC_STALE')
  })

  it('step 6: key player name mismatching the synced raw username -> 403 POSSESSION_NAME_MISMATCH', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getPlayer.mockResolvedValue({
      details: { name: 'SomebodyElse', powerLevel: 1 }
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(403)
    expect(errorCodeOf(json)).toBe('POSSESSION_NAME_MISMATCH')
  })

  it('step 6: the comparison trims (whitespace-only difference still matches)', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getPlayer.mockResolvedValue({
      details: { name: '  NewAccount ', powerLevel: 1 }
    })
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(200)
  })

  it('step 6 (sec F-2): the comparison is CASE-SENSITIVE — a case-only variant rejects, with the R1 diagnosable marker', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getPlayer.mockResolvedValue({
      details: { name: 'newACCOUNT', powerLevel: 1 }
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(403)
    expect(errorCodeOf(json)).toBe('POSSESSION_NAME_MISMATCH')
    expect(loggerSpy.warn).toHaveBeenCalledWith(
      expect.objectContaining({ caseOnlyMismatch: true }),
      expect.any(String)
    )
  })

  it('step 6: a fully different name rejects WITHOUT the case-only marker', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.getPlayer.mockResolvedValue({
      details: { name: 'SomebodyElse', powerLevel: 1 }
    })
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(403)
    const caseOnlyCalls = loggerSpy.warn.mock.calls.filter((call) =>
      JSON.stringify(call).includes('caseOnlyMismatch')
    )
    expect(caseOnlyCalls).toHaveLength(0)
  })

  it('step 8: a mint RAISE maps its DETAIL machine code (TARGET_ALREADY_CLAIMED -> 409)', async () => {
    state.mint = {
      data: null,
      error: {
        message: 'That player profile is already claimed',
        details: 'TARGET_ALREADY_CLAIMED'
      }
    }
    const { status, json } = await callRoute()
    expect(status).toBe(409)
    expect(errorCodeOf(json)).toBe('TARGET_ALREADY_CLAIMED')
    expect(sessionRpc).not.toHaveBeenCalled()
  })

  it('step 8: a mint error without a mapped DETAIL is a generic 500 that does not echo', async () => {
    state.mint = {
      data: null,
      error: { message: 'boom', details: 'SOME_FUTURE_CODE' }
    }
    const { status, json } = await callRoute()
    expect(status).toBe(500)
    expect(errorCodeOf(json)).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(json)).not.toContain('SOME_FUTURE_CODE')
  })

  it('S2b: the bind call goes through the SESSION client, never the service client', async () => {
    const { POST } = await loadRoute()
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(200)
    expect(sessionRpc).toHaveBeenCalledWith('change_own_player_account', {
      p_proof_invite_id: 'proof-invite-uuid-1'
    })
    expect(serviceRpc).not.toHaveBeenCalledWith(
      'change_own_player_account',
      expect.anything()
    )
  })

  it('S2a: a bind success=false payload is NEVER reported as success', async () => {
    state.bind = {
      data: {
        success: false,
        error: 'You can only move your account once every 7 days',
        error_code: 'RATE_LIMITED'
      },
      error: null
    }
    const { status, json } = await callRoute()
    expect(status).toBe(429)
    expect(json.success).not.toBe(true)
    expect(errorCodeOf(json)).toBe('RATE_LIMITED')
  })

  it.each(Object.entries(RPC_ERROR_CODES))(
    'RPC machine code %s maps to its configured status',
    async (code, mapping) => {
      state.bind = {
        data: { success: false, error: 'rejected', error_code: code },
        error: null
      }
      const { status, json } = await callRoute()
      expect(status).toBe(mapping.status)
      expect(errorCodeOf(json)).toBe(code)
      expect(json.success).not.toBe(true)
    }
  )

  it('unknown bind error_code -> generic 500 without echoing the code', async () => {
    state.bind = {
      data: { success: false, error: 'nope', error_code: 'BRAND_NEW_CODE' },
      error: null
    }
    const { status, json } = await callRoute()
    expect(status).toBe(500)
    expect(errorCodeOf(json)).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(json)).not.toContain('BRAND_NEW_CODE')
  })

  it('bind transport error 42501 (no-subject preamble fault) -> 401, never success', async () => {
    state.bind = {
      data: null,
      error: { code: '42501', message: 'Authentication required' }
    }
    const { status, json } = await callRoute()
    expect(status).toBe(401)
    expect(json.success).not.toBe(true)
  })

  it('bind transport error (non-42501) -> 500, never success', async () => {
    state.bind = {
      data: null,
      error: { code: 'XX000', message: 'unexpected' }
    }
    const { status, json } = await callRoute()
    expect(status).toBe(500)
    expect(json.success).not.toBe(true)
  })

  it('M4: a failed key persist AFTER a committed bind is a 200 with apiKeyStored:false and a loud log', async () => {
    const { POST, mocks } = await loadRoute()
    mocks.persistPlayerApiKey.mockResolvedValue({
      ok: false,
      reason: 'update_failed',
      detail: 'update rejected'
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.apiKeyStored).toBe(false)
    expect(String(json.message)).toContain('API key')
    expect(loggerSpy.error).toHaveBeenCalled()
  })

  it('never logs the supplied API key on any path', async () => {
    {
      const { POST } = await loadRoute()
      await POST(makeRequest(defaultBody()))
    }
    vi.resetModules()
    state = freshState()
    state.mint = {
      data: null,
      error: { message: 'claimed', details: 'TARGET_ALREADY_CLAIMED' }
    }
    {
      const { POST } = await loadRoute()
      await POST(makeRequest(defaultBody()))
    }
    vi.resetModules()
    state = freshState()
    {
      const { POST, mocks } = await loadRoute()
      mocks.persistPlayerApiKey.mockResolvedValue({
        ok: false,
        reason: 'encrypt_failed'
      })
      await POST(makeRequest(defaultBody()))
    }

    const loggedPayloads = [
      ...loggerSpy.info.mock.calls,
      ...loggerSpy.warn.mock.calls,
      ...loggerSpy.error.mock.calls,
      ...loggerSpy.debug.mock.calls
    ].map((call) => JSON.stringify(call))
    expect(loggedPayloads.length).toBeGreaterThan(0)
    for (const payload of loggedPayloads) {
      expect(payload).not.toContain(SECRET_API_KEY)
    }
  })

  it('rejects unauthenticated callers with 401 before any upstream or service call', async () => {
    state.authUser = null
    const { POST, mocks } = await loadRoute()
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(401)
    expect(mocks.getGuild).not.toHaveBeenCalled()
    expect(serviceRpc).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the current-mapping lookup errors', async () => {
    state.currentMapping = { data: null, error: { message: 'db down' } }
    const { status } = await callRoute()
    expect(status).toBe(503)
  })

  it('rejects a too-short Player ID with 400', async () => {
    const { status } = await callRoute({
      newPlayerId: 'ab',
      apiKey: SECRET_API_KEY
    })
    expect(status).toBe(400)
  })

  it('mutation guard: both audit reads carry the exact filter literals', async () => {
    const { POST, captures } = await loadRoute()
    await POST(makeRequest(defaultBody()))

    const [mintCapRead, s1Read] = captures.claimAudit
    expect(mintCapRead).toBeDefined()
    expect(s1Read).toBeDefined()

    expect(mintCapRead.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', USER_ID],
        ['eq', 'source_path', 'profile/change-player-id/mint']
      ])
    )
    const mintGte = mintCapRead.filters.find((entry) => entry[0] === 'gte')
    expect(mintGte?.[1]).toBe('claimed_at')

    expect(s1Read.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'user_id', USER_ID],
        ['eq', 'source_path', 'profile/change-player-id'],
        ['eq', 'outcome', 'success']
      ])
    )
    const s1Gte = s1Read.filters.find((entry) => entry[0] === 'gte')
    expect(s1Gte?.[1]).toBe('claimed_at')
  })

  it('H2 rejection writes a witness audit row (rejected_user_mismatch, code in details)', async () => {
    const { POST, mocks, captures } = await loadRoute()
    mocks.getGuild.mockResolvedValue({
      guildId: KEY_GUILD_ID,
      guildTag: 'TGT',
      name: 'Target Guild',
      level: 30,
      members: [
        { userId: TARGET_PLAYER_ID, role: 'member', level: 40 },
        { userId: SOURCE_PLAYER_ID, role: 'member', level: 40 }
      ],
      guildRaidSeasons: []
    })
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(409)

    const inserts = witnessInserts(captures)
    expect(inserts).toHaveLength(1)
    const audit = inserts[0]
    expect(audit.source_path).toBe('profile/change-player-id/witness')
    expect(audit.outcome).toBe('rejected_user_mismatch')
    expect(audit.user_id).toBe(USER_ID)
    expect(audit.player_id).toBe(TARGET_PLAYER_ID)
    expect(audit.guild_code).toBe(TARGET_GUILD_CODE)
    expect((audit.details as Record<string, unknown>).code).toBe(
      'AMBIGUOUS_KEY_OWNERSHIP'
    )
    expect(JSON.stringify(audit)).not.toContain(SECRET_API_KEY)
  })

  it("name-mismatch rejection audits with the claimant's /player name in details (R2), never the key", async () => {
    const { POST, mocks, captures } = await loadRoute()
    mocks.getPlayer.mockResolvedValue({
      details: { name: 'Imposter', powerLevel: 1 }
    })
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(403)

    const inserts = witnessInserts(captures)
    expect(inserts).toHaveLength(1)
    const audit = inserts[0]
    expect(audit.outcome).toBe('rejected_user_mismatch')
    const details = audit.details as Record<string, unknown>
    expect(details.code).toBe('POSSESSION_NAME_MISMATCH')
    expect(details.keyPlayerName).toBe('Imposter')
    expect(JSON.stringify(audit)).not.toContain(SECRET_API_KEY)
  })

  it('a failed witness audit write logs loudly but does not fail the request', async () => {
    state.witnessInsert = { data: null, error: { message: 'insert denied' } }
    const { POST, mocks } = await loadRoute()
    mocks.getPlayer.mockResolvedValue({
      details: { name: 'Imposter', powerLevel: 1 }
    })
    const response = await POST(makeRequest(defaultBody()))
    const json = (await response.json()) as Record<string, unknown>
    expect(response.status).toBe(403)
    expect(errorCodeOf(json)).toBe('POSSESSION_NAME_MISMATCH')
    expect(loggerSpy.error).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'POSSESSION_NAME_MISMATCH' }),
      expect.stringContaining('audit write failed')
    )
  })

  it('step-2 rejections (pre-witness 404/409) do NOT write a witness audit row', async () => {
    state.targetMapping = { data: null, error: null }
    const { POST, captures } = await loadRoute()
    const response = await POST(makeRequest(defaultBody()))
    expect(response.status).toBe(404)
    expect(witnessInserts(captures)).toHaveLength(0)
  })

  it('the shared limiter is consulted with the dedicated endpoint bucket, and the bucket exists in config', async () => {
    const { POST, mocks } = await loadRoute()
    await POST(makeRequest(defaultBody()))
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      'user:user-1',
      '/api/profile/change-player-id'
    )

    const actual = await vi.importActual<
      typeof import('@/app/lib/middleware/rate-limit')
    >('@/app/lib/middleware/rate-limit')
    expect(
      actual.RATE_LIMIT_CONFIG.endpoints['/api/profile/change-player-id']
    ).toEqual({ limit: 10, window: 60 * 60 * 1000 })
  })

  it('the digest payload never contains the API key (inject-and-detect)', async () => {
    const { POST } = await loadRoute()
    await POST(makeRequest(defaultBody()))
    expect(digestCapture.inputs.length).toBeGreaterThan(0)
    const digestInput = digestCapture.inputs.join('')
    expect(digestInput).toContain('targetPlayerId')
    expect(digestInput).not.toContain(SECRET_API_KEY)
  })
})

describe('WI-6240 machine-code map exhaustiveness (M1)', () => {
  it('every code literal in the clean-baseline account-transfer RPC has a map entry', () => {
    const migrationPath = join(
      process.cwd(),
      'supabase/migrations/20260813000000_clean_baseline.sql'
    )
    const sql = readFileSync(migrationPath, 'utf8')
    const functionStart = sql.indexOf(
      'CREATE FUNCTION public.change_own_player_account'
    )
    const functionEnd = sql.indexOf(
      'ALTER FUNCTION public.change_own_player_account',
      functionStart
    )
    expect(functionStart).toBeGreaterThanOrEqual(0)
    expect(functionEnd).toBeGreaterThan(functionStart)
    const codeLines = sql
      .slice(functionStart, functionEnd)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')

    const codes = new Set<string>()
    for (const match of codeLines.matchAll(
      /'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g
    )) {
      codes.add(match[1] as string)
    }

    expect(codes.size).toBe(20)
    for (const code of codes) {
      expect(
        RPC_ERROR_CODES[code],
        `machine code ${code} from the migration is missing from RPC_ERROR_CODES`
      ).toBeDefined()
    }
  })

  it('the route-originated set is exactly the eight approved codes, disjoint from the RPC set', () => {
    expect(Object.keys(ROUTE_ERROR_CODES).sort()).toEqual(
      [
        'AMBIGUOUS_KEY_OWNERSHIP',
        'GUILD_SCOPE_REQUIRED',
        'GUILD_SYNC_STALE',
        'KEY_NOT_IN_TARGET_GUILD',
        'NAME_NOT_UNIQUE',
        'NO_SYNCED_ACTIVITY',
        'POSSESSION_NAME_MISMATCH',
        'TARGET_NOT_IN_KEY_GUILD'
      ].sort()
    )
    for (const code of Object.keys(ROUTE_ERROR_CODES)) {
      expect(
        RPC_ERROR_CODES[code],
        `route code ${code} must not collide with an RPC code`
      ).toBeUndefined()
    }
  })
})
