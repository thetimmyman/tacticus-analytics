import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OnboardingProgress } from '@tacticus/app-core/onboarding.types'
import OnboardingDashboardClient from '@/app/(public)/onboarding/dashboard/OnboardingDashboardClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
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

function progressFixture(
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

function renderWith(overrides: Partial<OnboardingProgress>) {
  return render(
    <OnboardingDashboardClient
      user={{ id: 'user-1', email: 'leader@example.com', displayName: null }}
      initialProgress={progressFixture(overrides)}
      initialSyncStatus={null}
      initialJob={null}
      initialCluster={null}
      initialClusterGuilds={[]}
    />
  )
}

describe('onboarding Step 1 — failure message', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({})
      }))
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the stored remediation instead of a bare red chip', () => {
    renderWith({
      guild_status: 'failed',
      guild_error_message:
        'This guild is already registered. Use the "Existing Guild" option.'
    })

    expect(screen.getByText('Guild setup failed')).toBeTruthy()
    expect(
      screen.getByText(
        'This guild is already registered. Use the "Existing Guild" option.'
      )
    ).toBeTruthy()
  })

  it('falls back to a generic sentence when no message was stored', () => {
    renderWith({ guild_status: 'failed', guild_error_message: null })

    expect(screen.getByText('Guild setup failed')).toBeTruthy()
    expect(
      screen.getByText('Please check the details above and try again.')
    ).toBeTruthy()
  })

  it('shows no banner while Step 1 has not failed', () => {
    renderWith({ guild_status: 'complete', guild_code: 'ZKFPH' })

    expect(screen.queryByText('Guild setup failed')).toBeNull()
  })

  // Legacy rows can hold a serialized AppError with PostgREST text, a foreign guild UUID and a path.
  it('never replays a legacy serialized-error blob at the user', () => {
    renderWith({
      guild_status: 'failed',
      guild_error_message:
        '{"code":5001,"metadata":{"endpoint":"/api/guild/create-config","details":"Key (guild_id)=(11111111-1111-1111-1111-111111111111) already exists."}}'
    })

    const card = screen.getByText('Guild setup failed').closest('div')
      ?.parentElement as HTMLElement
    for (const secret of [
      'guild_id',
      '/api/guild/create-config',
      '11111111-1111-1111-1111-111111111111'
    ]) {
      expect(document.body.textContent).not.toContain(secret)
      expect(card.textContent).not.toContain(secret)
    }
    expect(
      screen.getByText('Please check the details above and try again.')
    ).toBeTruthy()
  })

  it('uses the identical banner markup as the sync step', () => {
    renderWith({
      guild_status: 'failed',
      guild_error_message: 'Guild registration timed out. Please retry.',
      sync_status: 'failed',
      sync_error_message: 'Sync blew up.'
    })

    // 'Sync failed' is also Step 2's chip, so target the banner title.
    const bannerRoot = (title: HTMLElement) =>
      title.closest('div')?.parentElement
    const guildBanner = bannerRoot(screen.getByText('Guild setup failed'))
    const syncTitle = screen
      .getAllByText('Sync failed')
      .find((element) => element.tagName === 'P') as HTMLElement
    const syncBanner = bannerRoot(syncTitle)

    expect(guildBanner?.className).toBe(syncBanner?.className)
    expect(guildBanner?.className).toContain('border-red-500/40')
  })
})
