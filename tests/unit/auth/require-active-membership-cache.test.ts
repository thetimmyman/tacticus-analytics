/**
 * Tests request-scoped deduplication of `requireActiveMembership` via
 * `cacheCompat` using React 19's `react-server` argument-arity trie (`WeakMap`
 * for objects, `Map` for primitives; `vi.resetModules()` isolates requests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react')
  const cache = <T extends (...args: unknown[]) => unknown>(fn: T): T => {
    type Node = {
      s: 0 | 1 | 2
      v: unknown
      o: WeakMap<object, Node> | null
      p: Map<unknown, Node> | null
    }
    const makeNode = (): Node => ({ s: 0, v: undefined, o: null, p: null })
    const root = makeNode()
    return ((...args: unknown[]) => {
      let node = root
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]
        if (
          typeof arg === 'function' ||
          (typeof arg === 'object' && arg !== null)
        ) {
          if (!node.o) node.o = new WeakMap()
          let next = node.o.get(arg)
          if (!next) {
            next = makeNode()
            node.o.set(arg, next)
          }
          node = next
        } else {
          if (!node.p) node.p = new Map()
          let next = node.p.get(arg)
          if (!next) {
            next = makeNode()
            node.p.set(arg, next)
          }
          node = next
        }
      }
      if (node.s === 1) return node.v
      if (node.s === 2) throw node.v
      try {
        const result = fn(...args)
        node.s = 1
        node.v = result
        return result
      } catch (error) {
        node.s = 2
        node.v = error
        throw error
      }
    }) as T
  }
  return { ...actual, cache }
})

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(),
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

const banLookupMocks = vi.hoisted(() => ({
  findActiveBanForAuthUser: vi.fn(),
  findActiveBanForUser: vi.fn()
}))

vi.mock('@/app/lib/auth/user-bans', () => banLookupMocks)

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
}))

const createMockUser = () => ({
  id: 'user-123',
  email: 'test@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
})

const createMockProfile = () => ({
  id: 101,
  player_id: 'player-123',
  user_id: 'user-123',
  display_name: 'TestUser',
  guild_code: 'TEST',
  role: 'member' as const,
  is_app_admin: false,
  is_current: true,
  ownership_attestation_id: '11111111-1111-4111-8111-111111111111',
  timezone: 'UTC',
  avatar_url: null
})

const createVerifiedPlayerRow = () => ({
  mapping_id: 101,
  player_id: 'player-123',
  user_id: 'user-123',
  guild_code: 'TEST',
  role: 'member',
  is_app_admin: false,
  ownership_attestation_id: '11111111-1111-4111-8111-111111111111'
})

type MockClient = {
  auth: { getUser: ReturnType<typeof vi.fn> }
  rpc: ReturnType<typeof vi.fn>
  from: ReturnType<typeof vi.fn>
}

const createMockClient = (
  user: ReturnType<typeof createMockUser> | null,
  profile: ReturnType<typeof createMockProfile> | null = createMockProfile()
): MockClient => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user }, error: null })
  },
  rpc: vi
    .fn()
    .mockResolvedValue({ data: [createVerifiedPlayerRow()], error: null }),
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: profile,
            error: null
          })
        })
      })
    })
  })
})

describe('requireActiveMembership request deduplication', () => {
  let dbClient: MockClient
  let serviceClient: MockClient

  beforeEach(async () => {
    vi.resetModules()

    banLookupMocks.findActiveBanForUser.mockResolvedValue(null)
    banLookupMocks.findActiveBanForAuthUser.mockResolvedValue(null)

    dbClient = createMockClient(createMockUser())
    serviceClient = createMockClient(createMockUser())

    const { db, serviceDb } = await import('@/app/lib/db')
    vi.mocked(db).mockReturnValue(dbClient as unknown as ReturnType<typeof db>)
    vi.mocked(serviceDb).mockReturnValue(
      serviceClient as unknown as ReturnType<typeof serviceDb>
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shares one lookup across layout requireAuth, war-room requireRole, and zero-arg or undefined requireActiveMembership', async () => {
    const { requireAuth, requireRole, requireActiveMembership } =
      await import('@/app/lib/auth')

    const [layout, warRoom, directZeroArg, explicitUndefined] =
      await Promise.all([
        requireAuth(),
        requireRole('member'),
        requireActiveMembership(),
        requireActiveMembership(undefined)
      ])

    expect(warRoom).toBe(layout)
    expect(directZeroArg).toBe(layout)
    expect(explicitUndefined).toBe(layout)
    expect(dbClient.auth.getUser).toHaveBeenCalledTimes(1)
    expect(dbClient.from).toHaveBeenCalledTimes(1)
    expect(serviceClient.rpc).toHaveBeenCalledTimes(1)
    expect(banLookupMocks.findActiveBanForUser).toHaveBeenCalledTimes(1)
    expect(warRoom.profile.guild_code).toBe('TEST')
  })

  it('keeps distinct cache entries for distinct client arguments while deduplicating identical client references', async () => {
    const otherClient = createMockClient(createMockUser())

    const { requireAuth, requireRole, requireActiveMembership } =
      await import('@/app/lib/auth')

    const typedOther = otherClient as unknown as Parameters<
      typeof requireActiveMembership
    >[0]

    const [viaDefault, viaClient, viaSameClientRole] = await Promise.all([
      requireAuth(),
      requireActiveMembership(typedOther),
      requireRole('member', typedOther)
    ])

    expect(dbClient.auth.getUser).toHaveBeenCalledTimes(1)
    expect(otherClient.auth.getUser).toHaveBeenCalledTimes(1)
    expect(dbClient.from).toHaveBeenCalledTimes(1)
    expect(otherClient.from).toHaveBeenCalledTimes(1)
    expect(viaDefault).not.toBe(viaClient)
    expect(viaSameClientRole).toBe(viaClient)
  })

  it('replays cached login redirect rejections across callers without re-querying', async () => {
    dbClient = createMockClient(null, null)
    const { db } = await import('@/app/lib/db')
    vi.mocked(db).mockReturnValue(dbClient as unknown as ReturnType<typeof db>)

    const { requireAuth, requireRole, requireActiveMembership } =
      await import('@/app/lib/auth')

    const results = await Promise.allSettled([
      requireAuth(),
      requireRole('member'),
      requireActiveMembership()
    ])

    const reasons = results.map((result) => {
      expect(result.status).toBe('rejected')
      return (result as PromiseRejectedResult).reason as Error
    })

    for (const reason of reasons) {
      expect(reason).toBeInstanceOf(Error)
      expect(reason.message).toBe('REDIRECT:/auth/login?reason=required')
    }
    expect(reasons[1]).toBe(reasons[0])
    expect(reasons[2]).toBe(reasons[0])
    // One logical probe (membership check + login gate), not two per caller.
    expect(dbClient.auth.getUser).toHaveBeenCalledTimes(2)
  })

  it('replays cached suspension redirect rejections across callers without re-querying', async () => {
    banLookupMocks.findActiveBanForUser.mockResolvedValue({
      id: 'ban-1',
      reason: 'policy'
    })

    const { requireAuth, requireRole } = await import('@/app/lib/auth')

    const results = await Promise.allSettled([
      requireAuth(),
      requireRole('member')
    ])

    const reasons = results.map((result) => {
      expect(result.status).toBe('rejected')
      return (result as PromiseRejectedResult).reason as Error
    })

    expect(reasons[0].message).toBe('REDIRECT:/auth/suspended')
    expect(reasons[1]).toBe(reasons[0])
    expect(dbClient.auth.getUser).toHaveBeenCalledTimes(1)
    expect(banLookupMocks.findActiveBanForUser).toHaveBeenCalledTimes(1)
  })
})
