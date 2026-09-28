import { describe, it, expect } from 'vitest'
import {
  assertDiffInvariants,
  classifyRawDiscriminators,
  DiffInvariantViolation,
  diffRaidRows,
  finalDayUtc,
  isOnUtcDay,
  raidRowKeyString,
  toRaidRowKey,
  type RaidRowKey,
  type TokenDiffResult
} from '@/app/lib/diagnostics/raid-token-diff'

const row = (over: Partial<RaidRowKey> = {}): RaidRowKey => ({
  Guild: 'G1',
  Season: '107',
  userId: 'user-a',
  encounterId: 3,
  startedOn: '2026-08-25T10:00:00.000Z',
  completedOn: '2026-08-25T10:00:30.000Z',
  damageDealt: 1_000_000,
  damageType: 'Battle',
  ...over
})

describe('raid token diff core', () => {
  it('reports nothing when every upstream row landed', () => {
    const rows = [row(), row({ userId: 'user-b' })]
    const result = diffRaidRows(
      rows,
      rows.map((r) => ({ ...r }))
    )

    expect(result.upstreamRowCount).toBe(2)
    expect(result.landedRowCount).toBe(2)
    expect(result.unmatchedUpstreamRows).toEqual([])
    expect(result.upstreamDuplicateKeyGroups).toEqual([])
  })

  it('reports an upstream row that is simply absent downstream', () => {
    const kept = row()
    const missing = row({ userId: 'user-b' })

    const result = diffRaidRows([kept, missing], [kept])

    expect(result.unmatchedUpstreamRows).toEqual([missing])
    expect(result.upstreamDuplicateKeyGroups).toEqual([])
  })

  it('THE CASE THAT MATTERS: two upstream rows sharing one 8-tuple against one landed row report one unmatched row', () => {
    // Battles differing only in index-excluded columns; a set-based diff would call this clean.
    const a = row({ damageType: 'Battle' })
    const b = row({ damageType: 'Battle' })

    const result = diffRaidRows([a, b], [a])

    expect(result.upstreamRowCount).toBe(2)
    expect(result.landedRowCount).toBe(1)
    expect(result.unmatchedUpstreamRows).toHaveLength(1)
    expect(result.unmatchedUpstreamRows[0]).toEqual(b)
    expect(result.upstreamDuplicateKeyGroups).toEqual([
      { key: a, upstreamCount: 2, landedCount: 1 }
    ])
  })

  it('does not collapse a triple: 3 upstream vs 1 landed reports 2 unmatched', () => {
    const a = row()
    const result = diffRaidRows([a, { ...a }, { ...a }], [a])

    expect(result.unmatchedUpstreamRows).toHaveLength(2)
    expect(result.upstreamDuplicateKeyGroups[0]).toMatchObject({
      upstreamCount: 3,
      landedCount: 1
    })
  })

  it('a duplicate that landed twice is fully matched but still surfaced as a duplicate group', () => {
    const a = row()
    const result = diffRaidRows([a, { ...a }], [a, { ...a }])

    expect(result.unmatchedUpstreamRows).toEqual([])
    expect(result.upstreamDuplicateKeyGroups[0]).toMatchObject({
      upstreamCount: 2,
      landedCount: 2
    })
  })

  it('landed rows that are not upstream do not mask an unmatched upstream row', () => {
    const a = row()
    const b = row({ userId: 'user-b' })
    const stray = row({ userId: 'user-z' })

    const result = diffRaidRows([a, b], [a, stray])

    expect(result.unmatchedUpstreamRows).toEqual([b])
    expect(result.landedRowCount).toBe(2)
  })

  it('distinguishes rows that differ in exactly one key column', () => {
    const base = row()
    const columns: Array<Partial<RaidRowKey>> = [
      { Guild: 'G2' },
      { Season: '106' },
      { userId: 'user-b' },
      { encounterId: 4 },
      { startedOn: '2026-08-25T10:00:01.000Z' },
      { completedOn: '2026-08-25T10:00:31.000Z' },
      { damageDealt: 1_000_001 },
      { damageType: 'Bomb' }
    ]

    for (const over of columns) {
      const other = row(over)
      expect(raidRowKeyString(other)).not.toBe(raidRowKeyString(base))
      expect(diffRaidRows([other], [base]).unmatchedUpstreamRows).toEqual([
        other
      ])
    }
  })

  it('cannot be fooled by a value that contains the delimiter', () => {
    const a = row({ userId: 'a', Guild: 'G1' })
    const b = row({ userId: '', Guild: 'G1","a' })

    expect(raidRowKeyString(a)).not.toBe(raidRowKeyString(b))
  })

  it('toRaidRowKey keeps only the eight key columns', () => {
    const key = toRaidRowKey({
      Guild: 'G1',
      Season: '107',
      userId: 'user-a',
      encounterId: 3,
      startedOn: '2026-08-25T10:00:00.000Z',
      completedOn: '2026-08-25T10:00:30.000Z',
      damageDealt: 5,
      damageType: 'Battle',
      displayName: 'Some Player',
      Name: 'Szarekh',
      tier: 4,
      set: 2,
      loopIndex: 1
    } as Record<string, unknown>)

    expect(Object.keys(key).sort()).toEqual([
      'Guild',
      'Season',
      'completedOn',
      'damageDealt',
      'damageType',
      'encounterId',
      'startedOn',
      'userId'
    ])
  })

  it('a PostgREST-shaped row (+00:00) and a transform-shaped row (.000Z) for the same instant key alike', () => {
    // PostgREST returns `+00:00` but the writer `Z`, so raw string keys would mis-report landed rows.
    const upstream = toRaidRowKey({
      Guild: 'G1',
      Season: '107',
      userId: 'user-a',
      encounterId: 3,
      startedOn: '2026-08-25T00:09:09.000Z',
      completedOn: '2026-08-25T00:09:39.000Z',
      damageDealt: 1000,
      damageType: 'Battle'
    })
    const landed = toRaidRowKey({
      Guild: 'G1',
      Season: '107',
      userId: 'user-a',
      encounterId: 3,
      startedOn: '2026-08-25T00:09:09+00:00',
      completedOn: '2026-08-25T00:09:39+00:00',
      damageDealt: 1000,
      damageType: 'Battle'
    })

    expect(raidRowKeyString(upstream)).toBe(raidRowKeyString(landed))

    const result = diffRaidRows([upstream], [landed])
    expect(result.unmatchedUpstreamRows).toEqual([])
  })

  it('null startedOn/completedOn on both sides key alike', () => {
    const upstream = toRaidRowKey({
      Guild: 'G1',
      Season: '107',
      userId: 'user-a',
      encounterId: 3,
      startedOn: null,
      completedOn: null,
      damageDealt: 1000,
      damageType: 'Battle'
    })
    const landed = toRaidRowKey({
      Guild: 'G1',
      Season: '107',
      userId: 'user-a',
      encounterId: 3,
      startedOn: null,
      completedOn: null,
      damageDealt: 1000,
      damageType: 'Battle'
    })

    expect(raidRowKeyString(upstream)).toBe(raidRowKeyString(landed))
  })

  it('two different unparseable timestamps do not silently key alike, and neither collides with a valid instant', () => {
    const junkA = toRaidRowKey({ startedOn: 'not-a-date' })
    const junkB = toRaidRowKey({ startedOn: 'also-not-a-date' })
    const valid = toRaidRowKey({ startedOn: '2026-08-25T00:09:09.000Z' })
    const nullish = toRaidRowKey({ startedOn: null })

    const keys = new Set([
      junkA.startedOn,
      junkB.startedOn,
      valid.startedOn,
      nullish.startedOn
    ])
    expect(keys.size).toBe(4)
  })

  describe('assertDiffInvariants', () => {
    const okResult = (): TokenDiffResult => ({
      upstreamRowCount: 2,
      landedRowCount: 2,
      unmatchedUpstreamRows: [],
      upstreamDuplicateKeyGroups: []
    })

    it('passes on a normal, arithmetically sane result', () => {
      expect(() => assertDiffInvariants(okResult())).not.toThrow()
    })

    it('raises when unmatchedUpstreamRows.length exceeds upstreamRowCount', () => {
      const impossible: TokenDiffResult = {
        ...okResult(),
        upstreamRowCount: 1,
        unmatchedUpstreamRows: [row(), row({ userId: 'user-b' })]
      }

      expect(() => assertDiffInvariants(impossible)).toThrow(
        DiffInvariantViolation
      )
      expect(() => assertDiffInvariants(impossible)).toThrow(
        /exceeds upstreamRowCount/
      )
    })

    it('raises on the all-unmatched-with-rows-landed signature (a matching bug, not a clean 200)', () => {
      // All upstream unmatched with landedRowCount > 0 is a matching bug, not a clean 200.
      const ticketSignature: TokenDiffResult = {
        upstreamRowCount: 3,
        landedRowCount: 5,
        unmatchedUpstreamRows: [
          row(),
          row({ userId: 'user-b' }),
          row({ userId: 'user-c' })
        ],
        upstreamDuplicateKeyGroups: []
      }

      expect(() => assertDiffInvariants(ticketSignature)).toThrow(
        DiffInvariantViolation
      )
      expect(() => assertDiffInvariants(ticketSignature)).toThrow(
        /every upstream row reported unmatched/
      )
    })

    it('does not raise when unmatched equals upstream but nothing landed at all', () => {
      const emptyLanded: TokenDiffResult = {
        upstreamRowCount: 2,
        landedRowCount: 0,
        unmatchedUpstreamRows: [row(), row({ userId: 'user-b' })],
        upstreamDuplicateKeyGroups: []
      }

      expect(() => assertDiffInvariants(emptyLanded)).not.toThrow()
    })
  })

  it('finalDayUtc picks the latest completedOn day and isOnUtcDay filters to it', () => {
    const early = row({ completedOn: '2026-08-24T23:00:00.000Z' })
    const late = row({ completedOn: '2026-08-25T09:00:00.000Z' })

    const day = finalDayUtc([early, late])
    expect(day).toBe('2026-08-25')
    expect(isOnUtcDay(late, day!)).toBe(true)
    expect(isOnUtcDay(early, day!)).toBe(false)
    expect(finalDayUtc([])).toBeNull()
  })
})

