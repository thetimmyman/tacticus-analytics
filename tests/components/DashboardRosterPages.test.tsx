import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RosterPage from '@/app/(dashboard)/roster/page'
import MemberRosterPage from '@/app/(dashboard)/roster/[playerId]/page'
import ChangePasswordPage from '@/app/(dashboard)/profile/change-password/page'

const {
  dbMock,
  requireAuthMock,
  requireRoleMock,
  rosterClientSpy,
  memberRosterClientSpy,
  changePasswordClientSpy
} = vi.hoisted(() => ({
  dbMock: vi.fn(),
  requireAuthMock: vi.fn(),
  requireRoleMock: vi.fn(),
  rosterClientSpy: vi.fn(),
  memberRosterClientSpy: vi.fn(),
  changePasswordClientSpy: vi.fn()
}))

vi.mock('@/app/lib/auth', () => ({
  requireAuth: requireAuthMock,
  requireRole: requireRoleMock
}))

vi.mock('@/app/lib/db', () => ({
  db: dbMock
}))

vi.mock('@/app/(dashboard)/roster/RosterClient', () => ({
  default: (props: {
    hasApiKey: boolean
    playerName: string
    guildCode?: string
    tacticusShareUrl?: string
  }) => {
    rosterClientSpy(props)
    return <div data-testid="roster-client" />
  }
}))

vi.mock('@/app/(dashboard)/roster/[playerId]/MemberRosterClient', () => ({
  default: (props: { playerId: string }) => {
    memberRosterClientSpy(props)
    return <div data-testid="member-roster-client" />
  }
}))

vi.mock(
  '@/app/(dashboard)/profile/change-password/ChangePasswordClient',
  () => ({
    default: (props: { userEmail: string }) => {
      changePasswordClientSpy(props)
      return <div data-testid="change-password-client" />
    }
  })
)

describe('Dashboard roster pages', () => {
  const authenticatedClient = { client: 'caller-scoped', rpc: vi.fn() }

  beforeEach(() => {
    dbMock.mockReset()
    authenticatedClient.rpc.mockReset()
    requireAuthMock.mockReset()
    requireRoleMock.mockReset()
    rosterClientSpy.mockReset()
    memberRosterClientSpy.mockReset()
    changePasswordClientSpy.mockReset()
    dbMock.mockResolvedValue(authenticatedClient)
  })

  it('derives API-key presence without exposing ciphertext in the auth profile', async () => {
    requireAuthMock.mockResolvedValue({
      profile: {
        display_name: 'Commander Alpha',
        guild_code: 'GUILD-1',
        tacticus_share_url: 'https://example.com/share'
      }
    })
    authenticatedClient.rpc.mockResolvedValue({
      data: [
        {
          has_claimed_profile: true,
          api_key_configured: true,
          api_key_valid: true,
          guild_resolved: true,
          blocking_condition: null
        }
      ],
      error: null
    })

    const result = await RosterPage()
    render(result)

    expect(requireAuthMock).toHaveBeenCalledWith(authenticatedClient)
    expect(authenticatedClient.rpc).toHaveBeenCalledWith(
      'get_my_onboarding_state'
    )
    expect(rosterClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hasApiKey: true,
        playerName: 'Commander Alpha',
        guildCode: 'GUILD-1',
        tacticusShareUrl: 'https://example.com/share'
      })
    )
    expect(screen.getByTestId('roster-client')).toBeInTheDocument()
  })

  it('falls back to defaults when roster profile data is missing', async () => {
    requireAuthMock.mockResolvedValue({
      profile: {}
    })
    authenticatedClient.rpc.mockResolvedValue({
      data: [
        {
          has_claimed_profile: true,
          api_key_configured: false,
          api_key_valid: false,
          guild_resolved: true,
          blocking_condition: 'no_api_key'
        }
      ],
      error: null
    })

    const result = await RosterPage()
    render(result)

    expect(rosterClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hasApiKey: false,
        playerName: 'Commander',
        guildCode: undefined,
        tacticusShareUrl: undefined
      })
    )
  })

  it('fails closed when caller-scoped API-key presence cannot be resolved', async () => {
    requireAuthMock.mockResolvedValue({
      profile: {
        display_name: 'Commander Alpha',
        guild_code: 'GUILD-1'
      }
    })
    authenticatedClient.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RPC unavailable' }
    })

    const result = await RosterPage()
    render(result)

    expect(rosterClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hasApiKey: false
      })
    )
  })

  it('requires officer role and passes player id for member roster', async () => {
    requireRoleMock.mockResolvedValue(undefined)

    const result = await MemberRosterPage({
      params: Promise.resolve({ playerId: 'player-42' })
    })
    render(result)

    expect(requireRoleMock).toHaveBeenCalledWith('officer')
    expect(memberRosterClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'player-42' })
    )
    expect(screen.getByTestId('member-roster-client')).toBeInTheDocument()
  })

  it('passes user email to change password client', async () => {
    requireAuthMock.mockResolvedValue({
      user: { email: 'player@example.com' }
    })

    const result = await ChangePasswordPage()
    render(result)

    expect(changePasswordClientSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: 'player@example.com' })
    )
    expect(screen.getByTestId('change-password-client')).toBeInTheDocument()
  })
})
