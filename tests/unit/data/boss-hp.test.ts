import { describe, it, expect } from 'vitest'
import { getAllBossHp, lookupBossHpByName } from '@/app/lib/data/boss-hp'
import {
  BOSS_HP_BY_LEVEL_TACTICUSTABLE,
  MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE,
  BOSS_HP_BY_NAME,
  PRIME_HP_BY_BOSS
} from '@/app/lib/constants/tacticustable-boss-hp'

describe('Boss HP Data Module', () => {
  describe('BOSS_HP_BY_LEVEL_TACTICUSTABLE constants', () => {
    it('should have HP values for all 5 legendary levels', () => {
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE).toHaveProperty('L1')
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE).toHaveProperty('L2')
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE).toHaveProperty('L3')
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE).toHaveProperty('L4')
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE).toHaveProperty('L5')
    })

    it('should have increasing HP values for higher levels', () => {
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L1).toBeLessThan(
        BOSS_HP_BY_LEVEL_TACTICUSTABLE.L2
      )
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L2).toBeLessThan(
        BOSS_HP_BY_LEVEL_TACTICUSTABLE.L3
      )
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L3).toBeLessThan(
        BOSS_HP_BY_LEVEL_TACTICUSTABLE.L4
      )
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L4).toBeLessThan(
        BOSS_HP_BY_LEVEL_TACTICUSTABLE.L5
      )
    })

    it('should have HP values in expected ranges', () => {
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L1).toBeGreaterThan(4000000)
      expect(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L5).toBeLessThan(20000000)
    })
  })

  describe('MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE constants', () => {
    it('should have M1 level defined', () => {
      expect(MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE).toHaveProperty('M1')
    })

    it('should have M1 HP greater than L5', () => {
      expect(MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE.M1).toBeGreaterThan(
        BOSS_HP_BY_LEVEL_TACTICUSTABLE.L5
      )
    })

    it('should have M1 HP in expected range', () => {
      expect(MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE.M1).toBeGreaterThan(25000000)
      expect(MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE.M1).toBeLessThan(35000000)
    })
  })

  describe('BOSS_HP_BY_NAME constants', () => {
    it('should have HP data for Magnus', () => {
      expect(BOSS_HP_BY_NAME).toHaveProperty('Magnus')
      expect(BOSS_HP_BY_NAME.Magnus).toHaveProperty('M1')
      expect(BOSS_HP_BY_NAME.Magnus).toHaveProperty('L5')
      expect(BOSS_HP_BY_NAME.Magnus).toHaveProperty('L1')
    })

    it('should have HP data for Avatar', () => {
      expect(BOSS_HP_BY_NAME).toHaveProperty('Avatar')
      expect(BOSS_HP_BY_NAME.Avatar.M1).toBe(25000000)
    })

    it('should have HP data for all major bosses', () => {
      const expectedBosses = [
        'Magnus',
        'Avatar',
        'Rogaldorn',
        'ScreamerKiller',
        'Mortarion',
        'Ghazghkull',
        'SilentKing',
        'Riptide',
        'Belisarius'
      ]
      expectedBosses.forEach((boss) => {
        expect(BOSS_HP_BY_NAME).toHaveProperty(boss)
      })
    })

    it('should have consistent HP scaling across levels', () => {
      const magnus = BOSS_HP_BY_NAME.Magnus
      expect(magnus.L1).toBeLessThan(magnus.L2)
      expect(magnus.L2).toBeLessThan(magnus.L3)
      expect(magnus.L3).toBeLessThan(magnus.L4)
      expect(magnus.L4).toBeLessThan(magnus.L5)
      expect(magnus.L5).toBeLessThan(magnus.M1)
    })

    it('should have different HP values for different bosses at same level', () => {
      expect(BOSS_HP_BY_NAME.Magnus.M1).not.toBe(BOSS_HP_BY_NAME.Avatar.M1)
    })
  })

  describe('PRIME_HP_BY_BOSS constants', () => {
    it('should have prime HP data for Magnus', () => {
      expect(PRIME_HP_BY_BOSS).toHaveProperty('Magnus')
      expect(PRIME_HP_BY_BOSS.Magnus.M1).toHaveProperty('prime1')
      expect(PRIME_HP_BY_BOSS.Magnus.M1).toHaveProperty('prime2')
    })

    it('should have prime HP significantly less than boss HP', () => {
      const magnusBossHp = BOSS_HP_BY_NAME.Magnus.M1
      const magnusPrime1Hp = PRIME_HP_BY_BOSS.Magnus.M1.prime1!
      expect(magnusPrime1Hp).toBeLessThan(magnusBossHp * 0.1)
    })

    it('should have prime1 and prime2 values for major bosses', () => {
      expect(PRIME_HP_BY_BOSS.Magnus.M1.prime1).toBeDefined()
      expect(PRIME_HP_BY_BOSS.Magnus.M1.prime2).toBeDefined()
      expect(PRIME_HP_BY_BOSS.SilentKing.M1.prime1).toBeDefined()
      expect(PRIME_HP_BY_BOSS.SilentKing.M1.prime2).toBeDefined()
    })

    it('should scale prime HP with levels', () => {
      const rogaldornPrimes = PRIME_HP_BY_BOSS.Rogaldorn
      expect(rogaldornPrimes.L1.prime2!).toBeLessThan(
        rogaldornPrimes.L2.prime2!
      )
      expect(rogaldornPrimes.L2.prime2!).toBeLessThan(
        rogaldornPrimes.L3.prime2!
      )
      expect(rogaldornPrimes.L3.prime2!).toBeLessThan(
        rogaldornPrimes.L4.prime2!
      )
      expect(rogaldornPrimes.L4.prime2!).toBeLessThan(
        rogaldornPrimes.L5.prime2!
      )
      expect(rogaldornPrimes.L5.prime2!).toBeLessThan(
        rogaldornPrimes.M1.prime2!
      )
    })

    it('should have symmetric primes for ScreamerKiller', () => {
      const skPrimes = PRIME_HP_BY_BOSS.ScreamerKiller.M1
      expect(skPrimes.prime1).toBe(skPrimes.prime2)
    })

    it('should have asymmetric primes for Mortarion', () => {
      const mortPrimes = PRIME_HP_BY_BOSS.Mortarion.M1
      expect(mortPrimes.prime1).not.toBe(mortPrimes.prime2)
    })
  })

  describe('getAllBossHp function', () => {
    it('should return all HP data categories', async () => {
      const result = await getAllBossHp()

      expect(result).toHaveProperty('legendary')
      expect(result).toHaveProperty('mythic')
      expect(result).toHaveProperty('primes')
      expect(result).toHaveProperty('byBossName')
    })

    it('should return legendary HP data matching constants', async () => {
      const result = await getAllBossHp()

      expect(result.legendary.L1).toBe(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L1)
      expect(result.legendary.L5).toBe(BOSS_HP_BY_LEVEL_TACTICUSTABLE.L5)
    })

    it('should return mythic HP data matching constants', async () => {
      const result = await getAllBossHp()

      expect(result.mythic.M1).toBe(MYTHIC_BOSS_HP_BY_LEVEL_TACTICUSTABLE.M1)
    })

    it('should populate byBossName with combined keys', async () => {
      const result = await getAllBossHp()

      expect(result.byBossName).toHaveProperty('Magnus_M1')
      expect(result.byBossName).toHaveProperty('Magnus_L5')
      expect(result.byBossName['Magnus_M1']).toBe(BOSS_HP_BY_NAME.Magnus.M1)
    })

    it('should populate primes with combined keys', async () => {
      const result = await getAllBossHp()

      expect(result.primes).toHaveProperty('Magnus_M1')
      expect(result.primes['Magnus_M1']).toBe(PRIME_HP_BY_BOSS.Magnus.M1.prime1)
    })

    it('should handle prime2 keys correctly', async () => {
      const result = await getAllBossHp()

      expect(result.primes).toHaveProperty('Magnus_prime2_M1')
      expect(result.primes['Magnus_prime2_M1']).toBe(
        PRIME_HP_BY_BOSS.Magnus.M1.prime2
      )
    })

    it('should accept optional guildCode parameter', async () => {
      const result1 = await getAllBossHp()
      const result2 = await getAllBossHp('GUILD')

      expect(result1).toEqual(result2)
    })
  })

  describe('lookupBossHpByName', () => {
    // Level-keyed candidates must win over the bare-name key, which holds the last
    // level written (L1) and inflates scores 6-8x.
    it('returns level-specific HP when data Name has a stripped suffix (BelisariusRW → Belisarius)', async () => {
      const { byBossName } = await getAllBossHp()
      expect(
        lookupBossHpByName('BelisariusRW', 'BelisariusRW_M2', byBossName)
      ).toBe(BOSS_HP_BY_NAME.Belisarius.M2)
      expect(
        lookupBossHpByName('BelisariusRW', 'BelisariusRW_L1', byBossName)
      ).toBe(BOSS_HP_BY_NAME.Belisarius.L1)
    })

    it('returns level-specific HP when data Name extends the constants name (AvatarOfKhaine → Avatar)', async () => {
      const { byBossName } = await getAllBossHp()
      expect(
        lookupBossHpByName('AvatarOfKhaine', 'AvatarOfKhaine_M1', byBossName)
      ).toBe(BOSS_HP_BY_NAME.Avatar.M1)
      expect(
        lookupBossHpByName('AvatarOfKhaine', 'AvatarOfKhaine_L5', byBossName)
      ).toBe(BOSS_HP_BY_NAME.Avatar.L5)
    })

    it('returns level-specific HP when only casing differs (RogalDorn → Rogaldorn)', async () => {
      const { byBossName } = await getAllBossHp()
      expect(lookupBossHpByName('RogalDorn', 'RogalDorn_L4', byBossName)).toBe(
        BOSS_HP_BY_NAME.Rogaldorn.L4
      )
      expect(lookupBossHpByName('RogalDorn', 'RogalDorn_M3', byBossName)).toBe(
        BOSS_HP_BY_NAME.Rogaldorn.M3
      )
    })

    it('returns the exact match when name and level both align', async () => {
      const { byBossName } = await getAllBossHp()
      expect(lookupBossHpByName('Magnus', 'Magnus_M2', byBossName)).toBe(
        BOSS_HP_BY_NAME.Magnus.M2
      )
      expect(lookupBossHpByName('Mortarion', 'Mortarion_M1', byBossName)).toBe(
        BOSS_HP_BY_NAME.Mortarion.M1
      )
    })

    it('does not silently return L1 HP for higher levels (the bug)', async () => {
      const { byBossName } = await getAllBossHp()
      // M2 > L1 proves the lookup did not collapse to the bare-name key.
      const got = lookupBossHpByName(
        'BelisariusRW',
        'BelisariusRW_M2',
        byBossName
      )
      expect(got).toBeGreaterThan(BOSS_HP_BY_NAME.Belisarius.L1)
    })

    it('returns 0 for an unknown boss', async () => {
      const { byBossName } = await getAllBossHp()
      expect(
        lookupBossHpByName('NotARealBoss', 'NotARealBoss_M1', byBossName)
      ).toBe(0)
    })
  })

  describe('HP value validation', () => {
    it('all HP values should be positive integers', () => {
      Object.values(BOSS_HP_BY_LEVEL_TACTICUSTABLE).forEach((hp) => {
        expect(hp).toBeGreaterThan(0)
        expect(Number.isInteger(hp)).toBe(true)
      })
    })

    it('all boss HP values should be positive', () => {
      Object.values(BOSS_HP_BY_NAME).forEach((bossLevels) => {
        Object.values(bossLevels).forEach((hp) => {
          expect(hp).toBeGreaterThan(0)
        })
      })
    })

    it('all prime HP values should be positive', () => {
      Object.values(PRIME_HP_BY_BOSS).forEach((bossLevels) => {
        Object.values(bossLevels).forEach((primeData) => {
          if (primeData.prime1) expect(primeData.prime1).toBeGreaterThan(0)
          if (primeData.prime2) expect(primeData.prime2).toBeGreaterThan(0)
        })
      })
    })
  })
})
