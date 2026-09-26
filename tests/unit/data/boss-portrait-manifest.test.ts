import { describe, expect, it } from 'vitest'
import { bossPortraitManifest } from '@/app/lib/data/boss-portrait-manifest'

describe('boss portrait manifest', () => {
  it('resolves alpha/omega aliases to canonical slugs', () => {
    const aliasesToCheck = [
      'hivetyrantkronos_alpha_prime',
      'hivetyrantgorgon_alpha_prime',
      'hivetyrantleviathan_omega_prime',
      'tervigonleviathan_alpha_prime'
    ]

    aliasesToCheck.forEach((alias) => {
      const aliasEntry = bossPortraitManifest.byAlias[alias]
      expect(aliasEntry, `${alias} missing alias mapping`).toBeTruthy()
      const resolved = Array.isArray(aliasEntry) ? aliasEntry[0] : aliasEntry
      expect(resolved, `${alias} should resolve to a slug`).toBeTruthy()
      expect(
        bossPortraitManifest.bySlug[resolved],
        `${alias} resolved slug missing from bySlug`
      ).toBeTruthy()
    })
  })

  it('resolves Lion prime lore-name aliases to their portrait slugs (WI-2266)', () => {
    // Lore-name slugs need `baraqiel`/`forcas` in KNOWN_SUFFIXES, or prime portraits break.
    const lorePrimes: Array<[string, string]> = [
      ['baraqiel', 'lion_baraqiel'],
      ['forcas', 'lion_forcas']
    ]

    lorePrimes.forEach(([alias, expectedSlug]) => {
      const aliasEntry = bossPortraitManifest.byAlias[alias]
      const resolved = Array.isArray(aliasEntry) ? aliasEntry[0] : aliasEntry
      expect(resolved, `${alias} should alias to ${expectedSlug}`).toBe(
        expectedSlug
      )

      const entry = bossPortraitManifest.bySlug[expectedSlug]
      expect(entry, `${expectedSlug} missing from bySlug`).toBeTruthy()
      expect(entry.portraits).toMatch(new RegExp(`${expectedSlug}\\.png$`))
      expect(entry.icons, `${expectedSlug} icon missing`).toBeTruthy()
      expect(entry.thumbnails, `${expectedSlug} thumbnail missing`).toBeTruthy()
    })

    const lionBase = bossPortraitManifest.byBase['lion']
    expect(lionBase?.default).toBe('lion_main')
    expect(lionBase?.variants).toEqual(
      expect.arrayContaining(['lion_main', 'lion_baraqiel', 'lion_forcas'])
    )
  })

  it('provides fallback icon paths when dedicated files are absent', () => {
    const kronos = bossPortraitManifest.bySlug['hivetyrantkronos_main']
    expect(kronos).toBeTruthy()
    expect(kronos.portraits).toMatch(/hivetyrantkronos_main\.png$/)
    expect(kronos.icons).toBeTruthy()
    expect(kronos.thumbnails).toBeTruthy()

    expect(kronos.icons).toBe(kronos.portraits)
  })
})
