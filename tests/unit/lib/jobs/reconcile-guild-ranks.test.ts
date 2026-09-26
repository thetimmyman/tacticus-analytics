import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (
  payload: Record<string, unknown>,
  context: {
    jobId: number
    workerId: string
    attempts: number
    softDeadlineAt?: number
  }
) => Promise<Record<string, unknown> | void>

type StoredRow = {
  id: number
  player_id: string | null
  display_name: string | null
  role: string | null
  protected: boolean | null
  is_app_admin: boolean | null
}

function mockDeps() {
  vi.doMock('@/app/lib/logging', () => ({
    createComponentLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }))
  vi.doMock('@/app/lib/errors/AppError', () => ({ rethrowIfAppError: vi.fn() }))
  vi.doMock('@/app/lib/monitoring/sentry', () => ({
    captureSentryException: vi.fn()
  }))
  vi.doMock('@/app/lib/jobs/dispatcher', () => ({
    registerJobHandler: vi.fn()
  }))
  vi.doMock('@tacticus/app-core/api-constants', () => ({
    API_URLS: { TACTICUS: { BASE: 'https://api.tacticusgame.com/api/v1' } }
  }))
  vi.doMock('@/app/lib/resilience', () => ({
    withRetry: async (fn: () => Promise<unknown>) => fn(),
    TACTICUS_API_POLICY: {}
  }))
}

describe('reconcile-guild-ranks: pure decision core', () => {
  let computeRankReconcileActions: typeof import('@/app/lib/jobs/reconcile-guild-ranks').computeRankReconcileActions
  let mapTacticusRoleToAppRole: typeof import('@/app/lib/jobs/reconcile-guild-ranks').mapTacticusRoleToAppRole

  beforeEach(async () => {
    vi.resetModules()
    mockDeps()
    vi.doMock('@/app/lib/db', () => ({ serviceDb: () => ({}) }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      resolveStoredSecret: vi.fn(async () => 'key')
    }))
    const mod = await import('@/app/lib/jobs/reconcile-guild-ranks')
    computeRankReconcileActions = mod.computeRankReconcileActions
    mapTacticusRoleToAppRole = mod.mapTacticusRoleToAppRole
  })

  afterEach(() => vi.restoreAllMocks())

  it('maps Tacticus roles to app roles (CO_LEADER and LEADER both -> leader)', () => {
    expect(mapTacticusRoleToAppRole('LEADER')).toBe('leader')
    expect(mapTacticusRoleToAppRole('GUILD_LEADER')).toBe('leader')
    expect(mapTacticusRoleToAppRole('CO_LEADER')).toBe('leader')
    expect(mapTacticusRoleToAppRole('COLEADER')).toBe('leader')
    expect(mapTacticusRoleToAppRole('OFFICER')).toBe('officer')
    expect(mapTacticusRoleToAppRole('GUILD_OFFICER')).toBe('officer')
    expect(mapTacticusRoleToAppRole('MEMBER')).toBe('member')
    expect(mapTacticusRoleToAppRole('')).toBe('member')
    expect(mapTacticusRoleToAppRole(null)).toBe('member')
    expect(mapTacticusRoleToAppRole('something-weird')).toBe('member')
  })

  const rows: StoredRow[] = [
    {
      id: 1,
      player_id: 'p-officer',
      display_name: 'Off',
      role: 'member',
      protected: false,
      is_app_admin: false
    },
    {
      id: 2,
      player_id: 'p-leader',
      display_name: 'Lead',
      role: 'member',
      protected: false,
      is_app_admin: false
    },
    {
      id: 3,
      player_id: 'p-coleader',
      display_name: 'Co',
      role: 'member',
      protected: false,
      is_app_admin: false
    },
    {
      id: 4,
      player_id: 'p-already',
      display_name: 'Already',
      role: 'officer',
      protected: false,
      is_app_admin: false
    },
    {
      id: 5,
      player_id: 'p-protected',
      display_name: 'Prot',
      role: 'member',
      protected: true,
      is_app_admin: false
    },
    {
      id: 6,
      player_id: 'p-admin',
      display_name: 'Admin',
      role: 'member',
      protected: false,
      is_app_admin: true
    },
    {
      id: 7,
      player_id: 'p-demote',
      display_name: 'Demo',
      role: 'leader',
      protected: false,
      is_app_admin: false
    },
    {
      id: 8,
      player_id: 'p-absent',
      display_name: 'Gone',
      role: 'member',
      protected: false,
      is_app_admin: false
    }
  ]

  const live = new Map<string, string>([
    ['p-officer', 'OFFICER'],
    ['p-leader', 'LEADER'],
    ['p-coleader', 'CO_LEADER'],
    ['p-already', 'OFFICER'],
    ['p-protected', 'LEADER'],
    ['p-admin', 'LEADER'],
    ['p-demote', 'MEMBER']
  ])

  it('promotes under-provisioned members to match in-game rank (promote default)', () => {
    const actions = computeRankReconcileActions(live, rows, { demote: false })
    const byId = new Map(actions.map((a) => [a.id, a]))

    expect(byId.get(1)).toMatchObject({ to: 'officer', direction: 'promote' })
    expect(byId.get(2)).toMatchObject({ to: 'leader', direction: 'promote' })
    expect(byId.get(3)).toMatchObject({ to: 'leader', direction: 'promote' })
  })

  it('does not touch already-correct, protected, admin, absent, or (default) demotion rows', () => {
    const actions = computeRankReconcileActions(live, rows, { demote: false })
    const ids = actions.map((a) => a.id)

    expect(ids).not.toContain(4) // already officer
    expect(ids).not.toContain(5) // protected
    expect(ids).not.toContain(6) // is_app_admin
    expect(ids).not.toContain(7) // demotion, disabled by default
    expect(ids).not.toContain(8) // absent from live roster
    expect(actions).toHaveLength(3)
  })

  it('applies demotions only when demote=true, still skipping protected/admin', () => {
    const actions = computeRankReconcileActions(live, rows, { demote: true })
    const byId = new Map(actions.map((a) => [a.id, a]))

    expect(byId.get(7)).toMatchObject({ to: 'member', direction: 'demote' })
    expect(byId.has(5)).toBe(false)
    expect(byId.has(6)).toBe(false)
  })
})

