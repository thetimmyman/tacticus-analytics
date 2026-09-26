import { beforeEach, describe, expect, it, vi } from 'vitest'

/** `checkStaleGuilds` filters on `auto_sync_enabled = true`, so excluded guilds need their own report. */

const addSyncAlert = vi.fn()
const serviceDb = vi.fn()

type GuildRow = {
  guild_code: string
  display_name: string | null
  api_key_is_valid: boolean | null
  auto_sync_enabled: boolean | null
  last_successful_sync: string | null
  consecutive_sync_failures: number | null
}

function dbDouble(tables: {
  guild_config: { data: GuildRow[] | null; error?: unknown }
  player_mapping: {
    data: Array<{ guild_code: string }> | null
    error?: unknown
  }
}) {
  const calls: Record<string, unknown[][]> = {}
  return {
    calls,
    client: {
      from(table: string) {
        const result =
          table === 'guild_config'
            ? {
                data: tables.guild_config.data,
                error: tables.guild_config.error ?? null
              }
            : {
                data: tables.player_mapping.data,
                error: tables.player_mapping.error ?? null
              }

        const chain: Record<string, unknown> = {}
        for (const method of ['select', 'eq', 'or', 'in', 'limit']) {
          chain[method] = (...args: unknown[]) => {
            calls[`${table}.${method}`] ??= []
            ;(calls[`${table}.${method}`] as unknown[][]).push(args)
            return chain
          }
        }
        chain.then = (resolve: (value: unknown) => unknown) => resolve(result)
        return chain
      }
    }
  }
}

function guild(overrides: Partial<GuildRow> = {}): GuildRow {
  return {
    guild_code: 'JTLTM',
    display_name: 'Test Guild',
    api_key_is_valid: false,
    auto_sync_enabled: false,
    last_successful_sync: new Date(
      Date.now() - 16 * 24 * 60 * 60 * 1000
    ).toISOString(),
    consecutive_sync_failures: 14,
    ...overrides
  }
}

async function runCheck(double: ReturnType<typeof dbDouble>) {
  vi.resetModules()
  vi.doMock('@tacticus/app-core/daily-alert-summary', () => ({
    addSyncAlert,
    addDatabaseAlert: vi.fn(),
    addInfrastructureAlert: vi.fn()
  }))
  vi.doMock('@/app/lib/db', () => ({ serviceDb }))
  vi.doMock('@/app/lib/services/season-timing-service', () => ({
    getSeasonTiming: vi.fn()
  }))
  serviceDb.mockReturnValue(double.client)

  const { __internal } = await import('@/app/lib/health/data-integrity-health')
  return __internal.checkExcludedGuilds(true)
}

describe('checkExcludedGuilds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('alerts on a guild that no sync lane will pick up', async () => {
    const double = dbDouble({
      guild_config: { data: [guild()] },
      player_mapping: {
        data: Array.from({ length: 30 }, () => ({ guild_code: 'JTLTM' }))
      }
    })

    const result = await runCheck(double)

    expect(result).toMatchObject({
      count: 1,
      guilds: ['Test Guild'],
      memberCount: 30,
      checked: true
    })
    expect(addSyncAlert).toHaveBeenCalledWith(
      'Guilds Excluded From Sync',
      expect.stringContaining('30 affected members'),
      'error',
      expect.objectContaining({ count: 1, memberCount: 30 })
    )
  })

  it('selects the INTERSECTION of the lane selectors, not the union of their flags', async () => {
    // `auto_sync_enabled = false` alone is not exclusion: the scheduler ignores that flag.
    const double = dbDouble({
      guild_config: { data: [guild()] },
      player_mapping: { data: [] }
    })

    await runCheck(double)

    expect(double.calls['guild_config.or']).toEqual([
      [
        'api_key_is_valid.is.false,and(auto_sync_enabled.not.is.true,api_key_encrypted.is.null)'
      ]
    ])
    expect(double.calls['guild_config.eq']).toEqual([['enabled', true]])
    // The ciphertext is filtered on but must never be selected.
    const selects = (double.calls['guild_config.select'] ?? []).flat().join(' ')
    expect(selects).not.toContain('api_key_encrypted')
  })

  it('reports UNKNOWN impact, not zero, when the member count cannot be read', async () => {
    // A swallowed error would downgrade the alert and hide the outage this check surfaces.
    const double = dbDouble({
      guild_config: { data: [guild()] },
      player_mapping: { data: null, error: { message: 'permission denied' } }
    })

    const result = await runCheck(double)

    expect(result).toMatchObject({
      count: 1,
      memberCount: null,
      checked: false
    })
    expect(addSyncAlert).not.toHaveBeenCalled()
  })

  it('treats a guild that has never synced as excluded', async () => {
    const double = dbDouble({
      guild_config: { data: [guild({ last_successful_sync: null })] },
      player_mapping: { data: [{ guild_code: 'JTLTM' }] }
    })

    await expect(runCheck(double)).resolves.toMatchObject({ count: 1 })
  })

  it('stays quiet for an excluded guild that is still syncing fine', async () => {
    const double = dbDouble({
      guild_config: {
        data: [
          guild({
            last_successful_sync: new Date(
              Date.now() - 60 * 60 * 1000
            ).toISOString()
          })
        ]
      },
      player_mapping: { data: [{ guild_code: 'JTLTM' }] }
    })

    const result = await runCheck(double)

    expect(result).toMatchObject({ count: 0, memberCount: 0, checked: true })
    expect(addSyncAlert).not.toHaveBeenCalled()
  })

  it('reports a read failure as unchecked rather than as an all-clear', async () => {
    const double = dbDouble({
      guild_config: { data: null, error: { message: 'boom' } },
      player_mapping: { data: [] }
    })

    const result = await runCheck(double)

    expect(result).toMatchObject({ count: 0, checked: false })
    expect(addSyncAlert).not.toHaveBeenCalled()
  })
})
