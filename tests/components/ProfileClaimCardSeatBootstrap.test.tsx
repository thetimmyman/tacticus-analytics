import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OnboardingProgress } from '@tacticus/app-core/onboarding.types'
import { ProfileClaimCard } from '@/app/(public)/onboarding/dashboard/OnboardingStatusCards'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: vi.fn()
  })
}))

function progressFixture(
  overrides: Partial<OnboardingProgress> = {}
): OnboardingProgress {
  return {
    user_id: 'user-1',
    guild_mode: 'new_guild',
    role_intent: 'leader',
    guild_status: 'complete',
    guild_code: 'ZKFPH',
    guild_name: 'Claim Test Guild',
    guild_error_message: null,
    guild_can_retry: true,
    guild_lock_expires_at: null,
    sync_status: 'complete',
    sync_progress: 100,
    sync_records_synced: 30,
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

function renderCard(
  props: Partial<React.ComponentProps<typeof ProfileClaimCard>> = {}
) {
  return render(
    <ProfileClaimCard
      progress={progressFixture()}
      status={{ label: 'Not started', type: 'inactive' }}
      profileComplete={false}
      guildComplete
      syncComplete
      {...props}
    />
  )
}

const OFFICER_DEAD_END = /Ask a guild officer or administrator/

describe('ProfileClaimCard — seat bootstrap visibility', () => {
  it('offers the seat claim while the guild has nobody who can invite', () => {
    renderCard({ guildAwaitingFirstClaim: true })

    expect(
      screen.getByRole('button', { name: /link my profile/i })
    ).toBeTruthy()
    expect(screen.queryByText(OFFICER_DEAD_END)).toBeNull()
  })

  it('shows the ordinary invite copy for a healthy guild', () => {
    renderCard({ guildAwaitingFirstClaim: false })

    expect(
      screen.queryByRole('button', { name: /link my profile/i })
    ).toBeNull()
    expect(screen.getByText(OFFICER_DEAD_END)).toBeTruthy()
  })

  // profile_status completes only if complete-via-invite succeeded; unmounting on the flag hides success.
  it('keeps the widget mounted after a claim, even once the flag flips false', () => {
    renderCard({ guildAwaitingFirstClaim: false, seatClaimed: true })

    expect(
      screen.getByRole('button', { name: /link my profile/i })
    ).toBeTruthy()
    expect(screen.queryByText(OFFICER_DEAD_END)).toBeNull()
  })

  it('calls the bootstrap claimant a guild leader, not a guild member', () => {
    renderCard({
      guildAwaitingFirstClaim: false,
      seatClaimed: true,
      profileComplete: true,
      progress: progressFixture({
        profile_status: 'complete',
        player_name: 'ClaimPlayer'
      })
    })

    expect(screen.getByText(/as a guild leader/)).toBeTruthy()
  })

  it('shows neither the widget nor the dead end while the answer is unknown', () => {
    renderCard({ guildAwaitingFirstClaim: null })

    expect(
      screen.queryByRole('button', { name: /link my profile/i })
    ).toBeNull()
    expect(screen.queryByText(OFFICER_DEAD_END)).toBeNull()
    expect(
      screen.getByText(/Checking how you can claim your seat/)
    ).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /enter invite code/i })
    ).toBeTruthy()
  })
})