describe('reconcile-guild-ranks: handler payload + eligibility hardening', () => {
  let handler: Handler
  let updatePayloads: Array<Record<string, unknown>>
  let guildConfigFilters: Array<{ method: 'eq' | 'not'; args: unknown[] }>

  function setup(opts: { apiKeyIsValid?: boolean | null } = {}) {
    updatePayloads = []
    guildConfigFilters = []

    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)

    mockDeps()
    vi.doMock('@tacticus/app-core/encryption', () => ({
      resolveStoredSecret: vi.fn(async () => 'decrypted-key')
    }))

    const guildConfigQuery: Record<string, unknown> = {
      select: vi.fn(() => guildConfigQuery),
      eq: vi.fn((...args: unknown[]) => {
        guildConfigFilters.push({ method: 'eq', args })
        return guildConfigQuery
      }),
      not: vi.fn((...args: unknown[]) => {
        guildConfigFilters.push({ method: 'not', args })
        return guildConfigQuery
      }),
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (r: unknown) => unknown
      ) =>
        Promise.resolve({
          data: [
            {
              guild_code: 'G1',
              display_name: 'Guild One',
              guild_id: 'G1',
              api_key_encrypted: 'enc',
              consecutive_sync_failures: 0,
              api_key_is_valid: opts.apiKeyIsValid ?? null
            }
          ],
          error: null
        }).then(resolve, reject)
    }

    function makePlayerMappingQuery() {
      let updating = false
      const q: Record<string, unknown> = {
        select: vi.fn(() => q),
        eq: vi.fn(() => q),
        not: vi.fn(() => q),
        in: vi.fn(() => q),
        update: vi.fn((payload: Record<string, unknown>) => {
          updating = true
          updatePayloads.push(payload)
          return q
        }),
        then: (
          resolve: (v: unknown) => unknown,
          reject?: (r: unknown) => unknown
        ) =>
          Promise.resolve(
            updating
              ? { data: null, error: null }
              : {
                  data: [
                    // Elevated in-app but a member in-game: demoted only when demote === true.
                    {
                      id: 21,
                      player_id: 'p-demote',
                      display_name: 'Demo',
                      role: 'leader',
                      protected: false,
                      is_app_admin: false
                    }
                  ],
                  error: null
                }
          ).then(resolve, reject)
      }
      return q
    }

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'guild_config') return guildConfigQuery
        if (table === 'player_mapping') return makePlayerMappingQuery()
        return guildConfigQuery
      })
    }
    vi.doMock('@/app/lib/db', () => ({ serviceDb: () => supabase }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          guild: {
            guildId: 'G1',
            members: [{ userId: 'p-demote', role: 'MEMBER' }]
          }
        })
      }))
    )
  }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function loadHandler() {
    const mod = await import('@/app/lib/jobs/reconcile-guild-ranks')
    return mod.__internal.reconcileGuildRanksHandler as Handler
  }

  it("385-3: a string demote flag ('false') does NOT enable demotion", async () => {
    setup()
    handler = await loadHandler()

    const result = (await handler(
      { demote: 'false' },
      { jobId: 10, workerId: 'vitest', attempts: 1 }
    )) as Record<string, unknown>

    // The string 'false' is truthy.
    expect(updatePayloads).toHaveLength(0)
    expect(result.demoted).toBe(0)
    expect(result.demotionsDetected).toBe(1)
  })

  it('385-3: a strict boolean demote=true still applies demotions', async () => {
    setup()
    handler = await loadHandler()

    const result = (await handler(
      { demote: true },
      { jobId: 11, workerId: 'vitest', attempts: 1 }
    )) as Record<string, unknown>

    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({ role: 'member' })
    expect(result.demoted).toBe(1)
  })

  it('385-5: eligibility filter uses api_key_is_valid not.is.false (includes NULL)', async () => {
    setup({ apiKeyIsValid: null })
    handler = await loadHandler()

    await handler({}, { jobId: 12, workerId: 'vitest', attempts: 1 })

    // NULL validity must still be scanned: `.not(..., 'is', false)`, never `.eq(..., true)`.
    const usesNotIsFalse = guildConfigFilters.some(
      (f) =>
        f.method === 'not' &&
        f.args[0] === 'api_key_is_valid' &&
        f.args[1] === 'is' &&
        f.args[2] === false
    )
    const usesStrictEq = guildConfigFilters.some(
      (f) => f.method === 'eq' && f.args[0] === 'api_key_is_valid'
    )
    expect(usesNotIsFalse).toBe(true)
    expect(usesStrictEq).toBe(false)
  })
})

