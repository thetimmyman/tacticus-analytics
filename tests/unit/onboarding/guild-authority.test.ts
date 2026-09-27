import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>

/** Nothing the client can write may influence which guild a caller may act on. */

const USER = '00000000-0000-4000-8000-000000000003'

let queues: Record<string, Array<{ data: unknown; error: unknown }>>
let eqFilters: Record<string, Array<[string, unknown]>>
let mockGetGuild: AnyMock
let mockDecryptApiKey: AnyMock
let service: { from: AnyMock }

function chainFor(table: string) {
  const next = () => queues[table]?.shift() ?? { data: null, error: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'order', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  // Filters are recorded: a filter-ignoring mock would elevate seats in other guilds.
  chain.eq = vi.fn((column: string, value: unknown) => {
    ;(eqFilters[table] ??= []).push([column, value])
    return chain
  })
  chain.maybeSingle = vi.fn(async () => next())
  chain.single = vi.fn(async () => next())
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(next()).then(resolve)
  return chain
}

const asStored = (plaintext: string) => `enc:${plaintext}`

function arrangeStoredCredential(stored: string | null) {
  queues.guild_config = [
    ...(queues.guild_config ?? []),
    { data: { api_key_encrypted: stored }, error: null }
  ]
}

async function loadModule() {
  return import('@/app/lib/onboarding/guild-authority')
}

describe('resolveAuthorizedGuildCode', () => {
  beforeEach(() => {
    vi.resetModules()
    queues = {}
    eqFilters = {}
    mockGetGuild = vi.fn()
    mockDecryptApiKey = vi.fn(async (stored: string) =>
      stored.replace(/^enc:/, '')
    )
    service = { from: vi.fn((table: string) => chainFor(table)) }

    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      TACTICUS_CIRCUIT_NAME: 'tacticus-api',
      tacticusAPI: { getGuild: mockGetGuild, getPlayer: vi.fn() }
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      decryptApiKey: (...args: unknown[]) => mockDecryptApiKey(...args)
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the API key path', () => {
    it('maps the upstream guild id through guild_config, not through any input', async () => {
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-1', members: [] })
      queues.guild_config = [{ data: { guild_code: 'ZKFPH' }, error: null }]
      queues.player_mapping = [{ data: [{ role: 'leader' }], error: null }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({
        ok: true,
        guildCode: 'ZKFPH',
        guildId: 'guild-uuid-1',
        source: 'api_key'
      })
    })

    it('lets the key pick the guild, then reads the roster SCOPED TO THAT GUILD', async () => {
      // A key proves which guild, not leadership, so the roster of the KEY's guild is consulted.
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-1', members: [] })
      queues.guild_config = [{ data: { guild_code: 'ZKFPH' }, error: null }]
      queues.player_mapping = [{ data: [{ role: 'leader' }], error: null }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({ ok: true, guildCode: 'ZKFPH' })
      expect(service.from).toHaveBeenCalledWith('player_mapping')
      expect(eqFilters.player_mapping).toEqual(
        expect.arrayContaining([
          ['user_id', USER],
          ['guild_code', 'ZKFPH'],
          ['is_current', true]
        ])
      )
    })

    it('refuses a guild that upstream knows about but we have not registered', async () => {
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-unknown' })
      queues.guild_config = [{ data: null, error: null }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({ ok: false, code: 'GUILD_NOT_REGISTERED' })
    })

    it('distinguishes a scopeless key from a Tacticus outage', async () => {
      mockGetGuild.mockResolvedValue(null)

      const { resolveAuthorizedGuildCode } = await loadModule()
      const healthy = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })
      expect(healthy).toMatchObject({
        ok: false,
        code: 'GUILD_SCOPE_REQUIRED',
        status: 400
      })

      const { circuitRegistry } = await import('@/app/lib/resilience')
      vi.spyOn(circuitRegistry, 'getState').mockReturnValue('OPEN')

      const down = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })
      expect(down).toMatchObject({
        ok: false,
        code: 'TACTICUS_UNAVAILABLE',
        status: 503
      })
    })

    it('does not treat a read failure as a caller-attributable rejection', async () => {
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-1' })
      queues.guild_config = [{ data: null, error: { message: 'boom' } }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'AUTHORITY_LOOKUP_FAILED'
      })
    })
  })

  /** Standing needs a leader/officer seat in the key's guild, or custody of the credential the sync spends. */
  describe('the API key path: elevation', () => {
    function arrangeKeyNamesZkfph() {
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-1', members: [] })
      queues.guild_config = [{ data: { guild_code: 'ZKFPH' }, error: null }]
    }

    it('REFUSES an ordinary member holding a perfectly valid guild-readable key', async () => {
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [{ role: 'member' }], error: null }]
      arrangeStoredCredential(asStored('GUILD-KEY'))

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'MEMBER-KEY'
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'GUILD_ELEVATION_REQUIRED',
        status: 403
      })
    })

    it('ALLOWS a freshly registered leader who has no seat yet but holds the registered key', async () => {
      // Deadlock guard: empty roster; only the just-stored key registration.
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [], error: null }]
      arrangeStoredCredential(asStored('REGISTRAR-KEY'))

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'REGISTRAR-KEY'
      })

      expect(result).toMatchObject({
        ok: true,
        guildCode: 'ZKFPH',
        source: 'api_key',
        elevation: 'registered_credential'
      })
    })

    it('REFUSES an unlinked caller who holds no seat anywhere and a different key', async () => {
      // Holding no seat is not a bootstrap signal: many guilds have no linked leader.
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [], error: null }]
      arrangeStoredCredential(asStored('REGISTRAR-KEY'))

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'SOME-OTHER-MEMBERS-KEY'
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'GUILD_ELEVATION_REQUIRED'
      })
    })

    it('accepts a linked leader without ever decrypting the stored credential', async () => {
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [{ role: 'officer' }], error: null }]
      arrangeStoredCredential(asStored('GUILD-KEY'))

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'OFFICERS-OWN-KEY'
      })

      expect(result).toMatchObject({
        ok: true,
        guildCode: 'ZKFPH',
        elevation: 'roster_seat'
      })
      expect(mockDecryptApiKey).not.toHaveBeenCalled()
    })

    it('lets a leader of two guilds sync the one whose key they presented', async () => {
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-b', members: [] })
      queues.guild_config = [{ data: { guild_code: 'BEEG' }, error: null }]
      queues.player_mapping = [{ data: [{ role: 'leader' }], error: null }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-guild-b'
      })

      expect(result).toMatchObject({
        ok: true,
        guildCode: 'BEEG',
        elevation: 'roster_seat'
      })
      expect(eqFilters.player_mapping).toContainEqual(['guild_code', 'BEEG'])
    })

    it('tolerates stored whitespace but not a shared prefix', async () => {
      const REAL = 'sk-live-abcdefghijklmnopqrstuvwxyz-tail'
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [], error: null }]
      arrangeStoredCredential(asStored(`${REAL}\n`))

      const { resolveAuthorizedGuildCode } = await loadModule()
      const trimmed = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: REAL
      })
      expect(trimmed).toMatchObject({
        ok: true,
        elevation: 'registered_credential'
      })

      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [], error: null }]
      arrangeStoredCredential(asStored(REAL))

      const prefix = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live-abcdefghijklmnopqrstuvwxyz'
      })
      expect(prefix).toMatchObject({
        ok: false,
        code: 'GUILD_ELEVATION_REQUIRED'
      })
    })

    it('reports a decrypt failure as OUR fault, never as the caller lacking standing', async () => {
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [], error: null }]
      arrangeStoredCredential(asStored('GUILD-KEY'))
      mockDecryptApiKey.mockRejectedValue(
        new Error('Ciphertext failed AES-GCM authentication')
      )

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'AUTHORITY_LOOKUP_FAILED',
        status: 503
      })
    })

    it('REFUSES, without crashing, when the guild has no stored credential', async () => {
      // The sync would fail on this row too, so failing closed costs nothing.
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: [], error: null }]
      arrangeStoredCredential(null)

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'GUILD_ELEVATION_REQUIRED',
        status: 403
      })
      expect(mockDecryptApiKey).not.toHaveBeenCalled()
    })

    it('does not turn a failed seat read into a refusal', async () => {
      arrangeKeyNamesZkfph()
      queues.player_mapping = [{ data: null, error: { message: 'boom' } }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: 'sk-live'
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'AUTHORITY_LOOKUP_FAILED'
      })
      expect(mockDecryptApiKey).not.toHaveBeenCalled()
    })
  })

  describe('the guild-NAMING primitive', () => {
    it('proves no standing, so the invite-claim corridor still accepts a member key', async () => {
      // Invite claim-consume calls this for ordinary members, so elevation is not gated here.
      mockGetGuild.mockResolvedValue({ guildId: 'guild-uuid-1', members: [] })
      queues.guild_config = [{ data: { guild_code: 'ZKFPH' }, error: null }]

      const { resolveGuildFromApiKey } = await loadModule()
      const result = await resolveGuildFromApiKey(
        service as never,
        'ORDINARY-MEMBER-KEY'
      )

      expect(result).toMatchObject({
        ok: true,
        guildCode: 'ZKFPH',
        source: 'api_key',
        elevation: null
      })
      expect(service.from).not.toHaveBeenCalledWith('player_mapping')
      expect(mockDecryptApiKey).not.toHaveBeenCalled()
    })
  })

  describe('the roster-seat path', () => {
    it.each([['leader'], ['officer'], ['LEADER'], ['Officer']])(
      'accepts a single current %s seat',
      async (role) => {
        queues.player_mapping = [
          { data: [{ guild_code: 'ZKFPH', role }], error: null }
        ]

        const { resolveAuthorizedGuildCode } = await loadModule()
        const result = await resolveAuthorizedGuildCode({
          service: service as never,
          userId: USER
        })

        expect(result).toMatchObject({
          ok: true,
          guildCode: 'ZKFPH',
          source: 'roster_seat'
        })
      }
    )

    it('REFUSES a plain member — a member may not spend the guild credential', async () => {
      queues.player_mapping = [
        { data: [{ guild_code: 'ZKFPH', role: 'member' }], error: null }
      ]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'GUILD_ATTESTATION_REQUIRED',
        status: 409
      })
    })

    it('REFUSES rather than guesses across two elevated seats', async () => {
      queues.player_mapping = [
        {
          data: [
            { guild_code: 'ZKFPH', role: 'leader' },
            { guild_code: 'OTHERG', role: 'officer' }
          ],
          error: null
        }
      ]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'GUILD_ATTESTATION_REQUIRED'
      })
    })

    it('collapses duplicate rows for the same guild into one grant', async () => {
      queues.player_mapping = [
        {
          data: [
            { guild_code: 'ZKFPH', role: 'leader' },
            { guild_code: 'ZKFPH', role: 'officer' }
          ],
          error: null
        }
      ]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER
      })

      expect(result).toMatchObject({ ok: true, guildCode: 'ZKFPH' })
    })

    it('REFUSES when the caller holds no seat at all', async () => {
      queues.player_mapping = [{ data: [], error: null }]

      const { resolveAuthorizedGuildCode } = await loadModule()
      const result = await resolveAuthorizedGuildCode({
        service: service as never,
        userId: USER,
        apiKey: '   '
      })

      expect(result).toMatchObject({
        ok: false,
        code: 'GUILD_ATTESTATION_REQUIRED'
      })
    })
  })
})
