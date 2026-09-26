import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  fetchGuildSettings,
  updateGuildSettings,
  updateApiKeyValidationState,
  fetchClusterDetails,
  createDefaultGuildSettings
} from '@/app/lib/services/guild-settings-service'

const {
  clearGuildSettingsCacheMock,
  clearThemeCacheMock,
  loggerErrorMock,
  loggerWarnMock,
  createServiceClientMock
} = vi.hoisted(() => ({
  clearGuildSettingsCacheMock: vi.fn(),
  clearThemeCacheMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  createServiceClientMock: vi.fn()
}))

vi.mock('@/app/lib/calculations/guild-settings', () => ({
  clearGuildSettingsCache: clearGuildSettingsCacheMock
}))

vi.mock('@/app/lib/theme-system', async () => {
  const actual = await vi.importActual<typeof import('@/app/lib/theme-system')>(
    '@/app/lib/theme-system'
  )
  return {
    ...actual,
    clearThemeCache: clearThemeCacheMock
  }
})

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    error: loggerErrorMock,
    warn: loggerWarnMock,
    info: vi.fn()
  })
}))

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: createServiceClientMock
}))

function createSelectChain(result: { data: any; error: any }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result)
  }
  return chain
}

function createUpdateChain(error: any = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error })
  }
  return chain
}

function createSnapshotUpdateChain(result: { data: any; error: any }) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue(result)
  }
  return chain
}