describe('reconcile-guild-ranks: handler issues role-only updates', () => {
  let handler: Handler
  let updatePayloads: Array<Record<string, unknown>>
  let updateIdLists: Array<unknown>
  let updateGuardFilters: Array<{ method: 'eq' | 'not'; args: unknown[] }>
  let fetchedGuildId: string

  beforeEach(async () => {
    vi.resetModules()
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    updatePayloads = []
    updateIdLists = []
    updateGuardFilters = []
    fetchedGuildId = 'G1' // matches the mocked guild_config.guild_id by default

    mockDeps()
    vi.doMock('@tacticus/app-core/encryption', () => ({
      resolveStoredSecret: vi.fn(async () => 'decrypted-key')
    }))

    const guildConfigQuery = {
      select: vi.fn(() => guildConfigQuery),
      eq: vi.fn(() => guildConfigQuery),
      not: vi.fn(() => guildConfigQuery),
      then: (resolve: (v: unknown) => void, reject?: (r: unknown) => void) =>
        Promise.resolve({
          data: [
            {
              guild_code: 'G1',
              display_name: 'Guild One',
              guild_id: 'G1',
              api_key_encrypted: 'enc',
              consecutive_sync_failures: 0
            }
          ],
          error: null
        }).then(resolve, reject)
    }

    function makePlayerMappingQuery() {
      let updating = false
      const q: Record<string, unknown> = {
        select: vi.fn(() => q),
        eq: vi.fn((...args: unknown[]) => {
          if (updating) updateGuardFilters.push({ method: 'eq', args })
          return q
        }),
        not: vi.fn((...args: unknown[]) => {
          if (updating) updateGuardFilters.push({ method: 'not', args })
          return q
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          updating = true
          updatePayloads.push(payload)
          return q
        }),
        in: vi.fn((_col: string, ids: string[]) => {
          if (updating) updateIdLists.push(ids)
          return q
        }),
        then: (resolve: (v: unknown) => void, reject?: (r: unknown) => void) =>
          Promise.resolve(
            updating
              ? { data: null, error: null }
              : {
                  data: [
                    {
                      id: 11,
                      player_id: 'p-officer',
                      display_name: 'Off',
                      role: 'member',
                      protected: false,
                      is_app_admin: false
                    },
                    {
                      id: 12,
                      player_id: 'p-protected',
                      display_name: 'Prot',
                      role: 'member',
                      protected: true,
                      is_app_admin: false
                    },
                    {
                      id: 13,
                      player_id: 'p-ok',
                      display_name: 'Ok',
                      role: 'leader',
                      protected: false,
                      is_app_admin: false
                    }
                  ],
                  error: null
                }
          ).then(resolve, reject)
      }
      return q
    }

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'guild_config') return guildConfigQuery
        if (table === 'player_mapping') return makePlayerMappingQuery()
        return guildConfigQuery
      })
    }
    vi.doMock('@/app/lib/db', () => ({ serviceDb: () => supabase }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          guild: {
            guildId: fetchedGuildId,
            members: [
              { userId: 'p-officer', role: 'OFFICER' },
              { userId: 'p-protected', role: 'LEADER' },
              { userId: 'p-ok', role: 'LEADER' }
            ]
          }
        })
      }))
    )

    const mod = await import('@/app/lib/jobs/reconcile-guild-ranks')
    handler = mod.__internal.reconcileGuildRanksHandler as Handler
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('promotes only the under-provisioned non-protected member, role-only', async () => {
    const result = (await handler(
      {},
      { jobId: 1, workerId: 'vitest', attempts: 1 }
    )) as Record<string, unknown>

    expect(result.promoted).toBe(1)
    expect(result.scanned).toBe(1)
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({ role: 'officer' })
    expect(Object.keys(updatePayloads[0]!).sort()).toEqual([
      'role',
      'updated_at'
    ])
    expect(updateIdLists).toEqual([[11]])
  })

  it('385-2/385-4: the UPDATE carries write-time protection + old-role guards', async () => {
    await handler({}, { jobId: 3, workerId: 'vitest', attempts: 1 })

    // Guards ride the UPDATE so a row changed after the SELECT is never clobbered.
    const hasOldRoleGuard = updateGuardFilters.some(
      (f) => f.method === 'eq' && f.args[0] === 'role' && f.args[1] === 'member'
    )
    const hasProtectedGuard = updateGuardFilters.some(
      (f) =>
        f.method === 'not' &&
        f.args[0] === 'protected' &&
        f.args[1] === 'is' &&
        f.args[2] === true
    )
    const hasAdminGuard = updateGuardFilters.some(
      (f) =>
        f.method === 'not' &&
        f.args[0] === 'is_app_admin' &&
        f.args[1] === 'is' &&
        f.args[2] === true
    )

    expect(hasOldRoleGuard).toBe(true)
    expect(hasProtectedGuard).toBe(true)
    expect(hasAdminGuard).toBe(true)
  })

  it('skips a guild whose fetched roster belongs to a DIFFERENT guildId (payload_guild_id_mismatch)', async () => {
    fetchedGuildId = 'SOME-OTHER-GUILD' // key owner left & joined elsewhere

    const result = (await handler(
      {},
      { jobId: 2, workerId: 'vitest', attempts: 1 }
    )) as Record<string, unknown>

    expect(updatePayloads).toHaveLength(0)
    expect(updateIdLists).toHaveLength(0)
    expect(result.promoted).toBe(0)
    expect(result.scanned).toBe(0)
    expect(result.mismatched).toBe(1)
  })
})
