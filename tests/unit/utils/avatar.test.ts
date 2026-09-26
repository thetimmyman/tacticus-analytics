import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getAvatarUrl,
  getGuildColor,
  getUserAvatar,
  getDatamineAvatarUrl,
  getAvatarWithFallback,
  normalizeAvatarUnitId,
  buildAvatarFrameMap,
  resolveAvatarFrameMap,
  resolveAvatarIconUrl,
  resolvePlayerAvatar
} from '@/app/lib/utils/avatar'

describe('Avatar Utilities', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getAvatarUrl', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_AVATAR_API_URL
    })

    it('generates URL with name parameter', () => {
      const url = getAvatarUrl({ name: 'John Doe' })
      expect(url).toContain('name=JD')
    })

    it('extracts initials from multi-word names', () => {
      const url = getAvatarUrl({ name: 'John Michael Doe' })
      expect(url).toContain('name=JM') // Only first 2 initials
    })

    it('handles single word names', () => {
      const url = getAvatarUrl({ name: 'John' })
      expect(url).toContain('name=J')
    })

    it('uses default size of 40', () => {
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('size=40')
    })

    it('uses custom size when provided', () => {
      const url = getAvatarUrl({ name: 'Test', size: 100 })
      expect(url).toContain('size=100')
    })

    it('uses custom background color', () => {
      const url = getAvatarUrl({ name: 'Test', background: 'ff0000' })
      expect(url).toContain('background=ff0000')
    })

    it('uses random background by default', () => {
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('background=random')
    })

    it('uses white text color by default', () => {
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('color=ffffff')
    })

    it('sets bold to true by default', () => {
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('bold=true')
    })

    it('uses png format by default', () => {
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('format=png')
    })

    it('supports svg format', () => {
      const url = getAvatarUrl({ name: 'Test', format: 'svg' })
      expect(url).toContain('format=svg')
    })

    it('makes initials uppercase by default', () => {
      const url = getAvatarUrl({ name: 'john doe' })
      expect(url).toContain('name=JD')
    })

    it('respects uppercase=false option', () => {
      const url = getAvatarUrl({ name: 'John Doe', uppercase: false })
      expect(url).toContain('name=JD') // Initials extracted are uppercase from first letter
    })

    it('uses default API URL', () => {
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('ui-avatars.com/api')
    })

    it('uses custom API URL from env', () => {
      process.env.NEXT_PUBLIC_AVATAR_API_URL = 'https://custom.avatars.com'
      const url = getAvatarUrl({ name: 'Test' })
      expect(url).toContain('custom.avatars.com')
    })
  })

  describe('getGuildColor', () => {
    it('returns color for Iron Warriors', () => {
      expect(getGuildColor('IW')).toBe('6B7280')
    })

    it('returns color for Alpha Legion', () => {
      expect(getGuildColor('AL')).toBe('059669')
    })

    it('returns color for Dark Angels', () => {
      expect(getGuildColor('DA')).toBe('064E3B')
    })

    it('is case-insensitive', () => {
      expect(getGuildColor('iw')).toBe('6B7280')
      expect(getGuildColor('Iw')).toBe('6B7280')
    })

    it('returns default color for unknown guilds', () => {
      expect(getGuildColor('UNKNOWN')).toBe('6B7280')
      expect(getGuildColor('XYZ')).toBe('6B7280')
    })

    it('has unique colors for different guilds', () => {
      const iwColor = getGuildColor('IW')
      const alColor = getGuildColor('AL')
      const daColor = getGuildColor('DA')

      expect(iwColor).not.toBe(alColor)
      expect(alColor).not.toBe(daColor)
    })

    it('returns color for Thousand Sons', () => {
      expect(getGuildColor('TS')).toBe('7C3AED')
    })

    it('returns color for Ultramarines', () => {
      expect(getGuildColor('UM')).toBe('2563EB')
    })
  })

  describe('getUserAvatar', () => {
    it('generates avatar URL with display name', () => {
      const url = getUserAvatar('John Doe')
      expect(url).toContain('name=JD')
    })

    it('uses GLOBAL guild color by default', () => {
      const url = getUserAvatar('Test User')
      expect(url).toContain('background=6B7280')
    })

    it('uses specified guild color', () => {
      const url = getUserAvatar('Test User', 'AL')
      expect(url).toContain('background=059669')
    })

    it('uses default size of 40', () => {
      const url = getUserAvatar('Test')
      expect(url).toContain('size=40')
    })

    it('uses custom size when specified', () => {
      const url = getUserAvatar('Test', 'GLOBAL', 80)
      expect(url).toContain('size=80')
    })

    it('sets white text color', () => {
      const url = getUserAvatar('Test')
      expect(url).toContain('color=ffffff')
    })

    it('sets bold to true', () => {
      const url = getUserAvatar('Test')
      expect(url).toContain('bold=true')
    })
  })

  describe('getDatamineAvatarUrl', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL
    })

    it('generates URL for avatar unit ID', () => {
      process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL =
        '/assets/approved-sprites'
      const url = getDatamineAvatarUrl('templ_champion_01')
      expect(url).toContain('ui_avatar_templ_champion_01.png')
    })

    it('returns null without an explicitly approved sprite base', () => {
      expect(getDatamineAvatarUrl('test_avatar')).toBeNull()
    })

    it('encodes special characters in avatar ID', () => {
      process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL =
        '/assets/approved-sprites'
      const url = getDatamineAvatarUrl('avatar with spaces')
      expect(url).toContain('ui_avatar_avatar%20with%20spaces.png')
    })

    it('uses custom base URL from env', () => {
      process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL =
        'https://custom.cdn.com/sprites'
      const url = getDatamineAvatarUrl('test_avatar')
      expect(url).toContain('custom.cdn.com')
      expect(url).toContain('ui_avatar_test_avatar.png')
    })

    it('removes trailing slashes from base URL', () => {
      process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL =
        'https://example.com/sprites/'
      const url = getDatamineAvatarUrl('test')
      expect(url).toBe('https://example.com/sprites/ui_avatar_test.png')
    })
  })

  describe('getAvatarWithFallback', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_AVATAR_API_URL
    })

    it('returns custom avatar URL if valid HTTP URL', () => {
      const customUrl = 'https://example.com/avatar.png'
      const url = getAvatarWithFallback(customUrl, 'John Doe')
      expect(url).toBe(customUrl)
    })

    it('returns fallback for null avatar URL', () => {
      const url = getAvatarWithFallback(null, 'John Doe', 'AL')
      expect(url).toContain('ui-avatars.com')
      expect(url).toContain('name=JD')
    })

    it('returns fallback for undefined avatar URL', () => {
      const url = getAvatarWithFallback(undefined, 'John Doe')
      expect(url).toContain('ui-avatars.com')
    })

    it('returns fallback for empty string avatar URL', () => {
      const url = getAvatarWithFallback('', 'Test User')
      expect(url).toContain('ui-avatars.com')
    })

    it('returns fallback for non-HTTP URL', () => {
      const url = getAvatarWithFallback('local/path/avatar.png', 'Test User')
      expect(url).toContain('ui-avatars.com')
    })

    it('uses guild color in fallback', () => {
      const url = getAvatarWithFallback(null, 'Test', 'IW')
      expect(url).toContain('background=6B7280')
    })

    it('uses custom size in fallback', () => {
      const url = getAvatarWithFallback(null, 'Test', 'GLOBAL', 64)
      expect(url).toContain('size=64')
    })

    it('uses GLOBAL guild by default in fallback', () => {
      const url = getAvatarWithFallback(null, 'Test')
      expect(url).toContain('background=6B7280')
    })
  })

  describe('normalizeAvatarUnitId', () => {
    it('strips a trailing _premium suffix', () => {
      expect(normalizeAvatarUnitId('blood_deathcompany_01_premium')).toBe(
        'blood_deathcompany_01'
      )
    })

    it('strips a trailing _premium_N suffix', () => {
      expect(normalizeAvatarUnitId('blood_deathcompany_01_premium_2')).toBe(
        'blood_deathcompany_01'
      )
    })

    it('leaves non-premium ids unchanged', () => {
      expect(normalizeAvatarUnitId('templ_champion_01')).toBe(
        'templ_champion_01'
      )
    })
  })

  describe('resolveAvatarFrameMap', () => {
    it('loads the exact and premium-base ids in one query', async () => {
      const calls: Array<[string, ...unknown[]]> = []
      const result = {
        data: [
          { avatar_id: 'hero_01_premium', icon_url: '/premium.png' },
          { avatar_id: 'hero_01', icon_url: '/base.png' }
        ],
        error: null
      }
      const chain = {
        select: vi.fn((...args: unknown[]) => {
          calls.push(['select', ...args])
          return chain
        }),
        in: vi.fn((...args: unknown[]) => {
          calls.push(['in', ...args])
          return Promise.resolve(result)
        })
      }
      const supabase = {
        from: vi.fn((...args: unknown[]) => {
          calls.push(['from', ...args])
          return chain
        })
      }

      const frames = await resolveAvatarFrameMap(
        supabase as never,
        'hero_01_premium'
      )

      expect(calls).toEqual([
        ['from', 'player_avatar_frames'],
        ['select', 'avatar_id, icon_url'],
        ['in', 'avatar_id', ['hero_01_premium', 'hero_01']]
      ])
      expect(frames.get('hero_01_premium')).toBe('/premium.png')
      expect(frames.get('hero_01')).toBe('/base.png')
    })
  })

  describe('buildAvatarFrameMap', () => {
    it('maps avatar_id to icon_url and skips null icon_urls', () => {
      const map = buildAvatarFrameMap([
        { avatar_id: 'a', icon_url: 'https://cdn.example.com/a.png' },
        { avatar_id: 'b', icon_url: null }
      ])
      expect(map.get('a')).toBe('https://cdn.example.com/a.png')
      expect(map.has('b')).toBe(false)
    })
  })

  describe('resolveAvatarIconUrl', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL
    })

    const frameMap = new Map([
      ['exact_id', 'https://cdn.example.com/exact.png'],
      ['base_id_01', 'https://cdn.example.com/base.png']
    ])

    it('returns null without an avatar unit id', () => {
      expect(resolveAvatarIconUrl(null, frameMap)).toBeNull()
      expect(resolveAvatarIconUrl(undefined, frameMap)).toBeNull()
    })

    it('resolves an exact frame-map hit', () => {
      expect(resolveAvatarIconUrl('exact_id', frameMap)).toBe(
        'https://cdn.example.com/exact.png'
      )
    })

    it('falls back to the premium base id on a miss', () => {
      expect(resolveAvatarIconUrl('base_id_01_premium', frameMap)).toBe(
        'https://cdn.example.com/base.png'
      )
    })

    it('returns null when the map misses and no approved sprite base exists', () => {
      expect(resolveAvatarIconUrl('unknown_id', frameMap)).toBeNull()
    })

    it('returns null without a frame map or approved sprite base', () => {
      expect(resolveAvatarIconUrl('unknown_id')).toBeNull()
    })

    it('uses an explicitly configured approved sprite base', () => {
      process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL =
        '/assets/approved-sprites'
      expect(resolveAvatarIconUrl('unknown_id', frameMap)).toBe(
        '/assets/approved-sprites/ui_avatar_unknown_id.png'
      )
    })

    it('accepts a plain-object frame map', () => {
      expect(
        resolveAvatarIconUrl('exact_id', {
          exact_id: 'https://cdn.example.com/exact.png'
        })
      ).toBe('https://cdn.example.com/exact.png')
    })
  })

  describe('resolvePlayerAvatar', () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_AVATAR_API_URL
      delete process.env.NEXT_PUBLIC_DATAMINE_AVATAR_SPRITE_BASE_URL
    })

    it('resolves through the frame map when possible', () => {
      const url = resolvePlayerAvatar({
        avatarUnitId: 'exact_id',
        playerName: 'John Doe',
        frameMap: new Map([['exact_id', 'https://cdn.example.com/exact.png']])
      })
      expect(url).toBe('https://cdn.example.com/exact.png')
    })

    it('falls back to initials on a frame-map miss', () => {
      const url = resolvePlayerAvatar({
        avatarUnitId: 'unknown_id',
        playerName: 'John Doe',
        frameMap: new Map()
      })
      expect(url).toContain('ui-avatars.com')
      expect(url).not.toContain('ui_avatar_unknown_id.png')
    })

    it('skips the datamine tier when datamineFallback is false (falls to initials)', () => {
      const url = resolvePlayerAvatar({
        avatarUnitId: 'unknown_id',
        playerName: 'John Doe',
        frameMap: new Map(),
        datamineFallback: false
      })
      expect(url).toContain('ui-avatars.com')
      expect(url).not.toContain('ui_avatar_unknown_id.png')
    })

    it('datamineFallback: false still resolves frame-map hits', () => {
      const url = resolvePlayerAvatar({
        avatarUnitId: 'templ_champion_01',
        playerName: 'John Doe',
        frameMap: new Map([['templ_champion_01', '/frames/champ.png']]),
        datamineFallback: false
      })
      expect(url).toBe('/frames/champ.png')
    })

    it('falls back to guild-tinted initials without an avatar unit id', () => {
      const url = resolvePlayerAvatar({
        avatarUnitId: null,
        playerName: 'John Doe',
        guildCode: 'AL',
        size: 64
      })
      expect(url).toContain('ui-avatars.com')
      expect(url).toContain('name=JD')
      expect(url).toContain('background=059669')
      expect(url).toContain('size=64')
    })
  })
})
