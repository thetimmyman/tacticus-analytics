import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EditProfilePage from '@/app/(dashboard)/profile/edit/page'
import ProfilePage from '@/app/(dashboard)/profile/page'

const {
  dbMock,
  editProfileClientSpy,
  getUserAvatarMock,
  labelForMemberMock,
  requireAuthMock,
  reweaveLinkSpy
} = vi.hoisted(() => ({
  dbMock: vi.fn(),
  editProfileClientSpy: vi.fn(),
  getUserAvatarMock: vi.fn(),
  labelForMemberMock: vi.fn(),
  requireAuthMock: vi.fn(),
  reweaveLinkSpy: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  requireAuth: requireAuthMock
}))

vi.mock('@/app/lib/db', () => ({
  db: dbMock
}))

vi.mock('@/app/lib/member-labels-server', () => ({
  labelForMember: labelForMemberMock
}))

vi.mock('@/app/lib/utils/avatar', () => ({
  getUserAvatar: getUserAvatarMock,
  normalizeAvatarUnitId: vi.fn((unitId: string) => unitId),
  resolvePlayerAvatar: vi.fn(() => '/resolved-avatar.png')
}))

vi.mock('@/app/lib/auth/permissions', () => ({
  getRoleDisplayName: vi.fn(() => 'Member'),
  getRoleBadgeColor: vi.fn(() => 'member-badge')
}))

vi.mock('@/app/lib/utils/feature-flags', () => ({
  featureFlags: {
    discordAuth: false,
    googleAuth: false,
    requireDiscordLink: false
  }
}))

vi.mock('@/app/(dashboard)/profile/edit/EditProfileClient', () => ({
  default: (props: { initialProfile: { has_api_key?: boolean } }) => {
    editProfileClientSpy(props)
    return <div data-testid="edit-profile-client" />
  }
}))

vi.mock('@/app/(dashboard)/profile/ReweaveLink', () => ({
  ReweaveLink: (props: {
    hasKey: boolean
    keyValid: boolean
    lastVerified: string | null
  }) => {
    reweaveLinkSpy(props)
    return <div data-testid="reweave-link" />
  }
}))

vi.mock('@/app/(dashboard)/profile/DeleteAccountButton', () => ({
  default: () => null
}))
vi.mock('@/app/(dashboard)/profile/RequestMyDataButton', () => ({
  default: () => null
}))
vi.mock('@/app/components/BossFavorites', () => ({
  default: () => null
}))
vi.mock('@/app/(dashboard)/profile/MetaTeamMembership', () => ({
  MetaTeamMembership: () => null
}))
vi.mock('@/app/components/ThemePreviewPanel', () => ({
  default: () => null
}))
vi.mock('@/app/components/auth/OAuthAccountLink', () => ({
  default: () => null
}))
vi.mock('@/app/components/auth/LinkRequiredNudge', () => ({
  default: () => null
}))
vi.mock('@/app/(dashboard)/profile/WinterThemeSection', () => ({
  WinterThemeSection: () => null
}))
vi.mock('@/app/(dashboard)/profile/BossEasterEggSection', () => ({
  BossEasterEggSection: () => null
}))
vi.mock('@/app/(dashboard)/profile/TokenAlertSettings', () => ({
  TokenAlertSettings: () => null
}))
vi.mock('@/app/(dashboard)/profile/LifetimeStats', () => ({
  LifetimeStats: () => null
}))
vi.mock('@/app/(dashboard)/profile/MentionsReceivedChart', () => ({
  MentionsReceivedChart: () => null
}))
vi.mock('@tacticus/ui-kit', () => ({
  ClientDate: () => null
}))
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />
}))

function createQueryResult(table: string) {
  if (table === 'meta_teams') {
    let orderCalls = 0
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => {
        orderCalls += 1
        return orderCalls === 1
          ? query
          : Promise.resolve({ data: [], error: null })
      })
    }
    return query
  }

  if (table === 'guild_config') {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          display_name: 'Guild One',
          guild_tag: 'G1',
          guild_code: 'GUILD-1'
        },
        error: null
      })
    }
    return query
  }

  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn().mockResolvedValue({ data: null, error: null })
  }
  return query
}

function createAuthenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { user_metadata: {} }
        },
        error: null
      })
    },
    from: vi.fn((table: string) => createQueryResult(table)),
    rpc: vi.fn()
  }
}

describe('Dashboard profile API-key presence', () => {
  const lastVerified = '2026-07-28T12:00:00.000Z'
  let authenticatedClient: ReturnType<typeof createAuthenticatedClient>

  beforeEach(() => {
    dbMock.mockReset()
    editProfileClientSpy.mockReset()
    getUserAvatarMock.mockReset()
    labelForMemberMock.mockReset()
    requireAuthMock.mockReset()
    reweaveLinkSpy.mockReset()

    authenticatedClient = createAuthenticatedClient()
    dbMock.mockResolvedValue(authenticatedClient)
    getUserAvatarMock.mockReturnValue('/default-avatar.png')
    labelForMemberMock.mockResolvedValue('Commander Alpha')
    requireAuthMock.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'commander@example.com'
      },
      // Mirrors ACTIVE_PROFILE_SELECT: tacticus_api_key_encrypted is deliberately absent.
      profile: {
        player_id: 'player-1',
        display_name: 'Commander Alpha',
        guild_code: 'GUILD-1',
        role: 'member',
        discord_user_id: null,
        discord_username: null,
        api_key_is_valid: true,
        api_key_last_verified: lastVerified
      }
    })
  })

  it.each([
    {
      label: 'configured',
      rpcData: [
        {
          has_claimed_profile: true,
          api_key_configured: true,
          api_key_valid: true,
          guild_resolved: true,
          blocking_condition: null
        }
      ],
      rpcError: null,
      expected: true,
      expectedValid: true
    },
    {
      label: 'rejected key',
      rpcData: [
        {
          has_claimed_profile: true,
          api_key_configured: true,
          api_key_valid: false,
          guild_resolved: true,
          blocking_condition: null
        }
      ],
      rpcError: null,
      expected: true,
      expectedValid: false
    },
    {
      label: 'not configured',
      rpcData: [
        {
          has_claimed_profile: true,
          api_key_configured: false,
          api_key_valid: false,
          guild_resolved: true,
          blocking_condition: 'no_api_key'
        }
      ],
      rpcError: null,
      expected: false,
      expectedValid: false
    },
    {
      label: 'RPC failure',
      rpcData: null,
      rpcError: { message: 'RPC unavailable' },
      expected: false,
      expectedValid: false
    }
  ])(
    'derives $label state from the caller-scoped boolean-only RPC',
    async ({ rpcData, rpcError, expected, expectedValid }) => {
      authenticatedClient.rpc.mockResolvedValue({
        data: rpcData,
        error: rpcError
      })

      render(await EditProfilePage())
      render(await ProfilePage({}))

      expect(requireAuthMock).toHaveBeenCalledTimes(2)
      expect(requireAuthMock).toHaveBeenNthCalledWith(1, authenticatedClient)
      expect(requireAuthMock).toHaveBeenNthCalledWith(2, authenticatedClient)
      expect(authenticatedClient.rpc).toHaveBeenCalledTimes(2)
      expect(authenticatedClient.rpc).toHaveBeenNthCalledWith(
        1,
        'get_my_onboarding_state'
      )
      expect(authenticatedClient.rpc).toHaveBeenNthCalledWith(
        2,
        'get_my_onboarding_state'
      )
      expect(editProfileClientSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialProfile: expect.objectContaining({
            has_api_key: expected
          })
        })
      )
      expect(reweaveLinkSpy).toHaveBeenCalledWith({
        hasKey: expected,
        keyValid: expectedValid,
        lastVerified
      })
      expect(screen.getByTestId('edit-profile-client')).toBeInTheDocument()
      expect(screen.getByTestId('reweave-link')).toBeInTheDocument()
    }
  )
})
