import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingProgress } from '@tacticus/app-core/onboarding.types'
import OnboardingDashboardClient from '@/app/(public)/onboarding/dashboard/OnboardingDashboardClient'

const routerRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: routerRefresh })
}))

vi.mock('@/app/hooks/useToast', () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  })
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: vi.fn()
  })
}))

vi.mock('@/app/(public)/onboarding/dashboard/ClusterOnboardingCard', () => ({
  ClusterOnboardingCard: () => <div data-testid="cluster-card" />
}))

function freshProgress(
  overrides: Partial<OnboardingProgress> = {}
): OnboardingProgress {
  return {
    user_id: 'user-1',
    guild_mode: 'new_guild',
    role_intent: 'member',
    guild_status: 'not_started',
    guild_code: null,
    guild_name: null,
    guild_error_message: null,
    guild_can_retry: true,
    guild_lock_expires_at: null,
    sync_status: 'not_started',
    sync_progress: 0,
    sync_records_synced: 0,
    sync_error_message: null,
    sync_can_retry: true,
    profile_status: 'not_started',
    player_id: null,
    player_name: null,
    profile_error_message: null,
    profile_can_retry: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides
  }
}

const REGISTERED = freshProgress({
  role_intent: 'leader',
  guild_status: 'complete',
  guild_code: 'ZKFPH',
  guild_name: 'Claim Test Guild',
  sync_status: 'complete'
})

function renderDashboard() {
  return render(
    <OnboardingDashboardClient
      user={{ id: 'user-1', email: 'leader@example.com', displayName: null }}
      initialProgress={freshProgress()}
      initialSyncStatus={null}
      initialJob={null}
      initialCluster={null}
      initialClusterGuilds={[]}
      // guild_code is NULL right after signup, so the client must refetch the answer.
      guildAwaitingFirstClaim={false}
    />
  )
}

async function registerGuild(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /register new guild/i }))
  await user.type(screen.getByLabelText('Guild code'), 'ZKFPH')
  await user.type(screen.getByLabelText('Guild name'), 'Claim Test Guild')
  await user.type(
    screen.getByLabelText('Guild leader API key'),
    'guild-and-player-key'
  )
  await user.click(screen.getByRole('button', { name: /^register guild$/i }))
}

describe('onboarding dashboard — seat claim appears in the session that registers the guild', () => {
  beforeEach(() => {
    routerRefresh.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A one-shot RSC prop computed before the guild existed hid the widget until reload.
  it('reveals the seat claim after registration, with no reload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/onboarding/guild/start')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ progress: REGISTERED })
          } as Response
        }
        if (url.includes('/api/onboarding/progress')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              progress: REGISTERED,
              syncStatus: null,
              job: null,
              cluster: null,
              clusterGuilds: [],
              guildAwaitingFirstClaim: true
            })
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response
      })
    )

    const user = userEvent.setup()
    renderDashboard()

    expect(
      screen.queryByRole('button', { name: /link my profile/i })
    ).toBeNull()

    await registerGuild(user)

    expect(
      await screen.findByRole('button', { name: /link my profile/i })
    ).toBeTruthy()
    expect(routerRefresh).not.toHaveBeenCalled()
    expect(
      screen.getByRole('link', { name: /enter invite code/i })
    ).toBeTruthy()
  })

  // For one round trip guildComplete is true while the flag is stale.
  it('never shows the officer dead end between submit and answer', async () => {
    let releaseProgress: (() => void) | null = null
    const progressGate = new Promise<void>((resolve) => {
      releaseProgress = resolve
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/onboarding/guild/start')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ progress: REGISTERED })
          } as Response
        }
        if (url.includes('/api/onboarding/progress')) {
          await progressGate
          return {
            ok: true,
            status: 200,
            json: async () => ({
              progress: REGISTERED,
              syncStatus: null,
              job: null,
              cluster: null,
              clusterGuilds: [],
              guildAwaitingFirstClaim: true
            })
          } as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response
      })
    )

    const user = userEvent.setup()
    renderDashboard()

    await registerGuild(user)

    expect(
      await screen.findByText(/Checking how you can claim your seat/)
    ).toBeTruthy()
    expect(
      screen.queryByText(/Ask a guild officer or administrator/)
    ).toBeNull()
    expect(
      screen.getByRole('link', { name: /enter invite code/i })
    ).toBeTruthy()

    releaseProgress?.()

    expect(
      await screen.findByRole('button', { name: /link my profile/i })
    ).toBeTruthy()
    expect(
      screen.queryByText(/Ask a guild officer or administrator/)
    ).toBeNull()
  })
})
