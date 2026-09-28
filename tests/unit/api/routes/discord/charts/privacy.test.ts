import { describe, expect, it, vi } from 'vitest'
import type { Database } from '@/app/lib/db'
import {
  ANONYMOUS_PLAYER_LABEL,
  guildHiddenResponse,
  parseExplorePrivacyModes,
  resolveChartPrivacy
} from '@/app/api/discord/charts/privacy'

function stubDatabase(result: {
  data?: unknown
  error?: { code?: string; message: string } | null
}): Database {
  const maybeSingle = vi.fn(async () => ({
    data: result.data ?? null,
    error: result.error ?? null
  }))
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) }))
    }))
  } as unknown as Database
}

describe('chart privacy', () => {
  it('parses the modes column in every shape PostgREST returns', () => {
    expect(parseExplorePrivacyModes(['hide_all'])).toEqual(['hide_all'])
    expect(parseExplorePrivacyModes('["hide_players"]')).toEqual([
      'hide_players'
    ])
    expect(parseExplorePrivacyModes('hide_all')).toEqual(['hide_all'])
    expect(parseExplorePrivacyModes(null)).toEqual(['public'])
    expect(parseExplorePrivacyModes('')).toEqual(['public'])
  })

  it('reports hide_all for a guild that opted out', async () => {
    const privacy = await resolveChartPrivacy(
      stubDatabase({ data: { explore_privacy_mode: ['hide_all'] } }),
      'ABCD'
    )
    expect(privacy.hideAll).toBe(true)
  })

  it('anonymises per-player labels for hide_players and leaves them alone otherwise', async () => {
    const hidden = await resolveChartPrivacy(
      stubDatabase({ data: { explore_privacy_mode: ['hide_players'] } }),
      'ABCD'
    )
    expect(hidden.hidePlayers).toBe(true)
    expect(hidden.playerLabel('RealName')).toBe(ANONYMOUS_PLAYER_LABEL)

    const open = await resolveChartPrivacy(
      stubDatabase({ data: { explore_privacy_mode: ['public'] } }),
      'ABCD'
    )
    expect(open.hidePlayers).toBe(false)
    expect(open.playerLabel('RealName')).toBe('RealName')
  })

  it('fails closed to hide_all when the privacy lookup errors', async () => {
    const privacy = await resolveChartPrivacy(
      stubDatabase({ error: { code: '42501', message: 'permission denied' } }),
      'ABCD'
    )
    expect(privacy.hideAll).toBe(true)
  })

  it('treats a guild with no config row as public', async () => {
    const privacy = await resolveChartPrivacy(stubDatabase({ data: null }), 'X')
    expect(privacy.hideAll).toBe(false)
    expect(privacy.hidePlayers).toBe(false)
  })

  it('serves 403 with a private cache policy', async () => {
    const response = guildHiddenResponse()
    expect(response.status).toBe(403)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
