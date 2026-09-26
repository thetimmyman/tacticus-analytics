// Tests the TS mirror of looping-boss awards; the SQL RPC is canonical (pgtap wi6590_votlw_looping_bosses.sql).

import { describe, it, expect } from 'vitest'
import {
  calculateSetWinners,
  calculateVOTLWPoints
} from '@/app/components/votlw/utils/votlwCalculations'
import type { BattleEntry } from '@tacticus/app-core/votlw.types'

const PLAYERS = ['Alpha', 'Bravo', 'Charlie']

const bossRows = (
  rarity: 'Legendary' | 'Mythic',
  set: number,
  loopIndices: number[]
): BattleEntry[] =>
  loopIndices.flatMap((loopIndex) =>
    PLAYERS.flatMap((displayName, p) =>
      [0, 1].map((battle) => ({
        Guild: 'EOT',
        Season: '107',
        displayName,
        userId: displayName.toLowerCase(),
        Name: `${rarity}Boss${set}`,
        damageDealt: 1_000_000 + p * 100_000 + battle * 1_000,
        damageType: 'Battle' as const,
        remainingHp: 5_000_000,
        maxHp: 20_000_000,
        tier: rarity === 'Legendary' ? 4 : 5,
        set,
        loopIndex,
        encounterId: 0,
        encounterIndex: 0,
        rarity,
        startedOn: new Date(
          Date.UTC(2026, 7, 11, 10, loopIndex * 10 + battle)
        ).toISOString(),
        completedOn: new Date(
          Date.UTC(2026, 7, 11, 10, loopIndex * 10 + battle, 30)
        ).toISOString()
      }))
    )
  )

const LADDER: Array<['Legendary' | 'Mythic', number]> = [
  ['Legendary', 0],
  ['Legendary', 1],
  ['Legendary', 2],
  ['Legendary', 3],
  ['Legendary', 4],
  ['Mythic', 0],
  ['Mythic', 1],
  ['Mythic', 2]
]

// `loopsFrom` = LADDER index where the raid restarts.
const season = (loopsFrom: number): BattleEntry[] =>
  LADDER.flatMap(([rarity, set], i) =>
    bossRows(rarity, set, i < loopsFrom ? [0] : [0, 1])
  )

const levels = (data: BattleEntry[]): string[] =>
  calculateSetWinners(data, new Set<string>())
    .filter((s) => s.gold)
    .map((s) => s.levelString)

const allRows = (data: BattleEntry[]): string[] =>
  calculateSetWinners(data, new Set<string>()).map((s) => s.levelString)

describe('VOTLW set winners — only looping bosses award (WI-6590)', () => {
  it('drops L1-L3 when the season restarts its loop at L4', () => {
    expect(levels(season(3))).toEqual(['L4', 'L5', 'M1', 'M2', 'M3'])
  })

  it('emits no row at all for a single-pass boss', () => {
    expect(allRows(season(3))).not.toContain('L1')
    expect(allRows(season(3))).not.toContain('L3')
  })

  it('keeps every set when the season loops the full ladder', () => {
    expect(levels(season(0))).toEqual([
      'L1',
      'L2',
      'L3',
      'L4',
      'L5',
      'M1',
      'M2',
      'M3'
    ])
  })

  it('excludes nothing before the guild reaches loop 1', () => {
    // No loopIndex >= 1 row: no evidence any boss is single-pass.
    const firstPassOnly = LADDER.flatMap(([rarity, set]) =>
      bossRows(rarity, set, [0])
    )
    expect(levels(firstPassOnly)).toHaveLength(LADDER.length)
    expect(levels(firstPassOnly)).toContain('L1')
  })

  it('excludes Legendary entirely if the loop restarts at M1', () => {
    expect(levels(season(5))).toEqual(['M1', 'M2', 'M3'])
  })

  it('pays no points for a single-pass boss', async () => {
    const results = await calculateVOTLWPoints(
      season(3),
      [],
      new Set<string>(),
      [],
      'EOT',
      '107'
    )

    const breakdown = results.playerPoints.flatMap((p) => p.breakdown)
    expect(breakdown.length).toBeGreaterThan(0)
    expect(breakdown.filter((line) => /^L[123] /.test(line))).toEqual([])
    expect(breakdown.some((line) => line.startsWith('L4 '))).toBe(true)
  })

  it('still pays points for L1-L3 in a full-loop season', async () => {
    const results = await calculateVOTLWPoints(
      season(0),
      [],
      new Set<string>(),
      [],
      'EOT',
      '106'
    )

    const breakdown = results.playerPoints.flatMap((p) => p.breakdown)
    expect(breakdown.some((line) => line.startsWith('L1 '))).toBe(true)
  })
})
