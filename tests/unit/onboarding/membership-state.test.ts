import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { describe, expect, it, vi } from 'vitest'
import { resolveOnboardingMembershipState } from '@/app/lib/onboarding/membership-state'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

function createMembershipClient(
  result:
    | {
        data: Array<{ is_current: boolean | null }> | null
        error: { message: string } | null
      }
    | Error
) {
  const query = {
    select: vi.fn(),
    eq: vi.fn()
  }
  query.select.mockReturnValue(query)
  if (result instanceof Error) {
    query.eq.mockRejectedValue(result)
  } else {
    query.eq.mockResolvedValue(result)
  }

  const client = {
    from: vi.fn(() => query)
  } as unknown as TypedSupabaseClient

  return { client, query }
}

describe('resolveOnboardingMembershipState', () => {
  it('returns active when any current mapping exists', async () => {
    const { client, query } = createMembershipClient({
      data: [{ is_current: false }, { is_current: true }],
      error: null
    })

    await expect(
      resolveOnboardingMembershipState(client, 'user-1')
    ).resolves.toBe('active')
    expect(client.from).toHaveBeenCalledWith('player_mapping')
    expect(query.select).toHaveBeenCalledWith('is_current')
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns inactive when only historical mappings exist', async () => {
    const { client } = createMembershipClient({
      data: [{ is_current: false }],
      error: null
    })

    await expect(
      resolveOnboardingMembershipState(client, 'user-1')
    ).resolves.toBe('inactive')
  })

  it('returns none when the user has no mapping rows', async () => {
    const { client } = createMembershipClient({ data: [], error: null })

    await expect(
      resolveOnboardingMembershipState(client, 'user-1')
    ).resolves.toBe('none')
  })

  it('returns error instead of collapsing a query failure to none', async () => {
    const { client } = createMembershipClient({
      data: null,
      error: { message: 'lookup unavailable' }
    })

    await expect(
      resolveOnboardingMembershipState(client, 'user-1')
    ).resolves.toBe('error')
  })

  it('returns error when the membership query throws', async () => {
    const { client } = createMembershipClient(new Error('network failure'))

    await expect(
      resolveOnboardingMembershipState(client, 'user-1')
    ).resolves.toBe('error')
  })
})
