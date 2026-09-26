import { describe, it, expect } from 'vitest'
import {
  diffGlobalConfig,
  formatDiscordContent,
  isDiscordWebhookUrl,
  isRetryableNetworkError,
  parseAppStartLatestHash,
  type AppStartResponse,
  type GlobalConfigShape
} from '@/app/lib/loki/global-config-diff'
import connectResponse from '@/data/loki-api/connect-response.json'

function cfg(opts: {
  version?: string
  extractedAt?: string
  rosters?: Record<string, string[]>
  rotation?: unknown[]
  seasonDuration?: number
  bufferAfterSeasonEnd?: number
  loopFromTier?: number
  loopFromSet?: number
}): GlobalConfigShape {
  const gdto: Record<
    string,
    {
      loopFromTier?: number
      loopFromSet?: number
      tiers: {
        tier: number
        sets: {
          set: number
          encounters: { bossType: string; encounterIndex: number }[]
        }[]
      }[]
    }
  > = {}
  for (const [key, bosses] of Object.entries(opts.rosters ?? {})) {
    gdto[key] = {
      loopFromTier: opts.loopFromTier,
      loopFromSet: opts.loopFromSet,
      tiers: [
        {
          tier: 1,
          sets: [
            {
              set: 1,
              encounters: bosses.map((b, i) => ({
                bossType: b,
                encounterIndex: i
              }))
            }
          ]
        }
      ]
    }
  }
  return {
    configVersion: opts.version,
    extractedAt: opts.extractedAt,
    guildBoss: {
      guildBossSeasonConfigRotation: opts.rotation,
      guildBossSeasonDataConfigsGDTO: gdto,
      misc:
        opts.seasonDuration != null || opts.bufferAfterSeasonEnd != null
          ? {
              seasonDuration: opts.seasonDuration,
              bufferAfterSeasonEnd: opts.bufferAfterSeasonEnd
            }
          : undefined
    }
  }
}

describe('diffGlobalConfig', () => {
  it('reports versionChanged=false and no lines for identical configs', () => {
    const a = cfg({
      version: 'aaa',
      extractedAt: '2026-01-01',
      rosters: { c1: ['HiveTyrant'] }
    })
    const d = diffGlobalConfig(a, structuredClone(a))
    expect(d.versionChanged).toBe(false)
    expect(d.lines).toEqual([])
  })

  it('detects added and removed bosses per season config', () => {
    const old = cfg({
      version: 'aaa',
      rosters: { c1: ['HiveTyrant', 'Cadia'] }
    })
    const next = cfg({
      version: 'bbb',
      rosters: { c1: ['HiveTyrant', 'Lion'] }
    })
    const d = diffGlobalConfig(old, next)
    expect(d.versionChanged).toBe(true)
    expect(d.oldVersion).toBe('aaa')
    expect(d.newVersion).toBe('bbb')
    expect(d.lines).toContain('c1: +Lion  -Cadia')
  })

  it('applies the pretty-name mapper to boss types', () => {
    const old = cfg({ version: 'aaa', rosters: { c1: [] } })
    const next = cfg({
      version: 'bbb',
      rosters: { c1: ['HiveTyrantLeviathan'] }
    })
    const d = diffGlobalConfig(old, next, (b) =>
      b === 'HiveTyrantLeviathan' ? 'Hive Tyrant (Leviathan)' : b
    )
    expect(d.lines).toContain('c1: +Hive Tyrant (Leviathan)')
  })

  it('flags added and removed season-config keys', () => {
    const old = cfg({ version: 'aaa', rosters: { c1: ['A'] } })
    const next = cfg({ version: 'bbb', rosters: { c1: ['A'], c2: ['B'] } })
    const d = diffGlobalConfig(old, next)
    expect(d.lines).toContain('NEW season config: c2')
  })

  it('flags rotation and season-timing changes', () => {
    const old = cfg({
      version: 'aaa',
      rotation: [1, 2, 3],
      seasonDuration: 7,
      bufferAfterSeasonEnd: 1
    })
    const next = cfg({
      version: 'bbb',
      rotation: [1, 2, 4],
      seasonDuration: 14,
      bufferAfterSeasonEnd: 2
    })
    const d = diffGlobalConfig(old, next)
    expect(d.lines.some((l) => l.startsWith('season rotation changed'))).toBe(
      true
    )
    expect(d.lines).toContain('misc.seasonDuration: 7 → 14')
    expect(d.lines).toContain('misc.bufferAfterSeasonEnd: 1 → 2')
  })

  it('flags loop-policy changes even when the boss roster is unchanged', () => {
    const old = cfg({
      version: 'aaa',
      rosters: { c1: ['HiveTyrant'] },
      loopFromTier: 4,
      loopFromSet: 0
    })
    const next = cfg({
      version: 'bbb',
      rosters: { c1: ['HiveTyrant'] },
      loopFromTier: 5,
      loopFromSet: 3
    })

    const d = diffGlobalConfig(old, next)
    expect(d.lines).toContain('c1.loopFromTier: 4 → 5')
    expect(d.lines).toContain('c1.loopFromSet: 0 → 3')
  })

  it('flags a version change even when no app-consumed fields differ', () => {
    const old = cfg({ version: 'aaa', rosters: { c1: ['A'] } })
    const next = cfg({ version: 'bbb', rosters: { c1: ['A'] } })
    const d = diffGlobalConfig(old, next)
    expect(d.versionChanged).toBe(true)
    expect(d.lines).toEqual([])
  })
})

