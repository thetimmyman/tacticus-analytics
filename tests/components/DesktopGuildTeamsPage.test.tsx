import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import GuildTeamsPage from '@/app/(dashboard)/guild-teams/page'

const { requireRole, client, runtime, received } = vi.hoisted(() => ({
  requireRole: vi.fn(),
  client: { from: vi.fn() },
  runtime: { profile: 'desktop' },
  received: vi.fn()
}))
vi.mock('@/app/lib/auth', () => ({ requireRole }))
vi.mock('@/app/lib/db', () => ({ db: async () => client }))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: () => runtime.profile
}))
vi.mock('@/app/(dashboard)/guild-teams/GuildTeamsClient', () => ({
  GuildTeamsClient: (props: unknown) => {
    received(props)
    return <div>Team comparison</div>
  }
}))

describe('Guild team page authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtime.profile = 'desktop'
    requireRole.mockResolvedValue({ profile: { guild_code: 'SYN-LOCAL' } })
    client.from.mockReturnValue({ select: async () => ({ data: [] }) })
  })

  it('admits a local member to the self-scoped roster comparison', async () => {
    render(await GuildTeamsPage())
    expect(requireRole).toHaveBeenCalledWith('member')
    expect(received).toHaveBeenCalledWith(
      expect.objectContaining({
        guildCode: 'SYN-LOCAL',
        desktopMode: true
      })
    )
    expect(screen.getByText('Team comparison')).toBeInTheDocument()
  })

  it('retains the hosted officer gate', async () => {
    runtime.profile = 'hosted'
    await GuildTeamsPage()
    expect(requireRole).toHaveBeenCalledWith('officer')
    expect(received).not.toHaveBeenCalled()
  })
})