describe('classifyRawDiscriminators', () => {
  it('classifies the drop-path-1 shape: encounterIndex > 0 with a falsy/missing type', () => {
    const missingType = classifyRawDiscriminators({
      userId: 'user-a',
      encounterIndex: 2
    })
    expect(missingType.rawType).toBe('absent')
    expect(missingType.rawEncounterIndex).toEqual({ kind: 'valid', value: 2 })
    expect(missingType.rawUserIdEmpty).toBe(false)

    const falsyType = classifyRawDiscriminators({
      userId: 'user-a',
      type: '',
      encounterIndex: 1
    })
    expect(falsyType.rawType).toBe('falsy')
    expect(falsyType.rawEncounterIndex).toEqual({ kind: 'valid', value: 1 })
  })

  it('classifies a well-formed entry as well-formed', () => {
    const wellFormed = classifyRawDiscriminators({
      userId: 'user-a',
      type: 'Szarekh',
      encounterIndex: 3
    })
    expect(wellFormed).toEqual({
      rawType: 'present',
      rawEncounterIndex: { kind: 'valid', value: 3 },
      rawUserIdEmpty: false
    })
  })

  it('distinguishes absent, null and unparseable encounterIndex', () => {
    expect(
      classifyRawDiscriminators({ userId: 'u', type: 't' }).rawEncounterIndex
    ).toEqual({ kind: 'absent' })
    expect(
      classifyRawDiscriminators({
        userId: 'u',
        type: 't',
        encounterIndex: null
      }).rawEncounterIndex
    ).toEqual({ kind: 'null' })
    expect(
      classifyRawDiscriminators({
        userId: 'u',
        type: 't',
        encounterIndex: 'not-a-number'
      }).rawEncounterIndex
    ).toEqual({ kind: 'unparseable' })
  })

  it('flags an empty or non-string userId', () => {
    expect(classifyRawDiscriminators({ userId: '' }).rawUserIdEmpty).toBe(true)
    expect(classifyRawDiscriminators({ userId: '   ' }).rawUserIdEmpty).toBe(
      true
    )
    expect(classifyRawDiscriminators({}).rawUserIdEmpty).toBe(true)
    expect(classifyRawDiscriminators({ userId: 42 }).rawUserIdEmpty).toBe(true)
  })
})
