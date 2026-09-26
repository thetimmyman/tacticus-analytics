import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

let mockRequireActiveMembershipForApi: ReturnType<typeof vi.fn>
let mockAssertUnbannedAuthUser: ReturnType<typeof vi.fn>

async function loadModule() {
  vi.resetModules()
  mockRequireActiveMembershipForApi = vi.fn()
  mockAssertUnbannedAuthUser = vi.fn().mockResolvedValue(undefined)

  vi.doMock('@/app/lib/auth', () => ({
    requireActiveMembershipForApi: mockRequireActiveMembershipForApi
  }))
  vi.doMock('@/app/lib/api/session-user', () => ({
    assertUnbannedAuthUser: mockAssertUnbannedAuthUser
  }))

  return import('@/app/lib/auth/app-admin')
}

function createDirectSupabaseMock({
  user = { id: 'auth-user-1' },
  profile = { is_app_admin: true }
}: {
  user?: { id: string } | null
  profile?: { is_app_admin: boolean } | null
} = {}) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: profile, error: null })
  }

  return {
    client: {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user } })
      },
      from: vi.fn().mockReturnValue(query)
    },
    query
  }
}

describe('app-admin auth helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('recognizes only explicit app-admin profiles', async () => {
    const { isAppAdminProfile } = await loadModule()

    expect(isAppAdminProfile({ is_app_admin: true } as never)).toBe(true)
    expect(isAppAdminProfile({ is_app_admin: false } as never)).toBe(false)
    expect(isAppAdminProfile(null)).toBe(false)
    expect(isAppAdminProfile(undefined)).toBe(false)
  })

  it('returns auth data for app admins', async () => {
    const { requireAppAdminForApi } = await loadModule()
    const auth = {
      user: { id: 'auth-user-1' },
      profile: { is_app_admin: true, user_id: 'profile-user-1' }
    }
    mockRequireActiveMembershipForApi.mockResolvedValue(auth)

    await expect(requireAppAdminForApi()).resolves.toBe(auth)
  })

  it('throws a 403 AppError for non-admin users', async () => {
    const { requireAppAdminForApi } = await loadModule()
    mockRequireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'auth-user-1' },
      profile: { is_app_admin: false, user_id: 'profile-user-1' }
    })

    await expect(requireAppAdminForApi()).rejects.toMatchObject({
      statusCode: 403,
      message: 'Admin access required'
    })
  })

  it('preserves caller-provided denial metadata', async () => {
    const { requireAppAdminForApi } = await loadModule()
    mockRequireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'auth-user-1' },
      profile: { is_app_admin: false, user_id: 'profile-user-1' }
    })

    await expect(
      requireAppAdminForApi({
        deniedMetadata: { error: 'Admin access required' }
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      metadata: { error: 'Admin access required' }
    })
  })

  it('returns profile user_id for existing service-helper callers', async () => {
    const { requireAppAdminUserIdForApi } = await loadModule()
    mockRequireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'auth-user-1' },
      profile: { is_app_admin: true, user_id: 'profile-user-1' }
    })

    await expect(requireAppAdminUserIdForApi()).resolves.toMatchObject({
      user_id: 'profile-user-1'
    })
  })

  it('throws a 403 AppError when an app-admin profile lacks user_id', async () => {
    const { requireAppAdminUserIdForApi } = await loadModule()
    mockRequireActiveMembershipForApi.mockResolvedValue({
      user: { id: 'auth-user-1' },
      profile: { is_app_admin: true, user_id: null }
    })

    await expect(requireAppAdminUserIdForApi()).rejects.toMatchObject({
      statusCode: 403,
      message: 'Admin profile missing user_id'
    })
  })

  it('direct mode returns the authenticated user for current app-admin profiles', async () => {
    const { requireCurrentAppAdminForApi } = await loadModule()
    const { client, query } = createDirectSupabaseMock()

    await expect(
      requireCurrentAppAdminForApi(client as never)
    ).resolves.toMatchObject({
      user: { id: 'auth-user-1' }
    })
    expect(client.from).toHaveBeenCalledWith('player_mapping')
    expect(query.select).toHaveBeenCalledWith('is_app_admin')
    expect(query.eq).toHaveBeenCalledWith('user_id', 'auth-user-1')
    expect(query.eq).toHaveBeenCalledWith('is_current', true)
    expect(mockAssertUnbannedAuthUser).toHaveBeenCalledWith({
      id: 'auth-user-1'
    })
  })

  it('direct mode preserves route-provided unauthorized messages and metadata', async () => {
    const { requireCurrentAppAdminForApi } = await loadModule()
    const { client } = createDirectSupabaseMock({ user: null })

    await expect(
      requireCurrentAppAdminForApi(client as never, {
        unauthorizedMessage: 'Unauthorized',
        unauthorizedMetadata: { error: 'Unauthorized' }
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      message: 'Unauthorized',
      metadata: { error: 'Unauthorized' }
    })
  })

  it('direct mode preserves route-provided forbidden messages and metadata', async () => {
    const { requireCurrentAppAdminForApi } = await loadModule()
    const { client } = createDirectSupabaseMock({
      profile: { is_app_admin: false }
    })

    await expect(
      requireCurrentAppAdminForApi(client as never, {
        deniedMessage: 'Forbidden',
        deniedMetadata: { error: 'Forbidden' }
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Forbidden',
      metadata: { error: 'Forbidden' }
    })
  })

  it('direct mode denies when no current profile is returned', async () => {
    const { requireCurrentAppAdminForApi } = await loadModule()
    const { client } = createDirectSupabaseMock({ profile: null })

    await expect(
      requireCurrentAppAdminForApi(client as never, {
        deniedMessage: 'Forbidden'
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Forbidden'
    })
  })
})
