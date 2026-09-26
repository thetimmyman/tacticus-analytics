import { describe, expect, it, vi } from 'vitest'
import { verifyUserPermissions } from '../../../supabase/functions/discord-notifications/command-permissions'

function createSupabase({
  mapping = {
    game_guild_code: 'EOT',
    guild_config: {
      cluster_code: 'EOT',
      display_name: 'Example Guild',
      guild_tag: 'EOT'
    }
  },
  mappingError = null,
  identities = [{ guild_code: 'EOT', role: 'member', is_app_admin: false }],
  identityError = null
}: {
  mapping?: Record<string, unknown> | null
  mappingError?: unknown
  identities?: Array<Record<string, unknown>>
  identityError?: unknown
} = {}) {
  const single = vi.fn().mockResolvedValue({
    data: mapping,
    error: mappingError
  })
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    single
  }
  query.select.mockReturnValue(query)
  query.eq.mockReturnValue(query)

  return {
    from: vi.fn().mockReturnValue(query),
    rpc: vi.fn().mockResolvedValue({
      data: identities,
      error: identityError
    })
  }
}

describe('Discord command permissions', () => {
  it('fails closed when the Discord server is not mapped', async () => {
    const supabase = createSupabase({ mapping: null })

    await expect(
      verifyUserPermissions(supabase, 'discord-user', 'discord-server')
    ).resolves.toMatchObject({ allowed: false, accessibleGuilds: [] })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('fails closed when verified identity resolution fails', async () => {
    const supabase = createSupabase({ identityError: new Error('offline') })

    await expect(
      verifyUserPermissions(supabase, 'discord-user', 'discord-server')
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'Unable to verify your linked Discord identity'
    })
  })

  it('requires a verified identity in the mapped guild', async () => {
    const supabase = createSupabase({
      identities: [{ guild_code: 'OTHER', role: 'leader' }]
    })

    await expect(
      verifyUserPermissions(supabase, 'discord-user', 'discord-server')
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'Link your Discord account to an active member of this guild'
    })
  })

  it('preserves verified roles and normalizes guild codes', async () => {
    const supabase = createSupabase({
      identities: [{ guild_code: ' eot ', role: 'officer' }]
    })

    await expect(
      verifyUserPermissions(supabase, 'discord-user', 'discord-server', 'eot')
    ).resolves.toEqual({
      allowed: true,
      userRole: 'officer',
      accessibleGuilds: ['EOT']
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'resolve_verified_discord_identities',
      { p_discord_user_ids: ['discord-user'] }
    )
  })

  it('rejects a requested guild outside the server mapping', async () => {
    const supabase = createSupabase()

    await expect(
      verifyUserPermissions(supabase, 'discord-user', 'discord-server', 'OTHER')
    ).resolves.toMatchObject({ allowed: false, userRole: 'member' })
  })

  it('treats app administrators as leaders', async () => {
    const supabase = createSupabase({
      identities: [{ guild_code: 'EOT', role: 'member', is_app_admin: true }]
    })

    await expect(
      verifyUserPermissions(supabase, 'discord-user', 'discord-server')
    ).resolves.toMatchObject({ allowed: true, userRole: 'leader' })
  })
})
