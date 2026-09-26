import { describe, it, expect } from 'vitest'
import { normalizeBossKey, getBossDisplayName } from '@/app/lib/utils/bossNames'

describe('Boss Names Utilities', () => {
  describe('normalizeBossKey', () => {
    it('returns empty string for null/undefined', () => {
      expect(normalizeBossKey(null)).toBe('')
      expect(normalizeBossKey(undefined)).toBe('')
      expect(normalizeBossKey('')).toBe('')
    })

    it('removes special characters and lowercases', () => {
      expect(normalizeBossKey('Boss-Name')).toBe('bossname')
      expect(normalizeBossKey('Boss_Name')).toBe('bossname')
      expect(normalizeBossKey('Boss Name')).toBe('bossname')
      expect(normalizeBossKey('Boss.Name')).toBe('bossname')
    })

    it('normalizes Tervigon variants', () => {
      expect(normalizeBossKey('Tervigon')).toBe('tervigon')
      expect(normalizeBossKey('TervigonGorgon')).toBe('tervigon')
      expect(normalizeBossKey('Tervigon Leviathan')).toBe('tervigon')
      expect(normalizeBossKey('TervigonKronos')).toBe('tervigon')
    })

    it('normalizes Hive Tyrant variants', () => {
      expect(normalizeBossKey('Hive Tyrant')).toBe('hive_tyrant')
      expect(normalizeBossKey('HiveTyrant')).toBe('hive_tyrant')
      expect(normalizeBossKey('HiveTyrantGorgon')).toBe('hive_tyrant')
      expect(normalizeBossKey('Hive Tyrant (Leviathan)')).toBe('hive_tyrant')
    })

    it('normalizes Screamer Killer', () => {
      expect(normalizeBossKey('Screamer Killer')).toBe('screamer_killer')
      expect(normalizeBossKey('ScreamerKiller')).toBe('screamer_killer')
    })

    it('normalizes Rogal Dorn', () => {
      expect(normalizeBossKey('Rogal Dorn')).toBe('rogaldorn')
      expect(normalizeBossKey('RogalDorn')).toBe('rogaldorn')
    })

    it('normalizes Avatar of Khaine', () => {
      expect(normalizeBossKey('Avatar of Khaine')).toBe('avatarofkhaine')
      expect(normalizeBossKey('AvatarOfKhaine')).toBe('avatarofkhaine')
    })

    it('normalizes Belisarius variants', () => {
      expect(normalizeBossKey('Belisarius')).toBe('belisarius')
      expect(normalizeBossKey('BelisariusCawl')).toBe('belisarius')
      expect(normalizeBossKey('Belisarius Cawl')).toBe('belisarius')
    })

    it('normalizes Mortarion variants', () => {
      expect(normalizeBossKey('Mortarion')).toBe('mortarion')
      expect(normalizeBossKey('Mortarian')).toBe('mortarion')
    })

    it('returns cleaned value for unknown bosses', () => {
      expect(normalizeBossKey('CustomBoss')).toBe('customboss')
      expect(normalizeBossKey('Some Unknown Boss')).toBe('someunknownboss')
    })
  })

  describe('getBossDisplayName', () => {
    it('returns "Unknown Boss" for null/undefined', () => {
      expect(getBossDisplayName(null)).toBe('Unknown Boss')
      expect(getBossDisplayName(undefined)).toBe('Unknown Boss')
    })

    it('returns display name for known bosses', () => {
      expect(getBossDisplayName('avatarofkhaine')).toBe('Avatar of Khaine')
      expect(getBossDisplayName('belisarius')).toBe('Belisarius Cawl')
      expect(getBossDisplayName('BelisariusCawl')).toBe('Belisarius Cawl')
      // Reworked 'BelisariusRW' resolves to the real name, as the meta routes rely on.
      expect(getBossDisplayName('BelisariusRW')).toBe('Belisarius Cawl')
      expect(getBossDisplayName('ghazghkull')).toBe('Ghazghkull Thraka')
      expect(getBossDisplayName('Lion')).toBe("Lion El'Jonson")
    })

    it('returns proper display name for Tyranid bosses', () => {
      expect(getBossDisplayName('hivetyrant')).toBe('Hive Tyrant')
      expect(getBossDisplayName('HiveTyrant')).toBe('Hive Tyrant')
      expect(getBossDisplayName('screamer_killer')).toBe('Screamer Killer')
      expect(getBossDisplayName('tervigon')).toBe('Tervigon')
    })

    it('returns proper display name for Mortarion', () => {
      expect(getBossDisplayName('mortarion')).toBe('Mortarion')
      expect(getBossDisplayName('Mortarion')).toBe('Mortarion')
    })

    it('returns proper display name for Rogal Dorn', () => {
      expect(getBossDisplayName('rogaldorn')).toBe('Rogal Dorn')
      expect(getBossDisplayName('RogalDorn')).toBe('Rogal Dorn')
    })

    it('humanizes unknown boss names', () => {
      // Title-casing keeps rotation slugs like 'rogaldorn' from reaching users lowercase.
      expect(getBossDisplayName('custom_boss')).toBe('Custom Boss')

      expect(getBossDisplayName('CustomBoss')).toBe('Custom Boss')
      expect(getBossDisplayName('SomeNewEnemy')).toBe('Some New Enemy')
    })

    it('handles variant boss names', () => {
      expect(getBossDisplayName('hivetyrantgorgon')).toBe(
        'Hive Tyrant (Gorgon)'
      )
      expect(getBossDisplayName('tervigonleviathan')).toBe(
        'Tervigon (Leviathan)'
      )
    })

    it('returns Unknown Boss for empty string after cleaning', () => {
      expect(getBossDisplayName('')).toBe('Unknown Boss')
    })
  })
})
