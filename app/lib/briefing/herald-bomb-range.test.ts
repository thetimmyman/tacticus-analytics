import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { computeLiveBombRangeEncounters } from '@/app/lib/briefing/herald-bomb-range'
import { BOMB_COOLDOWN_SECONDS } from '@/app/lib/calculations/bomb-availability'

describe('computeLiveBombRangeEncounters (authoritative live signal)', () => {
  // In range when ceil(remainingHp / dmg) <= floor(bombsAvailable × threshold).
  const DMG = 13_720 // guild level 43 worst_case floor

  it('flags an encounter needing multiple bombs when the guild covers it', () => {
    expect(
      computeLiveBombRangeEncounters(
        [{ encounter_id: 1, remaining_hp: 80_000 }],
        DMG,
        9,
        0.9
      )
    ).toEqual([1])
  })

  it('does not flag when bombs in hand fall short of the overkill margin', () => {
    expect(
      computeLiveBombRangeEncounters(
        [{ encounter_id: 1, remaining_hp: 80_000 }],
        DMG,
        6,
        0.9
      )
    ).toEqual([])
  })

  it('self-expires: zero bombs in hand → nothing is in range', () => {
    expect(
      computeLiveBombRangeEncounters(
        [{ encounter_id: 1, remaining_hp: 5_000 }],
        DMG,
        0,
        0.9
      )
    ).toEqual([])
  })

  it('degrades to [] on unknown damage or unknown bomb count', () => {
    const rows = [{ encounter_id: 1, remaining_hp: 5_000 }]
    expect(computeLiveBombRangeEncounters(rows, null, 9, 0.9)).toEqual([])
    expect(computeLiveBombRangeEncounters(rows, DMG, null, 0.9)).toEqual([])
  })

  it('skips dead/unknown-HP rows and non-numeric encounters', () => {
    expect(
      computeLiveBombRangeEncounters(
        [
          { encounter_id: 1, remaining_hp: null },
          { encounter_id: null, remaining_hp: 5_000 },
          { encounter_id: 2, remaining_hp: 5_000 }
        ],
        DMG,
        9,
        0.9
      )
    ).toEqual([2])
  })
})

describe('bomb-cooldown parity pin', () => {
  it('the SQL RPC and bomb-availability.ts agree on the 18h cooldown (64800s)', () => {
    expect(BOMB_COOLDOWN_SECONDS).toBe(64_800)
    const migration = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260813000000_clean_baseline.sql'
      ),
      'utf8'
    )
    expect(migration).toContain("interval '64800 seconds'")
  })
})
