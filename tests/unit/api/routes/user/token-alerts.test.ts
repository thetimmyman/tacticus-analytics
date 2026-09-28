import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import type { Json } from '@tacticus/app-core/types'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockResolveVerifiedDiscordIdentities: ReturnType<typeof vi.fn>
let mockFindVerifiedDiscordForMapping: ReturnType<typeof vi.fn>

interface QueryResult {
  data?: Json
  error?: Json
}

// One request can read and write the table; `.update().select()` resolves to WRITE.
function makeChain(
  read: QueryResult = { data: null, error: null },
  write: QueryResult = { data: [{ user_id: 'user-123' }], error: null }
) {
  const thenable =
    (result: QueryResult) => (resolve: (value: QueryResult) => unknown) =>
      Promise.resolve(result).then(resolve)

  const writeChain: Record<string, unknown> = {}
  writeChain.select = vi.fn(() => writeChain)
  writeChain.eq = vi.fn(() => writeChain)
  writeChain.maybeSingle = vi.fn(async () => write)
  writeChain.single = vi.fn(async () => write)
  writeChain.then = thenable(write)

  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.limit = vi.fn(() => chain)
  chain.update = vi.fn(() => writeChain)
  chain.maybeSingle = vi.fn(async () => read)
  chain.single = vi.fn(async () => read)
  chain.upsert = vi.fn(async () => write)
  chain.insert = vi.fn(async () => write)
  chain.then = thenable(read)
  return chain
}

type Chain = ReturnType<typeof makeChain>

