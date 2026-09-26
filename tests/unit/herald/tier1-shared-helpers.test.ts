import { describe, it, expect } from 'vitest'
import {
  buildEmojiResolver,
  loadHeroEmojiMap
} from '@/app/lib/discord/emoji-resolver'
import {
  prependRolePings,
  appendRolePings
} from '@/app/lib/discord/role-mentions'
import { buildAllowedMentions } from '@/app/lib/discord/allowed-mentions'
import { EMBED_COLORS, COLOR_PALETTE } from '@/app/lib/discord/colors'
import { EMBED_COLORS as EMBED_COLORS_VIA_FORMATTERS } from '@/app/lib/discord/formatters'
import { COLOR_PALETTE as COLOR_PALETTE_VIA_RESPONSE_BUILDER } from '@/app/api/discord/interactions/command-handlers/utils/response-builder'
import {
  buildEmojiResolver as buildEmojiResolverViaHerald,
  loadHeroEmojiMap as loadHeroEmojiMapViaHerald
} from '@/app/lib/herald/engine'

// The colour palettes intentionally diverge and must not be unified.

describe('buildEmojiResolver (NAME-keyed)', () => {
  it('returns identity passthrough when the emoji map is empty', () => {
    const resolve = buildEmojiResolver(new Map())
    expect(resolve(':C_AC_Kariyan: hold the line')).toBe(
      ':C_AC_Kariyan: hold the line'
    )
  })

  it('substitutes a known shortcode with the stored <:name:id> literal', () => {
    const resolve = buildEmojiResolver(
      new Map([
        ['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>'],
        ['C_AC_Trajann', '<:C_AC_Trajann:222222222222222222>']
      ])
    )
    expect(resolve(':C_EC_Laviscus: :C_AC_Trajann: + :MOW_Biovore:')).toBe(
      '<:C_EC_Laviscus:111111111111111111> <:C_AC_Trajann:222222222222222222> + :MOW_Biovore:'
    )
  })

  it('leaves unknown shortcodes untouched (no-match passthrough)', () => {
    const resolve = buildEmojiResolver(
      new Map([['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>']])
    )
    expect(resolve('see :foo: at 12:34')).toBe('see :foo: at 12:34')
  })

  it('preserves the animated <a:name:id> literal verbatim', () => {
    const resolve = buildEmojiResolver(
      new Map([['Spin', '<a:Spin:333333333333333333>']])
    )
    expect(resolve(':Spin:')).toBe('<a:Spin:333333333333333333>')
  })

  it('falls back to the lowercase display-name suffix alias for underscored shortcodes', () => {
    const resolve = buildEmojiResolver(
      new Map([
        ['C_AC_SwordMaster', '<:C_AC_SwordMaster:1380247280380154086>'],
        ['kariyan', '<:C_AC_SwordMaster:1380247280380154086>']
      ])
    )
    expect(resolve(':C_AC_Kariyan:')).toBe(
      '<:C_AC_SwordMaster:1380247280380154086>'
    )
  })

  it('does NOT apply the suffix-alias fallback to non-underscored shortcodes', () => {
    const resolve = buildEmojiResolver(
      new Map([['kariyan', '<:C_AC_SwordMaster:1380247280380154086>']])
    )
    expect(resolve(':Kariyan:')).toBe(':Kariyan:')
    expect(resolve(':C_AC_Kariyan:')).toBe(
      '<:C_AC_SwordMaster:1380247280380154086>'
    )
  })

  it('is re-exported from herald.ts with identical behavior', () => {
    const map = new Map([
      ['C_EC_Laviscus', '<:C_EC_Laviscus:111111111111111111>']
    ])
    const viaModule = buildEmojiResolver(map)
    const viaHerald = buildEmojiResolverViaHerald(map)
    const input = ':C_EC_Laviscus: at 12:34 :unknown:'
    expect(viaHerald(input)).toBe(viaModule(input))
    expect(viaHerald(input)).toBe(
      '<:C_EC_Laviscus:111111111111111111> at 12:34 :unknown:'
    )
  })
})