beforeEach(() => {
  clearGuildSettingsCacheMock.mockClear()
  clearThemeCacheMock.mockClear()
  loggerErrorMock.mockClear()
  loggerWarnMock.mockClear()
  createServiceClientMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('guild-settings-service', () => {
  it('fetchGuildSettings returns sanitized data and flag for encrypted key', async () => {
    const data = {
      id: 1,
      guild_code: 'EOT',
      display_name: 'Example Alliance',
      enabled: true,
      GR_Ranking: 1,
      GW_Ranking: 2,
      gr_ranking: null,
      gw_ranking: null,
      token_offender_threshold: 4,
      token_abuser_threshold: 5,
      primary_assignment_tokens: 3,
      secondary_assignment_tokens: 2,
      discord_webhook_enabled: true,
      discord_officer_role_id: null,
      discord_member_role_id: null,
      discord_leader_role_id: null,
      API_Owner: 'Warmaster',
      api_key_is_valid: true,
      api_key_last_validated: '2025-10-14T00:00:00.000Z',
      cluster_id: null,
      cluster_code: 'EOT',
      cluster_role: null,
      tagline: 'For Chaos!',
      description: 'The finest heretics.',
      logo_url: 'https://example.com/logo.png',
      timezone: 'UTC',
      theme_preset: 'EOT',
      social_links: { discord: 'https://discord.gg/eot' },
      explore_privacy_mode: ['public'],
      explore_obfuscation_percent: 14,
      api_key_encrypted: 'secret',
      created_at: '2025-10-01T00:00:00.000Z',
      updated_at: '2025-10-10T00:00:00.000Z'
    }

    const mockClient = {
      from: vi.fn(() => createSelectChain({ data, error: null }))
    }

    const result = await fetchGuildSettings('EOT', mockClient as any)

    expect(mockClient.from).toHaveBeenCalledWith('guild_config')
    expect(result.guild_code).toBe('EOT')
    expect(result.hasEncryptedApiKey).toBe(true)
    expect(result.explore_obfuscation_percent).toBe(14)
    expect(result.social_links).toEqual({
      discord: 'https://discord.gg/eot',
      website: null,
      twitter: null
    })
    expect(
      (result as unknown as Record<string, unknown>).api_key_encrypted
    ).toBeUndefined()
  })

  it('fetchGuildSettings throws when data missing', async () => {
    const mockClient = {
      from: vi.fn(() =>
        createSelectChain({ data: null, error: new Error('not found') })
      )
    }

    await expect(fetchGuildSettings('EOT', mockClient as any)).rejects.toThrow(
      'Failed to fetch guild settings'
    )
    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('updateGuildSettings updates record, caches, and public snapshots', async () => {
    const guildUpdateChain = createUpdateChain(null)
    const snapshotUpdateChain = createUpdateChain(null)
    const serviceClient = {
      from: vi.fn(() => snapshotUpdateChain)
    }
    createServiceClientMock.mockReturnValue(serviceClient as any)
    const mockClient = {
      from: vi.fn(() => guildUpdateChain)
    }

    await updateGuildSettings(
      {
        guildCode: 'EOT',
        enabled: true,
        tokenOffenderThreshold: 4,
        tokenAbuserThreshold: 5,
        primaryAssignmentTokens: 3,
        secondaryAssignmentTokens: 2,
        tagline: 'Chaos',
        description: 'For the Warmaster',
        logoUrl: 'https://example.com/logo.png',
        timezone: 'UTC',
        themePreset: 'EOT',
        previousThemePreset: 'default',
        socialLinks: {
          discord: 'https://discord.gg/eot',
          website: null,
          twitter: null
        },
        explorePrivacyMode: ['hide_players'],
        exploreObfuscationPercent: 12
      },
      mockClient as any
    )

    expect(mockClient.from).toHaveBeenCalledWith('guild_config')
    expect(serviceClient.from).toHaveBeenCalledWith('public_guild_snapshots')
    expect(guildUpdateChain.update).toHaveBeenCalled()
    expect(snapshotUpdateChain.update).toHaveBeenCalledWith({
      explore_privacy_mode: '["hide_players"]',
      explore_obfuscation_percent: 12
    })
    expect(clearGuildSettingsCacheMock).toHaveBeenCalledWith('EOT')
    expect(clearThemeCacheMock).toHaveBeenCalledWith('EOT')
  })

  it('updateGuildSettings throws when supabase returns error', async () => {
    const updateChain = createUpdateChain(new Error('failure'))
    createServiceClientMock.mockReturnValue({
      from: vi.fn()
    } as any)
    const mockClient = {
      from: vi.fn(() => updateChain)
    }

    await expect(
      updateGuildSettings(
        {
          guildCode: 'EOT',
          enabled: true,
          tokenOffenderThreshold: 4,
          tokenAbuserThreshold: 5,
          primaryAssignmentTokens: 3,
          secondaryAssignmentTokens: 2,
          tagline: null,
          description: null,
          logoUrl: null,
          timezone: 'UTC',
          themePreset: 'default',
          previousThemePreset: 'default',
          socialLinks: {},
          explorePrivacyMode: ['public'],
          exploreObfuscationPercent: 10
        },
        mockClient as any
      )
    ).rejects.toThrow('Failed to update guild settings')

    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('does NOT touch public_guild_snapshots when the service client is unavailable (PS-125)', async () => {
    // No request-client fallback: anon/authenticated hold no privileges on the snapshot table or RPC.
    createServiceClientMock.mockImplementation(() => {
      throw new Error('missing service key')
    })
    const guildUpdateChain = createUpdateChain(null)
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'guild_config') return guildUpdateChain
        throw new Error(`Unexpected table ${table}`)
      }),
      rpc: rpcMock
    }

    await updateGuildSettings(
      {
        guildCode: 'EOT',
        enabled: true,
        tokenOffenderThreshold: 4,
        tokenAbuserThreshold: 5,
        primaryAssignmentTokens: 3,
        secondaryAssignmentTokens: 2,
        tagline: 'Chaos',
        description: 'For the Warmaster',
        logoUrl: 'https://example.com/logo.png',
        timezone: 'UTC',
        themePreset: 'EOT',
        previousThemePreset: 'default',
        socialLinks: {
          discord: 'https://discord.gg/eot',
          website: null,
          twitter: null
        },
        explorePrivacyMode: ['hide_players'],
        exploreObfuscationPercent: 12
      },
      mockClient as any
    )

    expect(mockClient.from).toHaveBeenCalledWith('guild_config')
    expect(mockClient.from).not.toHaveBeenCalledWith('public_guild_snapshots')
    expect(rpcMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalled()
  })

  const runSnapshotSync = async (snapshotResult: { data: any; error: any }) => {
    const snapshotUpdateChain = createSnapshotUpdateChain(snapshotResult)
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === 'public_guild_snapshots') return snapshotUpdateChain
        throw new Error(`Unexpected table on the service client: ${table}`)
      }),
      rpc: rpcMock
    }
    createServiceClientMock.mockImplementation(() => serviceClient)

    const guildUpdateChain = createUpdateChain(null)
    const mockClient = {
      from: vi.fn((table: string) => {
        if (table === 'guild_config') return guildUpdateChain
        throw new Error(`Unexpected table on the request client: ${table}`)
      })
    }

    await updateGuildSettings(
      {
        guildCode: 'ABC',
        enabled: true,
        tokenOffenderThreshold: 4,
        tokenAbuserThreshold: 5,
        primaryAssignmentTokens: 3,
        secondaryAssignmentTokens: 2,
        tagline: null,
        description: null,
        logoUrl: null,
        timezone: 'UTC',
        themePreset: 'default',
        previousThemePreset: 'default',
        socialLinks: {},
        explorePrivacyMode: ['hide_players'],
        exploreObfuscationPercent: 12
      },
      mockClient as any
    )

    return { rpcMock, snapshotUpdateChain }
  }

  it('snapshot sync triggers the compensating refresh when the update matches zero rows', async () => {
    const { rpcMock, snapshotUpdateChain } = await runSnapshotSync({
      data: [],
      error: null
    })

    expect(snapshotUpdateChain.select).toHaveBeenCalledWith('guild_code')
    expect(rpcMock).toHaveBeenCalledWith('refresh_public_guild_snapshots')
  })

  it('snapshot sync does NOT refresh on a 42501 from the service client (PS-125)', async () => {
    // On the service client 42501 is a misconfiguration, not "zero rows".
    const { rpcMock } = await runSnapshotSync({
      data: null,
      error: {
        code: '42501',
        message: 'permission denied for table public_guild_snapshots'
      }
    })

    expect(rpcMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalled()
  })

  it('snapshot sync does NOT refresh on a non-permission error', async () => {
    const { rpcMock } = await runSnapshotSync({
      data: null,
      error: { code: '23514', message: 'check constraint violated' }
    })

    expect(rpcMock).not.toHaveBeenCalled()
    expect(loggerWarnMock).toHaveBeenCalled()
  })

  it('updateApiKeyValidationState updates validation flags', async () => {
    const updateChain = createUpdateChain(null)
    const mockClient = {
      from: vi.fn(() => updateChain)
    }

    await updateApiKeyValidationState(
      {
        guildCode: 'EOT',
        validatedAt: '2025-10-14T00:00:00.000Z',
        isValid: true,
        validatedBy: 'Warmaster'
      },
      mockClient as any
    )

    expect(mockClient.from).toHaveBeenCalledWith('guild_config')
    expect(updateChain.update).toHaveBeenCalledWith({
      api_key_is_valid: true,
      api_key_last_validated: '2025-10-14T00:00:00.000Z',
      API_Owner: 'Warmaster'
    })
  })

  it('updateApiKeyValidationState throws on error', async () => {
    const updateChain = createUpdateChain(new Error('update failed'))
    const mockClient = {
      from: vi.fn(() => updateChain)
    }

    await expect(
      updateApiKeyValidationState(
        {
          guildCode: 'EOT',
          validatedAt: 'now',
          isValid: false,
          validatedBy: null
        },
        mockClient as any
      )
    ).rejects.toThrow('Failed to update API key validation state')

    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('fetchClusterDetails returns cluster object', async () => {
    const clusterData = {
      cluster_code: 'EOT',
      display_name: 'Example Alliance',
      description: 'legendary warriors'
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: clusterData, error: null })
    }
    const mockClient = {
      from: vi.fn(() => chain)
    }

    const result = await fetchClusterDetails('EOT', mockClient as any)
    expect(result).toEqual(clusterData)
  })

  it('fetchClusterDetails returns null when error occurs', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: new Error('RLS') })
    }
    const mockClient = {
      from: vi.fn(() => chain)
    }

    const result = await fetchClusterDetails('EOT', mockClient as any)
    expect(result).toBeNull()
    expect(loggerErrorMock).toHaveBeenCalled()
  })

  it('createDefaultGuildSettings recovers a missing row via SERVICE authority (WI-3136)', async () => {
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 7,
          guild_code: 'NEW',
          display_name: 'New Guild',
          enabled: false,
          token_offender_threshold: 4,
          token_abuser_threshold: 5,
          explore_privacy_mode: ['public'],
          explore_obfuscation_percent: 14,
          created_at: 'now',
          updated_at: 'now'
        },
        error: null
      })
    }
    const serviceClient = { from: vi.fn(() => insertChain) }
    createServiceClientMock.mockReturnValue(serviceClient as any)

    const result = await createDefaultGuildSettings('NEW', 'New Guild')

    // The membership-authority guard rejects end-user guild_config INSERTs.
    expect(createServiceClientMock).toHaveBeenCalled()
    expect(serviceClient.from).toHaveBeenCalledWith('guild_config')
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        guild_code: 'NEW',
        display_name: 'New Guild',
        enabled: false
      })
    )
    expect(result.id).toBe(7)
    expect(result.guild_code).toBe('NEW')
  })
})
