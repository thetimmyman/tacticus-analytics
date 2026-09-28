import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect, vi } from 'vitest'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatNumber: (value: number) => String(value)
}))

import {
  applyPrivacyFilter,
  filterGuildsByPrivacy,
  formatDamageWithPrivacy,
  isGuildVisibleOnExplore,
  type GuildDataWithPrivacy
} from '@tacticus/app-core/explore-privacy'

const baseGuild = (): GuildDataWithPrivacy => ({
  guild_code: 'ABC',
  guild_name: 'Alpha',
  cluster_code: null,
  cluster_name: null,
  season: 'S1',
  total_battles: 10,
  active_players: 5,
  total_damage: 123456,
  avg_damage_per_battle: 12345,
  top_boss_hits: [
    { encounterId: 0, damage: 110000, player: 'Hero' },
    { encounterId: 1, damage: 50000, player: 'Prime' }
  ],
  veteran_count: 2,
  last_updated: '2026-01-01T00:00:00Z'
})

describe('explore-privacy', () => {
  it('hides all guild data when hide_all is set', () => {
    const result = applyPrivacyFilter(baseGuild(), ['hide_all'])
    expect(result).toBeNull()
  })

  it('filters prime encounters and anonymizes players', () => {
    const filtered = applyPrivacyFilter(baseGuild(), [
      'hide_primes',
      'hide_players'
    ])
    expect(filtered?.top_boss_hits).toHaveLength(1)
    expect((filtered?.top_boss_hits[0] as any).player).toBe('Anonymous Warrior')

    const parsedString = applyPrivacyFilter(baseGuild(), 'hide_players')
    expect((parsedString?.top_boss_hits[0] as any).player).toBe(
      'Anonymous Warrior'
    )
  })

  it('obfuscate_values labels but does not transform the numbers', () => {
    // Amounts arrive already perturbed by the view, so the client must be the identity.
    const filtered = applyPrivacyFilter(
      { ...baseGuild(), explore_obfuscation_percent: 10 },
      ['obfuscate_values']
    )

    expect(filtered?.isObfuscated).toBe(true)
    expect(filtered?.obfuscationPercent).toBe(10)
    expect(filtered?.explore_obfuscation_percent).toBe(10)
    expect(filtered?.total_damage).toBe(123456)
    expect(filtered?.avg_damage_per_battle).toBe(
      baseGuild().avg_damage_per_battle
    )
    expect(filtered?.originalTotalDamage).toBe(123456)
    expect(filtered?.originalAvgDamagePerBattle).toBe(
      baseGuild().avg_damage_per_battle
    )
    expect(filtered?.top_boss_hits[0]).toMatchObject({
      isObfuscated: true,
      obfuscationPercent: 10,
      damage: baseGuild().top_boss_hits[0].damage,
      originalDamage: baseGuild().top_boss_hits[0].damage
    })
  })

  it('a larger percent still does not move the served number', () => {
    const at10 = applyPrivacyFilter(
      { ...baseGuild(), explore_obfuscation_percent: 10 },
      ['obfuscate_values']
    )
    const at30 = applyPrivacyFilter(
      { ...baseGuild(), explore_obfuscation_percent: 30 },
      ['obfuscate_values']
    )

    expect(at10?.total_damage).toBe(at30?.total_damage)
    expect(at10?.total_damage).toBe(baseGuild().total_damage)
    expect(at10?.obfuscationPercent).toBe(10)
    expect(at30?.obfuscationPercent).toBe(30)
  })

  it('an absent percent is not replaced with a default', () => {
    // The view withholds percent; the client must not invent DEFAULT_OBFUSCATION_PERCENT.
    const served = baseGuild()
    delete (served as Record<string, unknown>).explore_obfuscation_percent

    const filtered = applyPrivacyFilter(served, ['obfuscate_values'])

    expect(filtered?.isObfuscated).toBe(true)
    expect(filtered?.obfuscationPercent).toBeUndefined()
    expect(filtered?.explore_obfuscation_percent).toBeNull()
    expect(filtered?.top_boss_hits[0]).toMatchObject({ isObfuscated: true })
    expect(filtered?.top_boss_hits[0].obfuscationPercent).toBeUndefined()
    expect(filtered?.total_damage).toBe(baseGuild().total_damage)
  })

  it('without a percent the figure is approximate, not a range', () => {
    expect(formatDamageWithPrivacy(100000, 'obfuscate_values', 100000)).toBe(
      '~100000'
    )
    expect(
      formatDamageWithPrivacy(100000, 'obfuscate_values', 100000, null)
    ).toBe('~100000')
    expect(formatDamageWithPrivacy(0, 'obfuscate_values', 250000)).toBe(
      '~250000'
    )
    expect(formatDamageWithPrivacy(100000, 'public')).toBe('100000')
  })

  it('the client module carries no obfuscation arithmetic', () => {
    // The flat 25000 increment lives only in public.explore_obfuscate_amount().
    const source = readFileSync(
      resolve(__dirname, '../../../packages/app-core/src/explore-privacy.ts'),
      'utf8'
    )
    // Strip comments first: the file header names the removed symbols.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

    expect(code).toContain('applyPrivacyFilter')
    expect(code).not.toContain('DAMAGE_OBFUSCATION_INCREMENT')
    expect(code).not.toContain('obfuscateDamageValue')
    expect(code).not.toContain('25000')
  })

  it('formats damage ranges when obfuscation is enabled', () => {
    const formatted = formatDamageWithPrivacy(
      100000,
      'obfuscate_values',
      100000,
      10
    )
    expect(formatted).toBe('90000 - 110000')
  })

  it('filters guild arrays based on privacy', () => {
    const visibleGuild = { ...baseGuild(), explore_privacy_mode: ['public'] }
    const hiddenGuild = { ...baseGuild(), explore_privacy_mode: ['hide_all'] }
    const result = filterGuildsByPrivacy([visibleGuild, hiddenGuild])
    expect(result).toHaveLength(1)
    expect(result[0].guild_code).toBe('ABC')
  })

  it('reports explore visibility correctly', () => {
    expect(isGuildVisibleOnExplore('public')).toBe(true)
    expect(isGuildVisibleOnExplore('hide_all')).toBe(false)
  })
})