const emojiSupabaseStub = (
  rows: Array<{ discord_emoji: string | null; display_name?: string | null }>,
  error: { message: string } | null = null
) =>
  ({
    from: () => ({
      select: () => ({
        not: () => Promise.resolve({ data: error ? null : rows, error })
      })
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

describe('loadHeroEmojiMap (NAME-keyed)', () => {
  it('builds a name-keyed map, ignoring null/whitespace/unparseable rows', async () => {
    const map = await loadHeroEmojiMap(
      emojiSupabaseStub([
        { discord_emoji: '<:C_EC_Laviscus:111111111111111111>' },
        { discord_emoji: '<:C_AC_Trajann:222222222222222222>' },
        { discord_emoji: '<a:Spin:333333333333333333>' },
        { discord_emoji: '   ' },
        { discord_emoji: null },
        { discord_emoji: 'not-an-emoji' }
      ])
    )
    expect(map.get('C_EC_Laviscus')).toBe('<:C_EC_Laviscus:111111111111111111>')
    expect(map.get('C_AC_Trajann')).toBe('<:C_AC_Trajann:222222222222222222>')
    expect(map.get('Spin')).toBe('<a:Spin:333333333333333333>')
    expect(map.size).toBe(3)
  })

  it('registers lowercase, space-stripped display-name aliases without shadowing real names', async () => {
    const map = await loadHeroEmojiMap(
      emojiSupabaseStub([
        {
          discord_emoji: '<:C_AC_SwordMaster:1380247280380154086>',
          display_name: 'Kariyan'
        },
        {
          discord_emoji: '<:C_O_BossGulgortz:1166604925850095646>',
          display_name: 'Boss Gulgortz'
        }
      ])
    )
    expect(map.get('C_AC_SwordMaster')).toBe(
      '<:C_AC_SwordMaster:1380247280380154086>'
    )
    expect(map.get('kariyan')).toBe('<:C_AC_SwordMaster:1380247280380154086>')
    expect(map.get('bossgulgortz')).toBe(
      '<:C_O_BossGulgortz:1166604925850095646>'
    )
  })

  it('returns an empty map on query error rather than throwing', async () => {
    const map = await loadHeroEmojiMap(
      emojiSupabaseStub([], { message: 'oops' })
    )
    expect(map.size).toBe(0)
  })

  it('is re-exported from herald.ts (same symbol)', () => {
    expect(loadHeroEmojiMapViaHerald).toBe(loadHeroEmojiMap)
  })
})

describe('prependRolePings', () => {
  it('returns content unchanged when no role IDs are given (empty-roles case)', () => {
    expect(prependRolePings([], 'Boss defeated')).toBe('Boss defeated')
  })

  it('prepends a single role mention on its own line', () => {
    expect(prependRolePings(['123456789012345678'], 'Boss defeated')).toBe(
      '<@&123456789012345678>\nBoss defeated'
    )
  })

  it('joins multiple role mentions with spaces above the content', () => {
    expect(
      prependRolePings(
        ['111111111111111111', '222222222222222222'],
        'Boss defeated'
      )
    ).toBe('<@&111111111111111111> <@&222222222222222222>\nBoss defeated')
  })

  it('preserves newlines in the original content', () => {
    expect(prependRolePings(['123456789012345678'], 'Line 1\nLine 2')).toBe(
      '<@&123456789012345678>\nLine 1\nLine 2'
    )
  })
})

describe('appendRolePings', () => {
  it('returns the preview line unchanged when no role IDs are given (empty-roles case)', () => {
    expect(appendRolePings([], 'Boss is now available!')).toBe(
      'Boss is now available!'
    )
  })

  it('appends a single role mention on a trailing line below the preview', () => {
    expect(
      appendRolePings(['123456789012345678'], '🎖️ Lasher is now available!')
    ).toBe('🎖️ Lasher is now available!\n<@&123456789012345678>')
  })

  it('joins multiple role mentions with spaces on the trailing line', () => {
    expect(
      appendRolePings(['111111111111111111', '222222222222222222'], 'Preview')
    ).toBe('Preview\n<@&111111111111111111> <@&222222222222222222>')
  })

  it('uses the explicit role-ping text when provided (text-mention mode)', () => {
    expect(
      appendRolePings(
        ['123456789012345678'],
        '🎖️ Lasher is now available!',
        '@Alpha Legion'
      )
    ).toBe('🎖️ Lasher is now available!\n@Alpha Legion')
  })

  it('returns only the mention when the preview line is empty', () => {
    expect(appendRolePings(['123456789012345678'], '')).toBe(
      '<@&123456789012345678>'
    )
  })

  it('returns only the preview when the resolved mention is empty (empty roles + no text)', () => {
    expect(appendRolePings([], 'Preview only')).toBe('Preview only')
  })
})

describe('buildAllowedMentions', () => {
  it('suppresses all mentions with { parse: [] } when there are no role IDs (no-ping mode)', () => {
    expect(buildAllowedMentions([])).toEqual({ parse: [] })
  })

  it('lists the role IDs under { roles: [...] } when roles are present (ping mode)', () => {
    expect(buildAllowedMentions(['123456789012345678'])).toEqual({
      roles: ['123456789012345678']
    })
    expect(
      buildAllowedMentions(['111111111111111111', '222222222222222222'])
    ).toEqual({ roles: ['111111111111111111', '222222222222222222'] })
  })

  it('passes the same array reference through (no copy) — matches the original inline expression', () => {
    const roleIds = ['123456789012345678']
    const out = buildAllowedMentions(roleIds)
    expect(out).toEqual({ roles: roleIds })
    expect((out as { roles: string[] }).roles).toBe(roleIds)
  })

  it('omits `parse` entirely in ping mode (so @everyone / users are not auto-parsed)', () => {
    const out = buildAllowedMentions(['123456789012345678'])
    expect('parse' in out!).toBe(false)
  })
})

describe('discord color palettes', () => {
  it('pins EMBED_COLORS to its exact current hex values (webhook embeds)', () => {
    expect(EMBED_COLORS).toEqual({
      success: 0x22c55e,
      warning: 0xf59e0b,
      error: 0xef4444,
      info: 0x3b82f6,
      premium: 0x8b5cf6,
      gold: 0xffd700
    })
  })

  it('pins COLOR_PALETTE to its exact current hex values (slash-command themes)', () => {
    expect(COLOR_PALETTE).toEqual({
      info: 0x5865f2,
      success: 0x3ba55d,
      warning: 0xf1c40f,
      danger: 0xed4245
    })
  })

  it('keeps the two palettes DIVERGENT on shared keys (intentional — do not unify)', () => {
    expect(EMBED_COLORS.success).not.toBe(COLOR_PALETTE.success)
    expect(EMBED_COLORS.info).not.toBe(COLOR_PALETTE.info)
    expect(EMBED_COLORS.warning).not.toBe(COLOR_PALETTE.warning)
    expect([EMBED_COLORS.success, COLOR_PALETTE.success]).toEqual([
      0x22c55e, 0x3ba55d
    ])
    expect([EMBED_COLORS.info, COLOR_PALETTE.info]).toEqual([
      0x3b82f6, 0x5865f2
    ])
    expect([EMBED_COLORS.warning, COLOR_PALETTE.warning]).toEqual([
      0xf59e0b, 0xf1c40f
    ])
  })

  it('re-exports EMBED_COLORS unchanged from formatters.ts', () => {
    expect(EMBED_COLORS_VIA_FORMATTERS).toBe(EMBED_COLORS)
  })

  it('re-exports COLOR_PALETTE unchanged from response-builder.ts', () => {
    expect(COLOR_PALETTE_VIA_RESPONSE_BUILDER).toBe(COLOR_PALETTE)
  })
})
