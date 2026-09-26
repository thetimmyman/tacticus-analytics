import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingDashboardPage from '@/app/(public)/onboarding/dashboard/page'

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  serviceDb: vi.fn(),
  requireAuthAllowInactive: vi.fn(),
  getOrCreateOnboardingProgress: vi.fn(),
  fetchLatestJobForGuild: vi.fn(),
  isGuildAwaitingFirstClaim: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  })
}))

vi.mock('@/app/lib/db', () => ({
  db: mocks.db,
  serviceDb: mocks.serviceDb
}))

vi.mock('@/app/lib/auth', () => ({
  requireAuthAllowInactive: mocks.requireAuthAllowInactive
}))

vi.mock('@/app/lib/onboarding/progress', () => ({
  getOrCreateOnboardingProgress: mocks.getOrCreateOnboardingProgress
}))

vi.mock('@/app/lib/onboarding/jobs', () => ({
  fetchLatestJobForGuild: mocks.fetchLatestJobForGuild
}))

vi.mock('@/app/lib/onboarding/first-claim', () => ({
  isGuildAwaitingFirstClaim: mocks.isGuildAwaitingFirstClaim
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

vi.mock(
  '@/app/(public)/onboarding/dashboard/OnboardingDashboardClient',
  () => ({
    default: () => <div data-testid="onboarding-dashboard" />
  })
)

const authClient = {
  auth: { getUser: vi.fn() }
}

function createMembershipServiceClient(
  data: Array<{ is_current: boolean }> | null,
  error: { message: string } | null = null
) {
  const query = {
    select: vi.fn(),
    eq: vi.fn()
  }
  query.select.mockReturnValue(query)
  query.eq.mockResolvedValue({ data, error })

  return {
    from: vi.fn(() => query)
  }
}

describe('OnboardingDashboardPage membership boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isGuildAwaitingFirstClaim.mockResolvedValue(false)
    mocks.db.mockResolvedValue(authClient)
    mocks.requireAuthAllowInactive.mockResolvedValue({
      id: 'onboarding-user',
      email: 'onboarding@example.com'
    })
    authClient.auth.getUser.mockResolvedValue({
      data: {
        user: { id: 'onboarding-user', email: 'onboarding@example.com' }
      },
      error: null
    })
  })

  it('redirects an inactive account before loading historical progress', async () => {
    const serviceClient = createMembershipServiceClient([{ is_current: false }])
    mocks.serviceDb.mockReturnValue(serviceClient)

    await expect(OnboardingDashboardPage()).rejects.toThrow(
      'NEXT_REDIRECT:/home'
    )

    expect(serviceClient.from).toHaveBeenCalledOnce()
    expect(serviceClient.from).toHaveBeenCalledWith('player_mapping')
    expect(mocks.getOrCreateOnboardingProgress).not.toHaveBeenCalled()
  })

  it.each(['none', 'active'] as const)(
    'allows a %s membership past the inactive gate',
    async (membershipStatus) => {
      const serviceClient = createMembershipServiceClient(
        membershipStatus === 'active' ? [{ is_current: true }] : []
      )
      mocks.serviceDb.mockReturnValue(serviceClient)
      mocks.getOrCreateOnboardingProgress.mockResolvedValue(null)

      await expect(OnboardingDashboardPage()).rejects.toThrow(
        'NEXT_REDIRECT:/auth/error?error=onboarding_progress_missing'
      )

      expect(mocks.serviceDb).toHaveBeenCalledOnce()
      expect(mocks.getOrCreateOnboardingProgress).toHaveBeenCalledWith(
        serviceClient,
        'onboarding-user'
      )
    }
  )

  it('fails closed on a membership query error before progress or service data reads', async () => {
    const serviceClient = createMembershipServiceClient(null, {
      message: 'lookup unavailable'
    })
    mocks.serviceDb.mockReturnValue(serviceClient)

    await expect(OnboardingDashboardPage()).rejects.toThrow(
      'NEXT_REDIRECT:/auth/error?error=membership_lookup_failed'
    )

    expect(serviceClient.from).toHaveBeenCalledTimes(1)
    expect(serviceClient.from).toHaveBeenCalledWith('player_mapping')
    expect(mocks.getOrCreateOnboardingProgress).not.toHaveBeenCalled()
    expect(mocks.fetchLatestJobForGuild).not.toHaveBeenCalled()
  })

  // The page and GET /api/onboarding/progress share one helper; drift hides the seat-claim widget.
  it('passes the shared first-claim helper result through as a boolean prop', async () => {
    // Permissive chain, so removing the helper fails the assertion, not the mock.
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'not', 'order', 'limit']) {
      chain[method] = vi.fn(() => chain)
    }
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    chain.single = vi.fn(async () => ({ data: null, error: null }))
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve)
    const serviceClient = { from: vi.fn(() => chain) }
    mocks.serviceDb.mockReturnValue(serviceClient)
    mocks.getOrCreateOnboardingProgress.mockResolvedValue({
      user_id: 'onboarding-user',
      guild_mode: 'new_guild',
      role_intent: 'member',
      guild_status: 'complete',
      guild_code: 'ZKFPH',
      guild_name: 'Claim Test Guild',
      sync_status: 'complete',
      profile_status: 'not_started'
    })
    mocks.fetchLatestJobForGuild.mockResolvedValue(null)
    mocks.isGuildAwaitingFirstClaim.mockResolvedValue(true)

    const element = (await OnboardingDashboardPage()) as {
      props: Record<string, unknown>
    }

    expect(mocks.isGuildAwaitingFirstClaim).toHaveBeenCalledWith(
      serviceClient,
      'ZKFPH',
      'onboarding-user'
    )
    expect(element.props.guildAwaitingFirstClaim).toBe(true)
  })
})