describe('/api/user/token-alerts', () => {
  let GET: () => Promise<Response>
  let PUT: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: { from: ReturnType<typeof vi.fn> }

  const AUTHED_USER = { id: 'user-123' }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockResolveVerifiedDiscordIdentities = vi.fn(
      async (_supabase: object, discordUserIds: string[]) =>
        discordUserIds.map((discordUserId) => ({ discordUserId }))
    )
    mockFindVerifiedDiscordForMapping = vi.fn(
      (
        rows: Array<{ discordUserId: string }>,
        candidate: { discordUserId?: string | null }
      ) =>
        rows.find((row) => row.discordUserId === candidate.discordUserId) ??
        null
    )

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@/app/lib/auth/verified-player-authority', () => ({
      resolveVerifiedDiscordIdentities: mockResolveVerifiedDiscordIdentities,
      findVerifiedDiscordForMapping: mockFindVerifiedDiscordForMapping
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(() => makeChain())
    }
    mockServiceSupabase = {
      from: vi.fn(() => makeChain({ error: null }))
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    const routeModule = await import('@/app/api/user/token-alerts/route')
    GET = routeModule.GET
    PUT = routeModule.PUT
  })

  function setUser(user: { id: string } | null) {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user },
      error: user ? null : { message: 'no session' }
    })
  }

  function configureFrom(overrides: Record<string, Chain>) {
    mockSupabase.from.mockImplementation(
      (table: string) => overrides[table] ?? makeChain()
    )
    mockServiceSupabase.from.mockImplementation(
      (table: string) => overrides[table] ?? makeChain()
    )
  }

  function createPutRequest(body: Json) {
    return new Request('http://localhost/api/user/token-alerts', {
      method: 'PUT',
      body: JSON.stringify(body)
    })
  }

  /** An older client's partial body: exercises read-modify-write with compare-and-set. */
  const validBody = {
    alert_on_full: false,
    alert_before_full: false,
    alert_before_full_minutes: 120,
    alert_on_token_gained: false
  }

  const completeBody = (overrides: Record<string, unknown> = {}) => ({
    ...validBody,
    alert_on_full_repeat_hours: null,
    alert_on_bomb_ready: false,
    alert_before_bomb_ready: false,
    alert_before_bomb_ready_minutes: 120,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    alert_before_quiet_hours: false,
    alert_before_quiet_hours_minutes: 30,
    alert_before_burn: false,
    alert_before_burn_minutes: 30,
    ...overrides
  })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      setUser(null)

      const response = await GET()

      expect(response.status).toBe(401)
    })

    it('returns defaults when the caller has no prefs row yet', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        user_token_alert_prefs: makeChain({ data: null, error: null }),
        player_mapping: makeChain({
          data: { discord_user_id: null },
          error: null
        }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({
        available: true,
        linked: false,
        dmBlocked: false,
        // No guild_code: bot-install state fails open (any shared server works).
        botInstalled: true,
        canSetupBot: false,
        prefs: {
          alert_on_full: false,
          alert_on_full_repeat_hours: null,
          alert_before_full: false,
          alert_before_full_minutes: 120,
          alert_on_token_gained: false,
          alert_on_bomb_ready: false,
          alert_before_bomb_ready: false,
          alert_before_bomb_ready_minutes: 120,
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_timezone: null,
          alert_before_quiet_hours: false,
          alert_before_quiet_hours_minutes: 30,
          alert_before_burn: false,
          alert_before_burn_minutes: 30
        }
      })
    })

    it('returns available:false when the prefs table is missing (42P01)', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        user_token_alert_prefs: makeChain({
          data: null,
          error: { code: '42P01', message: 'relation does not exist' }
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })

    it('returns available:false when PostgREST reports a schema-cache miss (PGRST205)', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        user_token_alert_prefs: makeChain({
          data: null,
          error: { code: 'PGRST205', message: 'schema cache miss' }
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })

    it('reports linked + dmBlocked + saved prefs when rows exist', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        user_token_alert_prefs: makeChain({
          data: {
            alert_on_full: true,
            alert_before_full: false,
            alert_before_full_minutes: 60,
            alert_on_token_gained: true
          },
          error: null
        }),
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_state: makeChain({
          data: { dm_blocked_at: '2026-07-18T00:00:00Z' },
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.linked).toBe(true)
      expect(body.dmBlocked).toBe(true)
      expect(body.prefs).toEqual({
        alert_on_full: true,
        alert_before_full: false,
        alert_before_full_minutes: 60,
        alert_on_token_gained: true
      })
    })

    it('reports an unverified stored Discord candidate as unlinked', async () => {
      setUser(AUTHED_USER)
      mockResolveVerifiedDiscordIdentities.mockResolvedValue([])
      configureFrom({
        user_token_alert_prefs: makeChain({ data: null, error: null }),
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.linked).toBe(false)
      expect(mockFindVerifiedDiscordForMapping).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ discordUserId: 'discord-1' })
      )
    })

    function configureGetWithMapping(mapping: Json, serverGuilds: Chain) {
      configureFrom({
        user_token_alert_prefs: makeChain({ data: null, error: null }),
        player_mapping: makeChain({ data: mapping, error: null }),
        user_token_alert_state: makeChain({ data: null, error: null }),
        discord_server_guilds: serverGuilds
      })
    }

    it('reports botInstalled:false for a member whose guild has no active Discord link', async () => {
      setUser(AUTHED_USER)
      configureGetWithMapping(
        { discord_user_id: 'discord-1', guild_code: 'GUILD1', role: 'member' },
        makeChain({ data: [], error: null })
      )

      const body = await (await GET()).json()

      expect(body.botInstalled).toBe(false)
      expect(body.canSetupBot).toBe(false)
    })

    it('reports canSetupBot:true for an officer when the bot is missing', async () => {
      setUser(AUTHED_USER)
      configureGetWithMapping(
        // Role predicates lowercase like the SQL does.
        { discord_user_id: 'discord-1', guild_code: 'GUILD1', role: 'Officer' },
        makeChain({ data: [], error: null })
      )

      const body = await (await GET()).json()

      expect(body.botInstalled).toBe(false)
      expect(body.canSetupBot).toBe(true)
    })

    it('reports botInstalled:true when an active Discord-server link exists', async () => {
      setUser(AUTHED_USER)
      configureGetWithMapping(
        { discord_user_id: 'discord-1', guild_code: 'GUILD1', role: 'member' },
        makeChain({ data: [{ discord_guild_id: '123456789012345678' }] })
      )

      const body = await (await GET()).json()

      expect(body.botInstalled).toBe(true)
    })

    it('fails OPEN on a discord_server_guilds read error', async () => {
      // A transient read failure must not replace the panel with a setup CTA.
      setUser(AUTHED_USER)
      configureGetWithMapping(
        { discord_user_id: 'discord-1', guild_code: 'GUILD1', role: 'member' },
        makeChain({ data: null, error: { message: 'boom' } })
      )

      const body = await (await GET()).json()

      expect(body.botInstalled).toBe(true)
    })
  })

  describe('PUT validation', () => {
    it('returns 401 when unauthenticated', async () => {
      setUser(null)

      const response = await PUT(createPutRequest(validBody))

      expect(response.status).toBe(401)
    })

    it('returns 400 when alert_before_full_minutes is out of range', async () => {
      setUser(AUTHED_USER)

      const response = await PUT(
        createPutRequest({ ...validBody, alert_before_full_minutes: 10 })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })

    it('returns 400 when alert_before_full_minutes is not an integer', async () => {
      setUser(AUTHED_USER)

      const response = await PUT(
        createPutRequest({ ...validBody, alert_before_full_minutes: 90.5 })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })

    it('returns 400 when a boolean field is not strictly boolean', async () => {
      setUser(AUTHED_USER)

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: 'yes' })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })

    it('accepts a bounded repeat cadence when the full alert is enabled', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest(
          completeBody({
            alert_on_full: true,
            alert_on_full_repeat_hours: 12
          })
        )
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.alert_on_full_repeat_hours).toBe(12)
    })

    it.each([10, 169, 12.5])(
      'rejects invalid repeat cadence %s',
      async (hours) => {
        setUser(AUTHED_USER)

        const response = await PUT(
          createPutRequest(
            completeBody({
              alert_on_full: true,
              alert_on_full_repeat_hours: hours
            })
          )
        )
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.code).toBe(2001)
      }
    )

    it('rejects a repeat cadence when the parent full alert is off', async () => {
      setUser(AUTHED_USER)

      const response = await PUT(
        createPutRequest(
          completeBody({
            alert_on_full: false,
            alert_on_full_repeat_hours: 12
          })
        )
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })
  })

  describe('PUT authorization', () => {
    it('returns 409 DISCORD_NOT_LINKED when enabling a toggle while unlinked', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: null },
          error: null
        })
      })

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error.message).toBe('DISCORD_NOT_LINKED')
    })

    it('allows an all-off save even when Discord is unlinked', async () => {
      setUser(AUTHED_USER)
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: null },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(validBody))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.available).toBe(true)
      expect(body.linked).toBe(false)
    })
  })

  describe('PUT happy path', () => {
    it('inserts prefs and clears the dm block via the service client', async () => {
      setUser(AUTHED_USER)
      const prefsChain = makeChain({ error: null })
      const playerMappingChain = makeChain({
        data: { discord_user_id: 'discord-1' },
        error: null
      })
      configureFrom({
        player_mapping: playerMappingChain,
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })
      const stateUpdateChain = makeChain({ error: null })
      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'user_token_alert_state') return stateUpdateChain
        if (table === 'player_mapping') return playerMappingChain
        return makeChain()
      })

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({
        available: true,
        linked: true,
        dmBlocked: false,
        botInstalled: true,
        canSetupBot: false,
        prefs: {
          alert_on_full: true,
          alert_on_full_repeat_hours: null,
          alert_before_full: false,
          alert_before_full_minutes: 120,
          alert_on_token_gained: false,
          alert_on_bomb_ready: false,
          alert_before_bomb_ready: false,
          alert_before_bomb_ready_minutes: 120,
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_timezone: null,
          alert_before_quiet_hours: false,
          alert_before_quiet_hours_minutes: 30,
          alert_before_burn: false,
          alert_before_burn_minutes: 30
        }
      })

      // With no stored row, the INSERT's PK conflict is the compare-and-set.
      expect(prefsChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          alert_on_full: true,
          alert_on_full_repeat_hours: null,
          alert_before_full: false,
          alert_before_full_minutes: 120,
          alert_on_token_gained: false,
          alert_on_bomb_ready: false,
          alert_before_bomb_ready: false,
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_timezone: null
        })
      )

      expect(mockCreateServiceClient).toHaveBeenCalled()
      expect(mockServiceSupabase.from).toHaveBeenCalledWith(
        'user_token_alert_state'
      )
      expect(stateUpdateChain.update).toHaveBeenCalledWith({
        dm_blocked_at: null,
        consecutive_dm_failures: 0
      })
    })

    it('a COMPLETE body upserts without reading first', async () => {
      setUser(AUTHED_USER)
      const prefsChain = makeChain({ data: null, error: null })
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest(completeBody({ alert_on_full: true }))
      )

      expect(response.status).toBe(200)
      expect(prefsChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-123', alert_on_full: true }),
        { onConflict: 'user_id' }
      )
      expect(prefsChain.select).not.toHaveBeenCalled()
      expect(prefsChain.update).not.toHaveBeenCalled()
      expect(prefsChain.insert).not.toHaveBeenCalled()
    })
  })

  describe('PUT — bomb prefs', () => {
    beforeEach(() => {
      setUser(AUTHED_USER)
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })
    })

    it('accepts the bomb toggles and window', async () => {
      const response = await PUT(
        createPutRequest({
          ...validBody,
          alert_on_bomb_ready: true,
          alert_before_bomb_ready: true,
          alert_before_bomb_ready_minutes: 480
        })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.alert_on_bomb_ready).toBe(true)
      expect(body.prefs.alert_before_bomb_ready_minutes).toBe(480)
    })

    it('accepts 960 — the bomb window ceiling', async () => {
      const response = await PUT(
        createPutRequest({
          ...validBody,
          alert_before_bomb_ready_minutes: 960
        })
      )
      expect(response.status).toBe(200)
    })

    it('rejects 1080, the full bomb regen period', async () => {
      // 1080 minutes is a whole regen cycle: "always", not "soon".
      const response = await PUT(
        createPutRequest({
          ...validBody,
          alert_before_bomb_ready_minutes: 1080
        })
      )
      expect(response.status).toBe(400)
    })

    it('rejects a bomb window below the 15-minute floor', async () => {
      const response = await PUT(
        createPutRequest({
          ...validBody,
          alert_before_bomb_ready_minutes: 10
        })
      )
      expect(response.status).toBe(400)
    })

    it('gates a bomb-ONLY opt-in behind the Discord link (409)', async () => {
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: null },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_bomb_ready: true })
      )
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error.message).toBe('DISCORD_NOT_LINKED')
    })
  })

  describe('PUT — quiet hours', () => {
    beforeEach(() => {
      setUser(AUTHED_USER)
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })
    })

    const withQuiet = (overrides: Record<string, unknown>) => ({
      ...validBody,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      quiet_hours_timezone: 'America/New_York',
      ...overrides
    })

    it('accepts a complete, valid quiet-hours triple', async () => {
      const response = await PUT(createPutRequest(withQuiet({})))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.quiet_hours_start).toBe(22)
      expect(body.prefs.quiet_hours_timezone).toBe('America/New_York')
    })

    it('accepts an IANA LINK/alias name Intl resolves', async () => {
      // Intl.supportedValuesOf omits aliases that work fine at scan time.
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_timezone: 'US/Eastern' }))
      )
      expect(response.status).toBe(200)
    })

    it('rejects a syntactically plausible but non-existent zone', async () => {
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_timezone: 'America/Nowhere' }))
      )
      expect(response.status).toBe(400)
    })

    it('rejects quiet hours with no timezone (the DB cannot check this)', async () => {
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_timezone: null }))
      )
      expect(response.status).toBe(400)
    })

    it('rejects a partial triple missing the end hour', async () => {
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_end: null }))
      )
      expect(response.status).toBe(400)
    })

    it('rejects start === end — an empty window is not a quiet period', async () => {
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_start: 7 }))
      )
      expect(response.status).toBe(400)
    })

    it('rejects an out-of-range hour', async () => {
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_start: 24 }))
      )
      expect(response.status).toBe(400)
    })

    it('rejects a non-integer hour', async () => {
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_start: 22.5 }))
      )
      expect(response.status).toBe(400)
    })

    it('treats an all-null triple as quiet hours simply off', async () => {
      const response = await PUT(
        createPutRequest(
          withQuiet({
            quiet_hours_start: null,
            quiet_hours_end: null,
            quiet_hours_timezone: null
          })
        )
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.quiet_hours_start).toBeNull()
    })

    it('does NOT let quiet hours alone trip the Discord-link gate', async () => {
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: null },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(withQuiet({})))
      expect(response.status).toBe(200)
    })

    it('rejects a UTC-OFFSET identifier — not a name in pg_timezone_names', async () => {
      // Offset ids pass Intl but are not in pg_timezone_names and ignore DST.
      const response = await PUT(
        createPutRequest(withQuiet({ quiet_hours_timezone: '+05:00' }))
      )
      expect(response.status).toBe(400)
    })

    it('rejects a case-variant near-miss of a real zone', async () => {
      // ICU is case-insensitive; pg_timezone_names is not.
      const response = await PUT(
        createPutRequest(
          withQuiet({ quiet_hours_timezone: 'america/new_york' })
        )
      )
      expect(response.status).toBe(400)
    })

    it.each(['UTC', 'Etc/GMT-5'])(
      'accepts %s — a real pg_timezone_names entry outside supportedValuesOf',
      async (zone) => {
        const response = await PUT(
          createPutRequest(withQuiet({ quiet_hours_timezone: zone }))
        )
        expect(response.status).toBe(200)
      }
    )
  })

  describe('PUT — a partial body must not clear stored settings', () => {
    const STORED: Record<string, unknown> = {
      alert_on_full: false,
      alert_before_full: false,
      alert_before_full_minutes: 120,
      alert_on_token_gained: false,
      alert_on_bomb_ready: true,
      alert_before_bomb_ready: true,
      alert_before_bomb_ready_minutes: 480,
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      quiet_hours_timezone: 'America/New_York'
    }

    const STORED_VERSION = '2026-07-21T10:00:00.000Z'
    const STORED_ROW = { ...STORED, updated_at: STORED_VERSION }

    let prefsChain: Chain

    beforeEach(() => {
      setUser(AUTHED_USER)
      prefsChain = makeChain({ data: STORED_ROW, error: null })
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })
    })

    it('preserves omitted bomb and quiet-hours fields', async () => {
      // Without the merge an older client's partial body resets quiet hours and bomb toggles.
      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs).toEqual({
        ...STORED,
        alert_on_full: true,
        alert_on_full_repeat_hours: null,
        alert_before_quiet_hours: false,
        alert_before_quiet_hours_minutes: 30,
        alert_before_burn: false,
        alert_before_burn_minutes: 30
      })
      expect(prefsChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          alert_on_full: true,
          alert_on_bomb_ready: true,
          alert_before_bomb_ready: true,
          alert_before_bomb_ready_minutes: 480,
          quiet_hours_start: 22,
          quiet_hours_end: 7,
          quiet_hours_timezone: 'America/New_York'
        })
      )
    })

    it('preserves an omitted repeat cadence from a legacy client', async () => {
      const storedWithRepeat = {
        ...STORED,
        alert_on_full: true,
        alert_on_full_repeat_hours: 24,
        updated_at: STORED_VERSION
      }
      prefsChain = makeChain({ data: storedWithRepeat, error: null })
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.alert_on_full_repeat_hours).toBe(24)
      expect(prefsChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ alert_on_full_repeat_hours: 24 })
      )
    })

    it('clears an omitted repeat cadence when a legacy client disables full alerts', async () => {
      const storedWithRepeat = {
        ...STORED,
        alert_on_full: true,
        alert_on_full_repeat_hours: 24,
        updated_at: STORED_VERSION
      }
      prefsChain = makeChain({ data: storedWithRepeat, error: null })
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: false })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.alert_on_full_repeat_hours).toBeNull()
      expect(prefsChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          alert_on_full: false,
          alert_on_full_repeat_hours: null
        })
      )
    })

    it('ties the write to the version it read (compare-and-set)', async () => {
      // Filtering on the read's `updated_at` makes a concurrent change match zero rows.
      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )
      expect(response.status).toBe(200)

      const writeChain = (
        prefsChain.update as unknown as {
          mock: {
            results: {
              value: { eq: { mock: { calls: [string, string][] } } }
            }[]
          }
        }
      ).mock.results[0].value
      expect(writeChain.eq.mock.calls).toEqual([
        ['user_id', 'user-123'],
        ['updated_at', STORED_VERSION]
      ])
    })

    function queuePrefsChains(chains: Chain[]) {
      let next = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return makeChain({
            data: { discord_user_id: 'discord-1' },
            error: null
          })
        }
        if (table === 'user_token_alert_prefs') {
          return chains[next++] ?? chains[chains.length - 1]
        }
        return makeChain({ data: null, error: null })
      })
    }

    it('retries ONCE against a fresh read when the version moved', async () => {
      const attempt1 = makeChain(
        { data: STORED_ROW, error: null },
        { data: [], error: null }
      )
      const attempt2 = makeChain(
        { data: STORED_ROW, error: null },
        { data: [{ user_id: 'user-123' }], error: null }
      )
      queuePrefsChains([attempt1, attempt1, attempt2, attempt2])

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )

      expect(response.status).toBe(200)
      expect(attempt1.update).toHaveBeenCalled()
      expect(attempt2.update).toHaveBeenCalled()
    })

    it('409s rather than clobbering when the race is lost twice', async () => {
      prefsChain = makeChain(
        { data: STORED_ROW, error: null },
        { data: [], error: null }
      )
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )

      expect(response.status).toBe(409)
    })

    it('retries an INSERT that lost the primary-key race', async () => {
      const first = makeChain({ data: null, error: null })
      first.insert = vi.fn(async () => ({
        error: { code: '23505', message: 'duplicate key value' }
      }))
      const second = makeChain({ data: STORED_ROW, error: null })
      queuePrefsChains([first, first, second, second])

      const response = await PUT(
        createPutRequest({ ...validBody, alert_on_full: true })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(first.insert).toHaveBeenCalled()
      expect(second.update).toHaveBeenCalled()
      expect(body.prefs.alert_on_bomb_ready).toBe(true)
    })

    it('still lets an EXPLICIT null clear quiet hours', async () => {
      // Absent means "leave alone", null means "clear".
      const response = await PUT(
        createPutRequest({
          ...validBody,
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_timezone: null
        })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.quiet_hours_start).toBeNull()
      expect(body.prefs.quiet_hours_end).toBeNull()
      expect(body.prefs.quiet_hours_timezone).toBeNull()
      expect(body.prefs.alert_on_bomb_ready).toBe(true)
    })

    it('400s on a merge that would violate the all-or-none DB CHECK', async () => {
      // A partial quiet-hours triple must be a readable 400, not a raw 23514.
      const response = await PUT(
        createPutRequest({ ...validBody, quiet_hours_start: null })
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
      expect(body.error.message).toContain('quiet_hours_start')
      expect(body.error.message).toContain('quiet_hours_end')
      expect(body.error.message).toContain('quiet_hours_timezone')
      expect(prefsChain.upsert).not.toHaveBeenCalled()
      expect(prefsChain.insert).not.toHaveBeenCalled()
      expect(prefsChain.update).not.toHaveBeenCalled()
    })

    it('rejects a body that is not a JSON object', async () => {
      const response = await PUT(createPutRequest(null))
      expect(response.status).toBe(400)
    })
  })

  describe('missing-COLUMN degrade is scoped to reads', () => {
    beforeEach(() => {
      setUser(AUTHED_USER)
    })

    it('GET degrades to available:false on 42703 (rollback window)', async () => {
      // A rollback can remove phase-2 columns under a running image.
      configureFrom({
        user_token_alert_prefs: makeChain({
          data: null,
          error: { code: '42703', message: 'column ... does not exist' }
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })

    it('PUT degrades to available:false when the READ hits 42703', async () => {
      configureFrom({
        user_token_alert_prefs: makeChain({
          data: null,
          error: { code: '42703', message: 'column ... does not exist' }
        })
      })

      const response = await PUT(createPutRequest(validBody))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })

    it('PUT SURFACES a 42703 raised by the merged write instead of masking it', async () => {
      // A missing column on the WRITE is a developer bug; degrading would hide a no-op save.
      const prefsChain = makeChain({ data: null, error: null })
      prefsChain.insert = vi.fn(async () => ({
        error: { code: '42703', message: 'column "typo" does not exist' }
      }))
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(validBody))
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.available).toBeUndefined()
    })

    it('PUT still degrades when the merged write reports a missing TABLE (42P01)', async () => {
      const prefsChain = makeChain({ data: null, error: null })
      prefsChain.insert = vi.fn(async () => ({
        error: { code: '42P01', message: 'relation does not exist' }
      }))
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(validBody))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })

    // The complete-body path has no read, so a probe read disambiguates a missing column.

    it('a COMPLETE body SURFACES an upsert 42703 the probe read cannot confirm', async () => {
      const prefsChain = makeChain({ data: null, error: null })
      prefsChain.upsert = vi.fn(async () => ({
        error: { code: '42703', message: 'column "typo" does not exist' }
      }))
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(completeBody()))
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.available).toBeUndefined()
    })

    it('a COMPLETE body degrades when the probe read CONFIRMS the columns are gone', async () => {
      const prefsChain = makeChain({
        data: null,
        error: { code: '42703', message: 'column ... does not exist' }
      })
      prefsChain.upsert = vi.fn(async () => ({
        error: { code: '42703', message: 'column ... does not exist' }
      }))
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(completeBody()))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })

    it('a COMPLETE body degrades when the upsert reports a missing TABLE (42P01)', async () => {
      const prefsChain = makeChain({ data: null, error: null })
      prefsChain.upsert = vi.fn(async () => ({
        error: { code: '42P01', message: 'relation does not exist' }
      }))
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: prefsChain,
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(createPutRequest(completeBody()))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({ available: false })
    })
  })

  describe('pre-quiet and pre-burn validation', () => {
    beforeEach(() => {
      setUser(AUTHED_USER)
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: makeChain({ data: null, error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })
    })

    it('rejects the pre-quiet toggle without a quiet-hours window', async () => {
      const response = await PUT(
        createPutRequest(
          completeBody({
            alert_before_quiet_hours: true,
            quiet_hours_start: null,
            quiet_hours_end: null,
            quiet_hours_timezone: null
          })
        )
      )
      expect(response.status).toBe(400)
    })

    it('accepts the pre-quiet toggle alongside a configured window', async () => {
      const response = await PUT(
        createPutRequest(
          completeBody({
            alert_before_quiet_hours: true,
            alert_before_quiet_hours_minutes: 45,
            quiet_hours_start: 22,
            quiet_hours_end: 7,
            quiet_hours_timezone: 'America/New_York'
          })
        )
      )
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.prefs.alert_before_quiet_hours).toBe(true)
      expect(body.prefs.alert_before_quiet_hours_minutes).toBe(45)
    })

    it('bounds the pre-quiet lead to 15..180 minutes', async () => {
      for (const minutes of [10, 240]) {
        const response = await PUT(
          createPutRequest(
            completeBody({
              quiet_hours_start: 22,
              quiet_hours_end: 7,
              quiet_hours_timezone: 'America/New_York',
              alert_before_quiet_hours: true,
              alert_before_quiet_hours_minutes: minutes
            })
          )
        )
        expect(response.status).toBe(400)
      }
    })

    it('accepts 360 but rejects 361 for the burn lead', async () => {
      // Must stay under the 11h burn re-alert hysteresis.
      const ok = await PUT(
        createPutRequest(
          completeBody({
            alert_before_burn: true,
            alert_before_burn_minutes: 360
          })
        )
      )
      expect(ok.status).toBe(200)

      const tooWide = await PUT(
        createPutRequest(
          completeBody({
            alert_before_burn: true,
            alert_before_burn_minutes: 361
          })
        )
      )
      expect(tooWide.status).toBe(400)
    })

    it('gates a burn-ONLY opt-in behind the Discord link (409)', async () => {
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: null },
          error: null
        }),
        user_token_alert_prefs: makeChain({ error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest(completeBody({ alert_before_burn: true }))
      )
      expect(response.status).toBe(409)
    })

    it('follows quiet hours off when a legacy client clears them', async () => {
      // Preserving a stored `true` after quiet hours are disabled would violate the DB CHECK.
      const STORED_ROW = {
        alert_on_full: false,
        alert_on_full_repeat_hours: null,
        alert_before_full: false,
        alert_before_full_minutes: 120,
        alert_on_token_gained: false,
        alert_on_bomb_ready: false,
        alert_before_bomb_ready: false,
        alert_before_bomb_ready_minutes: 120,
        quiet_hours_start: 22,
        quiet_hours_end: 7,
        quiet_hours_timezone: 'America/New_York',
        alert_before_quiet_hours: true,
        alert_before_quiet_hours_minutes: 30,
        alert_before_burn: false,
        alert_before_burn_minutes: 30,
        updated_at: '2026-08-02T10:00:00.000Z'
      }
      configureFrom({
        player_mapping: makeChain({
          data: { discord_user_id: 'discord-1' },
          error: null
        }),
        user_token_alert_prefs: makeChain({ data: STORED_ROW, error: null }),
        user_token_alert_state: makeChain({ data: null, error: null })
      })

      const response = await PUT(
        createPutRequest({
          ...validBody,
          quiet_hours_start: null,
          quiet_hours_end: null,
          quiet_hours_timezone: null
        })
      )
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.prefs.alert_before_quiet_hours).toBe(false)
    })
  })
})
