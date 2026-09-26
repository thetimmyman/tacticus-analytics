import { describe, it, expect } from 'vitest'
import {
  isSweepRow as denoIsSweepRow,
  isOneShotRow,
  isMeaningfulBattleRow,
  applyQualifyingSweepException as denoApplyQualifyingSweepException,
  type DamageRow
} from '../../../supabase/functions/_shared/damage-classification.ts'
// Deno cannot import the app module, so this keeps both copies in lockstep.
import {
  isSweepRow as appIsSweepRow,
  applyQualifyingSweepException as appApplyQualifyingSweepException
} from '@/app/lib/calculations/utils/sweep-helpers'

const row = (
  damageDealt: number | null,
  remainingHp: number | null,
  maxHp: number | null,
  damageType: string | null = 'Battle'
): DamageRow => ({ damageDealt, remainingHp, maxHp, damageType })

const FIXTURES: Array<{ name: string; row: DamageRow; sweep: boolean }> = [
  { name: 'non-kill', row: row(1_000_000, 500_000, 1_500_000), sweep: false },
  {
    name: 'one-shot (damage = maxHp)',
    row: row(1_500_000, 0, 1_500_000),
    sweep: false
  },
  {
    name: 'one-shot (overkill)',
    row: row(2_000_000, 0, 1_500_000),
    sweep: false
  },
  { name: 'sweep', row: row(400_000, 0, 1_500_000), sweep: true },
  {
    name: 'crash (0 damage, boss alive)',
    row: row(0, 500_000, 1_500_000),
    sweep: false
  },
  { name: 'zero-damage kill-blow', row: row(0, 0, 1_500_000), sweep: true },
  { name: 'null maxHp kill-blow', row: row(400_000, 0, null), sweep: false },
  {
    name: 'zero maxHp kill-blow (legacy row)',
    row: row(400_000, 0, 0),
    sweep: false
  },
  // Strict null: remainingHp must === 0. The writer never persists null.
  {
    name: 'null remainingHp is NOT a sweep',
    row: row(400_000, null, 1_500_000),
    sweep: false
  }
]

describe('edge damage-classification', () => {
  describe('isSweepRow parity with app sweep-helpers', () => {
    for (const fixture of FIXTURES) {
      it(`${fixture.name}: deno=${fixture.sweep} and matches the app copy`, () => {
        expect(denoIsSweepRow(fixture.row)).toBe(fixture.sweep)
        expect(appIsSweepRow(fixture.row)).toBe(fixture.sweep)
      })
    }
  })

  describe('isOneShotRow', () => {
    it('is true only for full-HP-or-more kills', () => {
      expect(isOneShotRow(row(1_500_000, 0, 1_500_000))).toBe(true)
      expect(isOneShotRow(row(2_000_000, 0, 1_500_000))).toBe(true)
      expect(isOneShotRow(row(400_000, 0, 1_500_000))).toBe(false)
      expect(isOneShotRow(row(1_000_000, 500_000, 1_500_000))).toBe(false)
    })
  })

  describe('isMeaningfulBattleRow (sweep-free average membership)', () => {
    it('keeps non-kills and one-shots', () => {
      expect(isMeaningfulBattleRow(row(1_000_000, 500_000, 1_500_000))).toBe(
        true
      )
      expect(isMeaningfulBattleRow(row(1_500_000, 0, 1_500_000))).toBe(true)
    })

    it('drops sweeps, crashes and bombs', () => {
      expect(isMeaningfulBattleRow(row(400_000, 0, 1_500_000))).toBe(false)
      expect(isMeaningfulBattleRow(row(0, 500_000, 1_500_000))).toBe(false)
      expect(
        isMeaningfulBattleRow(row(900_000, 500_000, 1_500_000, 'Bomb'))
      ).toBe(false)
    })

    it('treats a missing damageType as Battle', () => {
      expect(
        isMeaningfulBattleRow(row(1_000_000, 500_000, 1_500_000, null))
      ).toBe(true)
    })
  })

  describe('applyQualifyingSweepException parity with app sweep-helpers', () => {
    const CASES = [
      {
        name: 'qualifying sweep above both gates is folded in',
        args: [1_000_000, 1, [1_500_000], 800_000, 1_000_000] as const
      },
      {
        name: 'sweep below the player own avg is dropped (WI-1462)',
        args: [2_000_000, 2, [900_000], 800_000, 1_000_000] as const
      },
      {
        name: 'sweep below the reference avg is dropped',
        args: [0, 0, [500_000], 800_000, 0] as const
      },
      {
        name: 'no reference baseline drops all sweeps',
        args: [1_000_000, 1, [5_000_000], 0, 1_000_000] as const
      },
      {
        name: 'mixed sweeps: only those >= GREATEST gate count',
        args: [
          3_000_000,
          3,
          [900_000, 1_100_000, 2_000_000],
          950_000,
          1_000_000
        ] as const
      }
    ]

    for (const testCase of CASES) {
      it(testCase.name, () => {
        const denoResult = denoApplyQualifyingSweepException(...testCase.args)
        const appResult = appApplyQualifyingSweepException(...testCase.args)
        expect(denoResult).toEqual(appResult)
      })
    }

    it('computes the expected adjusted average for a qualifying sweep', () => {
      const { adjustedDamage, adjustedCount } =
        denoApplyQualifyingSweepException(
          1_000_000,
          1,
          [1_500_000],
          800_000,
          1_000_000
        )
      expect(adjustedDamage).toBe(2_500_000)
      expect(adjustedCount).toBe(2)
    })
  })
})