describe('formatDiscordContent', () => {
  it('includes the version transition and change bullets', () => {
    const msg = formatDiscordContent({
      versionChanged: true,
      oldVersion: '1234567890',
      newVersion: 'abcdefghij',
      lines: ['c1: +Lion  -Cadia']
    })
    expect(msg).toContain('12345678')
    expect(msg).toContain('abcdefgh')
    expect(msg).toContain('• c1: +Lion  -Cadia')
    expect(msg).toContain('LOKI GlobalConfig drift detected')
    expect(msg).toContain('data/loki-api/GlobalConfig.json')
    expect(msg).toContain('npm run loki:season-lineups')
    expect(msg).not.toContain('LOKI-GLOBALCONFIG-REFRESH.md')
  })

  it('caps content under the Discord 2000-char limit', () => {
    const lines = Array.from(
      { length: 500 },
      (_, i) => `config_${i}: +SomeVeryLongBossNameHere${i}`
    )
    const msg = formatDiscordContent({
      versionChanged: true,
      oldVersion: 'a',
      newVersion: 'b',
      lines
    })
    expect(msg.length).toBeLessThanOrEqual(1900)
    expect(msg).toContain('…(truncated)')
  })
})

describe('parseAppStartLatestHash', () => {
  it('returns currentHash (no-op) for a SUCCESS response with no latest field — the steady-state case', () => {
    // Synthetic APP_START reply: steady-state shape, no real account identity.
    const data = connectResponse as AppStartResponse
    expect(data.eventResult?.eventResultType).toBe('SUCCESS')
    expect(
      data.eventResult?.eventResponseData?.latestGlobalGameConfigVersion
    ).toBeUndefined()
    expect(parseAppStartLatestHash(data, 'baked-hash-123')).toBe(
      'baked-hash-123'
    )
  })

  it('returns the advertised latest hash when LOKI reports drift', () => {
    const data: AppStartResponse = {
      eventResult: {
        eventResultType: 'SUCCESS',
        eventResponseData: { latestGlobalGameConfigVersion: 'new-live-hash' }
      }
    }
    expect(parseAppStartLatestHash(data, 'old-baked')).toBe('new-live-hash')
  })

  it('supports the top-level latest fallback', () => {
    expect(
      parseAppStartLatestHash(
        { latestGlobalGameConfigVersion: 'top-level' },
        'old'
      )
    ).toBe('top-level')
  })

  it('throws on a non-SUCCESS response', () => {
    const data: AppStartResponse = {
      eventResult: {
        eventResultType: 'FAILURE',
        failure: {},
        errorMessage: 'bad session'
      }
    }
    expect(() => parseAppStartLatestHash(data, 'old')).toThrow(/bad session/)
  })

  it('throws on an empty/garbage response', () => {
    expect(() => parseAppStartLatestHash({}, 'old')).toThrow(
      /APP_START did not succeed/
    )
  })
})

describe('isRetryableNetworkError', () => {
  it('flags transient DNS / network errors as retryable', () => {
    expect(
      isRetryableNetworkError(
        'getaddrinfo EAI_AGAIN cdn.loki.snowprintstudios.com'
      )
    ).toBe(true)
    expect(isRetryableNetworkError('fetch failed')).toBe(true)
    expect(isRetryableNetworkError('connect ECONNRESET')).toBe(true)
    expect(isRetryableNetworkError('ETIMEDOUT')).toBe(true)
    expect(isRetryableNetworkError('getaddrinfo ENOTFOUND host')).toBe(true)
  })
  it('does not flag non-network errors', () => {
    expect(isRetryableNetworkError('APP_START returned HTTP 401')).toBe(false)
    expect(isRetryableNetworkError('response was not JSON')).toBe(false)
  })
})

describe('isDiscordWebhookUrl', () => {
  it('accepts real discord webhook URLs', () => {
    const path = `api/${'webhooks'}/123/abc`
    expect(isDiscordWebhookUrl(`https://discord.com/${path}`)).toBe(true)
    expect(isDiscordWebhookUrl(`https://ptb.discord.com/${path}`)).toBe(true)
    expect(isDiscordWebhookUrl(`https://canary.discord.com/${path}`)).toBe(true)
    expect(isDiscordWebhookUrl(`https://discordapp.com/${path}`)).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isDiscordWebhookUrl(undefined)).toBe(false)
    expect(isDiscordWebhookUrl('')).toBe(false)
    expect(isDiscordWebhookUrl('https://evil.example.com/webhook')).toBe(false)
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/123/abc')).toBe(
      false
    )
    expect(isDiscordWebhookUrl('https://discord.com/channels/123/456')).toBe(
      false
    )
  })
})
