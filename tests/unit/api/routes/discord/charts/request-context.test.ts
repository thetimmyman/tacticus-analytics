import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/app/lib/db'
import {
  cacheDiscordChart,
  resolveDiscordGuildSeasonContext
} from '@/app/api/discord/charts/request-context'

const fakeDatabase = {} as Database

// Non-privacy cases inject a public guild so the fake database is never touched.
const publicGuild = { loadModes: async () => ['public' as const] }

describe('Discord chart request context', () => {
  it('rejects a missing guild before creating a database client', async () => {
    const createDatabase = vi.fn(() => fakeDatabase)
    const result = await resolveDiscordGuildSeasonContext(
      new Request('https://example.test/chart?season=123'),
      { dependencies: { createDatabase, ...publicGuild } }
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a validation response')
    expect(result.response.status).toBe(400)
    expect(await result.response.text()).toBe('Missing guild parameter')
    expect(createDatabase).not.toHaveBeenCalled()
  })

  it('normalizes guild and uses an explicitly supplied season', async () => {
    const getSeason = vi.fn(async () => '999')
    const resolveGuildLabel = vi.fn(async () => 'Display Guild')
    const result = await resolveDiscordGuildSeasonContext(
      new Request('https://example.test/chart?guild=ab-cd&season=%20123%20'),
      {
        dependencies: {
          createDatabase: () => fakeDatabase,
          getSeason,
          resolveGuildLabel,
          ...publicGuild
        }
      }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a resolved context')
    expect(result.context).toMatchObject({
      guild: 'AB-CD',
      guildLabel: 'Display Guild',
      season: '123',
      supabase: fakeDatabase
    })
    expect(result.context.privacy.modes).toEqual(['public'])
    expect(resolveGuildLabel).toHaveBeenCalledWith(fakeDatabase, 'AB-CD')
    expect(getSeason).not.toHaveBeenCalled()
  })

  it('loads the current season and preserves the standard failure response', async () => {
    const success = await resolveDiscordGuildSeasonContext(
      new Request('https://example.test/chart?guild=abcd'),
      {
        dependencies: {
          createDatabase: () => fakeDatabase,
          getSeason: async () => '456',
          resolveGuildLabel: async () => 'Guild',
          ...publicGuild
        }
      }
    )
    expect(success.ok && success.context.season).toBe('456')

    const failure = await resolveDiscordGuildSeasonContext(
      new Request('https://example.test/chart?guild=abcd'),
      {
        dependencies: {
          createDatabase: () => fakeDatabase,
          getSeason: async () => {
            throw new Error('unavailable')
          },
          resolveGuildLabel: async () => 'Guild',
          ...publicGuild
        }
      }
    )
    expect(failure.ok).toBe(false)
    if (failure.ok) throw new Error('expected a season failure')
    expect(failure.response.status).toBe(500)
    expect(await failure.response.text()).toBe('Unable to determine season')
  })

  it('applies the private, no-store cache policy', () => {
    const response = cacheDiscordChart(new Response('chart'))
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('refuses a hide_all guild with 403 before any label or season work', async () => {
    const resolveGuildLabel = vi.fn(async () => 'Display Guild')
    const getSeason = vi.fn(async () => '999')
    const result = await resolveDiscordGuildSeasonContext(
      new Request('https://example.test/chart?guild=abcd'),
      {
        dependencies: {
          createDatabase: () => fakeDatabase,
          getSeason,
          resolveGuildLabel,
          loadModes: async () => ['hide_all']
        }
      }
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a privacy refusal')
    expect(result.response.status).toBe(403)
    expect(result.response.headers.get('Cache-Control')).toBe(
      'private, no-store'
    )
    expect(resolveGuildLabel).not.toHaveBeenCalled()
    expect(getSeason).not.toHaveBeenCalled()
  })

  it('surfaces hide_players so routes can anonymise per-player labels', async () => {
    const result = await resolveDiscordGuildSeasonContext(
      new Request('https://example.test/chart?guild=abcd&season=12'),
      {
        dependencies: {
          createDatabase: () => fakeDatabase,
          resolveGuildLabel: async () => 'Display Guild',
          loadModes: async () => ['hide_players']
        }
      }
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a resolved context')
    expect(result.context.privacy.hidePlayers).toBe(true)
    expect(result.context.privacy.playerLabel('RealName')).toBe(
      'Anonymous Warrior'
    )
  })
})
