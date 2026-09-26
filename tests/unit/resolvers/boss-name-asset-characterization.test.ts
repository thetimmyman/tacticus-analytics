/** Pinned divergences are deliberate: normalizeBossKey collapses variants, normalizeBossName does not. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { normalizeBossKey, getBossDisplayName } from '@/app/lib/utils/bossNames'
import {
  normalizeBossName,
  normalizeBossType,
  normalizeIdentifier,
  bossNamesMatch
} from '@/app/lib/utils/normalize'
import { prettyBossName, VARIANT_LABELS } from '@/app/lib/loki/boss-display'
import { __testing as heraldTesting } from '@/app/lib/herald/engine'

import {
  normalizeBossKey as canonNormalizeBossKey,
  getBossDisplayName as canonGetBossDisplayName,
  prettyBossName as canonPrettyBossName,
  VARIANT_LABELS as canonVariantLabels,
  stripNonAlnumLower,
  buildBossId as canonBuildBossId,
  buildHeraldBossId as canonBuildHeraldBossId,
  parseEncounterIndexFromBossId
} from '@/app/lib/resolvers/boss-identity'

const REAL_BOSS_TYPES = [
  'AvatarOfKhaine',
  'BelisariusRW',
  'Ghazghkull',
  'HiveTyrantGorgon',
  'HiveTyrantKronos',
  'HiveTyrantLeviathan',
  'Lion',
  'Magnus',
  'Mortarion',
  'Riptide',
  'RogalDorn',
  'ScreamerKiller',
  'SilentKing',
  'TervigonGorgon',
  'TervigonKronos',
  'TervigonLeviathan'
]

describe('normalizeBossKey (bossNames.ts) — canonical variant-collapsing key', () => {
  it('returns empty string for empty / null / undefined', () => {
    expect(normalizeBossKey(null)).toBe('')
    expect(normalizeBossKey(undefined)).toBe('')
    expect(normalizeBossKey('')).toBe('')
  })

  it('lowercases and strips non-alphanumerics for plain names', () => {
    expect(normalizeBossKey('Boss-Name')).toBe('bossname')
    expect(normalizeBossKey('Boss_Name')).toBe('bossname')
    expect(normalizeBossKey('Boss Name')).toBe('bossname')
    expect(normalizeBossKey('Boss.Name')).toBe('bossname')
    expect(normalizeBossKey('Magnus')).toBe('magnus')
    expect(normalizeBossKey('Riptide')).toBe('riptide')
    expect(normalizeBossKey('GuildBoss10')).toBe('guildboss10')
  })

  it('garbage / symbols-only input strips to empty', () => {
    expect(normalizeBossKey('!!!')).toBe('')
    expect(normalizeBossKey('   ')).toBe('')
    expect(normalizeBossKey('()[]{}')).toBe('')
  })

  it('collapses Tervigon variants to "tervigon"', () => {
    expect(normalizeBossKey('Tervigon')).toBe('tervigon')
    expect(normalizeBossKey('TervigonGorgon')).toBe('tervigon')
    expect(normalizeBossKey('Tervigon Leviathan')).toBe('tervigon')
    expect(normalizeBossKey('TervigonKronos')).toBe('tervigon')
  })

  it('collapses Hive Tyrant variants to "hive_tyrant"', () => {
    expect(normalizeBossKey('Hive Tyrant')).toBe('hive_tyrant')
    expect(normalizeBossKey('HiveTyrant')).toBe('hive_tyrant')
    expect(normalizeBossKey('HiveTyrantGorgon')).toBe('hive_tyrant')
    expect(normalizeBossKey('Hive Tyrant (Leviathan)')).toBe('hive_tyrant')
    expect(normalizeBossKey('HiveTyrantKronos')).toBe('hive_tyrant')
  })

  it('collapses Screamer Killer variants to "screamer_killer"', () => {
    expect(normalizeBossKey('Screamer Killer')).toBe('screamer_killer')
    expect(normalizeBossKey('ScreamerKiller')).toBe('screamer_killer')
  })

  it('collapses Rogal Dorn variants to "rogaldorn"', () => {
    expect(normalizeBossKey('Rogal Dorn')).toBe('rogaldorn')
    expect(normalizeBossKey('RogalDorn')).toBe('rogaldorn')
  })

  it('collapses Avatar of Khaine variants to "avatarofkhaine"', () => {
    expect(normalizeBossKey('Avatar of Khaine')).toBe('avatarofkhaine')
    expect(normalizeBossKey('AvatarOfKhaine')).toBe('avatarofkhaine')
  })

  it('collapses Belisarius variants (incl. RW suffix) to "belisarius"', () => {
    expect(normalizeBossKey('Belisarius')).toBe('belisarius')
    expect(normalizeBossKey('BelisariusCawl')).toBe('belisarius')
    expect(normalizeBossKey('Belisarius Cawl')).toBe('belisarius')
    expect(normalizeBossKey('BelisariusRW')).toBe('belisarius')
  })

  it('collapses Mortarion / Mortarian spelling variants to "mortarion"', () => {
    expect(normalizeBossKey('Mortarion')).toBe('mortarion')
    expect(normalizeBossKey('Mortarian')).toBe('mortarion')
  })

  it('collapses Silent King aliases (Szarekh / The Silent King) to "silentking"', () => {
    expect(normalizeBossKey('SilentKing')).toBe('silentking')
    expect(normalizeBossKey('Silent King')).toBe('silentking')
    expect(normalizeBossKey('Szarekh')).toBe('silentking')
    expect(normalizeBossKey('The Silent King')).toBe('silentking')
  })

  it('returns the plain cleaned value for unknown bosses (no collapse)', () => {
    expect(normalizeBossKey('CustomBoss')).toBe('customboss')
    expect(normalizeBossKey('Some Unknown Boss')).toBe('someunknownboss')
    expect(normalizeBossKey('Lion')).toBe('lion')
  })
})

describe('normalizeBossName (normalize.ts) — plain lowercase+strip, NO variant collapse', () => {
  it('returns empty string for empty / null / undefined', () => {
    expect(normalizeBossName(null)).toBe('')
    expect(normalizeBossName(undefined)).toBe('')
    expect(normalizeBossName('')).toBe('')
  })

  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeBossName('Belisarius (Admec)')).toBe('belisariusadmec')
    expect(normalizeBossName('Guild_Boss_10')).toBe('guildboss10')
    expect(normalizeBossName('Boss-1')).toBe('boss1')
  })

  it('does NOT collapse variants the way normalizeBossKey does (divergence is intentional)', () => {
    expect(normalizeBossName('TervigonGorgon')).toBe('tervigongorgon')
    expect(normalizeBossName('HiveTyrantLeviathan')).toBe('hivetyrantleviathan')
    expect(normalizeBossName('BelisariusRW')).toBe('belisariusrw')
    expect(normalizeBossName('Szarekh')).toBe('szarekh')
    expect(normalizeBossName('Mortarian')).toBe('mortarian')
  })

  it('normalizeBossType is an alias of normalizeBossName', () => {
    expect(normalizeBossType('GuildBoss10Boss1')).toBe('guildboss10boss1')
    for (const t of REAL_BOSS_TYPES) {
      expect(normalizeBossType(t)).toBe(normalizeBossName(t))
    }
  })

  it('normalizeIdentifier matches normalizeBossName behavior', () => {
    expect(normalizeIdentifier('Player Name 123!')).toBe('playername123')
    expect(normalizeIdentifier(null)).toBe('')
    for (const t of REAL_BOSS_TYPES) {
      expect(normalizeIdentifier(t)).toBe(normalizeBossName(t))
    }
  })
})

describe('bossNamesMatch (normalize.ts) — prefix-aware equality after normalization', () => {
  it('exact match after normalization', () => {
    expect(bossNamesMatch('Belisarius', 'belisarius')).toBe(true)
    expect(bossNamesMatch('Boss_1', 'Boss-1')).toBe(true)
  })

  it('prefix match in either direction', () => {
    expect(bossNamesMatch('Tervigon', 'TervigonGorgon')).toBe(true)
    expect(bossNamesMatch('TervigonGorgon', 'Tervigon')).toBe(true)
  })

  it('returns false when either side normalizes to empty', () => {
    expect(bossNamesMatch('', 'Tervigon')).toBe(false)
    expect(bossNamesMatch('Tervigon', null)).toBe(false)
    expect(bossNamesMatch('!!!', 'Tervigon')).toBe(false)
  })

  it('returns false for unrelated names', () => {
    expect(bossNamesMatch('Magnus', 'Mortarion')).toBe(false)
  })
})

describe('getBossDisplayName (bossNames.ts) — humanize w/ BOSS_NAME_OVERRIDES', () => {
  it('returns "Unknown Boss" for empty / null / undefined / symbols-only', () => {
    expect(getBossDisplayName(null)).toBe('Unknown Boss')
    expect(getBossDisplayName(undefined)).toBe('Unknown Boss')
    expect(getBossDisplayName('')).toBe('Unknown Boss')
  })

  it('avatar of khaine override', () => {
    expect(getBossDisplayName('avatarofkhaine')).toBe('Avatar of Khaine')
    expect(getBossDisplayName('AvatarOfKhaine')).toBe('Avatar of Khaine')
  })

  it('belisarius overrides incl. RW suffix', () => {
    expect(getBossDisplayName('belisarius')).toBe('Belisarius Cawl')
    expect(getBossDisplayName('belisariuscawl')).toBe('Belisarius Cawl')
    expect(getBossDisplayName('BelisariusCawl')).toBe('Belisarius Cawl')
    expect(getBossDisplayName('BelisariusRW')).toBe('Belisarius Cawl')
  })

  it('ghazghkull override', () => {
    expect(getBossDisplayName('ghazghkull')).toBe('Ghazghkull Thraka')
    expect(getBossDisplayName('Ghazghkull')).toBe('Ghazghkull Thraka')
  })

  it('mortarion / mortarian override', () => {
    expect(getBossDisplayName('mortarion')).toBe('Mortarion')
    expect(getBossDisplayName('Mortarion')).toBe('Mortarion')
    expect(getBossDisplayName('mortarian')).toBe('Mortarion')
    expect(getBossDisplayName('Mortarian')).toBe('Mortarion')
  })

  it('silent king / szarekh aliases override', () => {
    expect(getBossDisplayName('silentking')).toBe('Szarekh')
    expect(getBossDisplayName('SilentKing')).toBe('Szarekh')
    expect(getBossDisplayName('szarekh')).toBe('Szarekh')
    expect(getBossDisplayName('thesilentking')).toBe('Szarekh')
    expect(getBossDisplayName('The Silent King')).toBe('Szarekh')
  })

  it('rogal dorn override', () => {
    expect(getBossDisplayName('rogaldorn')).toBe('Rogal Dorn')
    expect(getBossDisplayName('RogalDorn')).toBe('Rogal Dorn')
  })

  it('screamer killer override', () => {
    expect(getBossDisplayName('screamer_killer')).toBe('Screamer Killer')
    expect(getBossDisplayName('ScreamerKiller')).toBe('Screamer Killer')
  })

  it('hive tyrant base + variant overrides (variant overrides are reachable via the exact key)', () => {
    expect(getBossDisplayName('hive_tyrant')).toBe('Hive Tyrant')
    expect(getBossDisplayName('hivetyrant')).toBe('Hive Tyrant')
    expect(getBossDisplayName('HiveTyrant')).toBe('Hive Tyrant')
    // The un-collapsed key is consulted first, so variant overrides resolve to qualified labels.
    expect(getBossDisplayName('hivetyrantgorgon')).toBe('Hive Tyrant (Gorgon)')
    expect(getBossDisplayName('HiveTyrantLeviathan')).toBe(
      'Hive Tyrant (Leviathan)'
    )
    expect(getBossDisplayName('hivetyrantkronos')).toBe('Hive Tyrant (Kronos)')
  })

  it('lion override', () => {
    expect(getBossDisplayName('lion')).toBe("Lion El'Jonson")
    expect(getBossDisplayName('Lion')).toBe("Lion El'Jonson")
  })

  it('tervigon base + variant overrides (variant overrides are reachable via the exact key)', () => {
    expect(getBossDisplayName('tervigon')).toBe('Tervigon')
    expect(getBossDisplayName('Tervigon')).toBe('Tervigon')
    expect(getBossDisplayName('tervigongorgon')).toBe('Tervigon (Gorgon)')
    expect(getBossDisplayName('TervigonLeviathan')).toBe('Tervigon (Leviathan)')
    expect(getBossDisplayName('tervigonkronos')).toBe('Tervigon (Kronos)')
  })

  it('boss2 -> Experimental Boss override', () => {
    expect(getBossDisplayName('boss2')).toBe('Experimental Boss')
  })

  it('humanizes unknown bosses (underscore + CamelCase splitting)', () => {
    // Title-cased fallback: lowercase leaked rotation slugs to display surfaces.
    expect(getBossDisplayName('custom_boss')).toBe('Custom Boss')
    expect(getBossDisplayName('CustomBoss')).toBe('Custom Boss')
    expect(getBossDisplayName('SomeNewEnemy')).toBe('Some New Enemy')
    expect(getBossDisplayName('Magnus')).toBe('Magnus the Red')
    expect(getBossDisplayName('Riptide')).toBe('Riptide')
  })
})

describe('prettyBossName (boss-display.ts) — CamelCase humanize + variant wrapping', () => {
  it('VARIANT_LABELS set is the fluff tyranid variants', () => {
    expect([...VARIANT_LABELS].sort()).toEqual([
      'Gorgon',
      'Kronos',
      'Leviathan'
    ])
  })

  it('belisarius RW + legacy override (only when variant absent)', () => {
    expect(prettyBossName('BelisariusRW')).toBe('Belisarius Cawl')
    expect(prettyBossName('Belisarius')).toBe('Belisarius Cawl')
    expect(prettyBossName('Belisarius', 'Gorgon')).toBe('Belisarius')
  })

  it('Hive Tyrant base + embedded variant + explicit variant arg', () => {
    expect(prettyBossName('HiveTyrant')).toBe('Hive Tyrant')
    expect(prettyBossName('Hive Tyrant')).toBe('Hive Tyrant')
    expect(prettyBossName('HiveTyrantLeviathan')).toBe(
      'Hive Tyrant (Leviathan)'
    )
    expect(prettyBossName('HiveTyrantGorgon')).toBe('Hive Tyrant (Gorgon)')
    expect(prettyBossName('HiveTyrant', 'Kronos')).toBe('Hive Tyrant (Kronos)')
  })

  it('multi-part boss with known variant label suffix wraps in parens', () => {
    expect(prettyBossName('TervigonGorgon')).toBe('Tervigon (Gorgon)')
    expect(prettyBossName('TervigonKronos')).toBe('Tervigon (Kronos)')
    expect(prettyBossName('TervigonLeviathan')).toBe('Tervigon (Leviathan)')
  })

  it('single-part boss ignores the variant arg (returns bare token)', () => {
    expect(prettyBossName('Tervigon')).toBe('Tervigon')
    expect(prettyBossName('Tervigon', 'Leviathan')).toBe('Tervigon')
    expect(prettyBossName('Magnus')).toBe('Magnus')
    expect(prettyBossName('Lion')).toBe('Lion')
    expect(prettyBossName('Riptide')).toBe('Riptide')
    expect(prettyBossName('Ghazghkull')).toBe('Ghazghkull')
  })

  it('multi-part boss with an explicit variant arg wraps base in parens', () => {
    expect(prettyBossName('SomeNewBoss', 'Kronos')).toBe('Some (Kronos)')
  })

  it('CamelCase humanization differs from getBossDisplayName (intentional divergence)', () => {
    expect(prettyBossName('AvatarOfKhaine')).toBe('Avatar Of Khaine')
    expect(prettyBossName('RogalDorn')).toBe('Rogal Dorn')
    expect(prettyBossName('ScreamerKiller')).toBe('Screamer Killer')
    expect(prettyBossName('SilentKing')).toBe('Silent King')
    expect(prettyBossName('GuildBoss10')).toBe('Guild Boss10')
  })

  it('empty string passes through unchanged', () => {
    expect(prettyBossName('')).toBe('')
  })
})

describe('buildBossId (herald.ts __testing) — boss-id construction', () => {
  const buildBossId = heraldTesting.buildBossId as (
    bossType: string,
    encounterIndex: number | null
  ) => string

  it('appends _E<index> for main + prime encounters', () => {
    expect(buildBossId('Magnus', 0)).toBe('Magnus_E0')
    expect(buildBossId('Magnus', 1)).toBe('Magnus_E1')
    expect(buildBossId('Magnus', 2)).toBe('Magnus_E2')
    expect(buildBossId('BelisariusRW', 0)).toBe('BelisariusRW_E0')
    expect(buildBossId('HiveTyrantLeviathan', 2)).toBe('HiveTyrantLeviathan_E2')
  })

  it('returns bare bossType when encounterIndex is null', () => {
    expect(buildBossId('Magnus', null)).toBe('Magnus')
    expect(buildBossId('SilentKing', null)).toBe('SilentKing')
  })

  it('does not transform the bossType token (preserves raw casing/suffix)', () => {
    for (const t of REAL_BOSS_TYPES) {
      expect(buildBossId(t, 0)).toBe(`${t}_E0`)
    }
  })
})

describe('resolvers/boss-identity canonical exports === shimmed exports', () => {
  const ALL_INPUTS = [
    ...REAL_BOSS_TYPES,
    'Tervigon',
    'Hive Tyrant',
    'Hive Tyrant (Leviathan)',
    'Screamer Killer',
    'Rogal Dorn',
    'Avatar of Khaine',
    'Belisarius',
    'BelisariusCawl',
    'Belisarius Cawl',
    'Szarekh',
    'The Silent King',
    'Mortarian',
    'boss2',
    'CustomBoss',
    'custom_boss',
    'SomeNewEnemy',
    'GuildBoss10',
    'Guild_Boss_10',
    'Boss-1',
    '!!!',
    '   ',
    '',
    'Belisarius (Admec)'
  ]

  it('normalizeBossKey: shim re-exports the canonical impl (same reference)', () => {
    expect(normalizeBossKey).toBe(canonNormalizeBossKey)
  })

  it('getBossDisplayName: shim re-exports the canonical impl (same reference)', () => {
    expect(getBossDisplayName).toBe(canonGetBossDisplayName)
  })

  it('prettyBossName + VARIANT_LABELS: shim re-exports the canonical impl', () => {
    expect(prettyBossName).toBe(canonPrettyBossName)
    expect(VARIANT_LABELS).toBe(canonVariantLabels)
  })

  it('buildBossId (herald __testing) is the canonical impl', () => {
    expect(heraldTesting.buildBossId).toBe(canonBuildBossId)
  })

  it('normalizeBossName (normalize.ts) === stripNonAlnumLower across all inputs', () => {
    for (const v of [...ALL_INPUTS, null, undefined]) {
      expect(normalizeBossName(v)).toBe(stripNonAlnumLower(v))
    }
  })

  it('canonical name resolvers === shimmed across the full input matrix', () => {
    for (const v of ALL_INPUTS) {
      expect(canonNormalizeBossKey(v)).toBe(normalizeBossKey(v))
      expect(canonGetBossDisplayName(v)).toBe(getBossDisplayName(v))
      expect(canonPrettyBossName(v)).toBe(prettyBossName(v))
      expect(canonPrettyBossName(v, 'Kronos')).toBe(prettyBossName(v, 'Kronos'))
    }
  })

  it('buildHeraldBossId === buildBossId for non-null indices (shared _E construction)', () => {
    for (const t of REAL_BOSS_TYPES) {
      for (const i of [0, 1, 2]) {
        expect(canonBuildHeraldBossId(t, i)).toBe(canonBuildBossId(t, i))
        expect(canonBuildHeraldBossId(t, i)).toBe(`${t}_E${i}`)
      }
    }
  })

  it('parseEncounterIndexFromBossId round-trips buildBossId for non-null indices', () => {
    for (const t of REAL_BOSS_TYPES) {
      for (const i of [0, 1, 2]) {
        expect(parseEncounterIndexFromBossId(canonBuildBossId(t, i))).toBe(i)
      }
    }
    expect(
      parseEncounterIndexFromBossId(canonBuildBossId('Magnus', null))
    ).toBeNull()
    expect(parseEncounterIndexFromBossId('Magnus')).toBeNull()
  })
})
