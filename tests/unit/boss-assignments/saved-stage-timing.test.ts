import { describe, expect, it } from 'vitest'
import { buildSavedStageKillDurationMedians } from '@/app/lib/boss-assignments/saved-stage-timing'

const AS_OF = '2026-06-02T08:00:00.000Z'

function attempts(
  season: string,
  date: string,
  hours: number[],
  set = 0,
  loopIndex = 0
) {
  return hours.map((hour) => ({
    Season: season,
    damageType: 'Battle' as const,
    rarity: 'Legendary',
    set,
    loopIndex,
    startedOn: `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`
  }))
}

describe('saved stage timing at an explicit as-of instant', () => {
  it('uses the completed current occurrence median ahead of rolling history', () => {
    const medians = buildSavedStageKillDurationMedians({
      season: '101',
      asOf: AS_OF,
      rows: [
        ...attempts('99', '2026-05-30', [0, 4, 8]),
        ...attempts('100', '2026-05-31', [0, 2, 4]),
        ...attempts('101', '2026-06-01', [0, 1, 2]),
        ...attempts('101', '2026-06-01', [3], 1)
      ]
    })
    expect([...medians.values()]).toEqual([
      {
        stageCode: 'L1',
        loopIndex: 0,
        medianSeconds: 7200,
        sampleCount: 1,
        source: 'current_season'
      }
    ])
  })

  it('uses the continuous rolling median and keeps loop occurrences separate', () => {
    const medians = buildSavedStageKillDurationMedians({
      season: '101',
      asOf: AS_OF,
      rows: [
        ...attempts('99', '2026-05-30', [0, 4, 8]),
        ...attempts('100', '2026-05-31', [0, 2, 4]),
        ...attempts('100', '2026-05-31', [0, 1, 2], 0, 1)
      ]
    })
    expect(medians.get('L1|0')).toEqual({
      stageCode: 'L1',
      loopIndex: 0,
      medianSeconds: 21600,
      sampleCount: 2,
      source: 'rolling_window'
    })
    expect(medians.get('L1|1')).toEqual({
      stageCode: 'L1',
      loopIndex: 1,
      medianSeconds: 7200,
      sampleCount: 1,
      source: 'rolling_window'
    })
  })

  it('excludes the current in-progress occurrence, insufficient attempts and zero spans', () => {
    const medians = buildSavedStageKillDurationMedians({
      season: '101',
      asOf: AS_OF,
      rows: [
        ...attempts('101', '2026-06-01', [0, 1, 2]),
        ...attempts('100', '2026-05-31', [0, 1], 1),
        ...attempts('100', '2026-05-31', [3, 3, 3], 2)
      ]
    })
    expect([...medians]).toEqual([])
  })

  it('uses only events through as-of and earlier seasons within the inclusive sixty-day window', () => {
    const cutoff = '2026-04-03T08:00:00.000Z'
    const row = attempts('100', '2026-04-03', [8])[0]
    const medians = buildSavedStageKillDurationMedians({
      season: '101',
      asOf: AS_OF,
      rows: [
        { ...row, startedOn: cutoff },
        { ...row, startedOn: '2026-04-03T09:00:00.000Z' },
        { ...row, startedOn: '2026-04-03T10:00:00.000Z' },
        ...attempts('99', '2026-04-03', [5, 6, 7]),
        ...attempts('102', '2026-06-01', [0, 1, 2]),
        ...attempts('101', '2026-06-02', [6, 7, 8]),
        ...attempts('101', '2026-06-02', [9], 1)
      ]
    })
    expect(medians.get('L1|0')).toEqual({
      stageCode: 'L1',
      loopIndex: 0,
      medianSeconds: 7200,
      sampleCount: 1,
      source: 'rolling_window'
    })
    expect(medians.size).toBe(1)
  })

  it('accepts canonical Mythic stages and database offset timestamps', () => {
    const rows = attempts('100', '2026-05-31', [0, 1, 2], 4).map((row) => ({
      ...row,
      rarity: 'mythic',
      startedOn: row.startedOn.replace('.000Z', '.000000+00:00')
    }))
    expect(
      buildSavedStageKillDurationMedians({
        season: '101',
        asOf: AS_OF,
        rows
      }).get('M5|0')
    ).toEqual({
      stageCode: 'M5',
      loopIndex: 0,
      medianSeconds: 7200,
      sampleCount: 1,
      source: 'rolling_window'
    })
  })

  it.each([
    ['nonnumeric season', { Season: 'legacy-not-a-season' }],
    ['missing season', { Season: null }],
    ['long season', { Season: '1'.repeat(129) }],
    ['Bomb instead of Battle', { damageType: 'Bomb' }],
    ['unknown rarity', { rarity: 'Unknown' }],
    ['untrimmed rarity', { rarity: ' Mythic' }],
    ['unknown set', { set: 5 }],
    ['negative set', { set: -1 }],
    ['fractional set', { set: 0.5 }],
    ['missing set', { set: null }],
    ['negative loop', { loopIndex: -1 }],
    ['fractional loop', { loopIndex: 0.5 }],
    ['nonfinite loop', { loopIndex: Infinity }],
    ['missing timestamp', { startedOn: null }],
    ['invalid timestamp', { startedOn: 'invalid' }],
    ['calendar rollover', { startedOn: '2026-02-30T10:00:00Z' }],
    ['hour rollover', { startedOn: '2026-05-31T24:00:00Z' }],
    ['long timestamp', { startedOn: '2'.repeat(65) }]
  ])('refuses malformed stage timing history: %s', (_label, update) => {
    const rows = [{ ...attempts('100', '2026-05-31', [0])[0], ...update }]
    expect(() =>
      buildSavedStageKillDurationMedians({
        season: '101',
        asOf: AS_OF,
        rows: rows as unknown as Parameters<
          typeof buildSavedStageKillDurationMedians
        >[0]['rows']
      })
    ).toThrow('Invalid saved stage timing inputs')
  })

  it.each(['', '0', '0101', '101x', '1000000'])(
    'refuses invalid selected season %s',
    (season) => {
      expect(() =>
        buildSavedStageKillDurationMedians({ season, asOf: AS_OF, rows: [] })
      ).toThrow('Invalid saved stage timing inputs')
    }
  )

  it.each(['invalid', '2026-02-30T08:00:00Z', '2026-06-02T08:00:00+00:00'])(
    'requires a real explicit UTC as-of instant %s',
    (asOf) => {
      expect(() =>
        buildSavedStageKillDurationMedians({ season: '101', asOf, rows: [] })
      ).toThrow('Invalid saved stage timing inputs')
    }
  )

  it('bounds all history before grouping and leaves the input untouched', () => {
    const row = attempts('100', '2026-05-31', [0])[0]
    expect(() =>
      buildSavedStageKillDurationMedians({
        season: '101',
        asOf: AS_OF,
        rows: Array.from({ length: 10001 }, () => row)
      })
    ).toThrow('Invalid saved stage timing inputs')
    const rows = attempts('100', '2026-05-31', [2, 0, 1])
    const before = structuredClone(rows)
    expect(
      buildSavedStageKillDurationMedians({
        season: '101',
        asOf: AS_OF,
        rows
      }).get('L1|0')?.medianSeconds
    ).toBe(7200)
    expect(rows).toEqual(before)
    expect(
      buildSavedStageKillDurationMedians({
        season: '101',
        asOf: AS_OF,
        rows: Array.from({ length: 10000 }, () => row)
      }).size
    ).toBe(0)
  })

  it('refuses missing runtime arrays and malformed objects with a fixed error', () => {
    for (const args of [
      null,
      {},
      { season: '101', asOf: AS_OF, rows: null },
      { season: '101', asOf: AS_OF, rows: [null] }
    ]) {
      expect(() =>
        buildSavedStageKillDurationMedians(
          args as unknown as Parameters<
            typeof buildSavedStageKillDurationMedians
          >[0]
        )
      ).toThrow('Invalid saved stage timing inputs')
    }
  })

  it('refuses sub-millisecond history instead of rounding a duration median', () => {
    const rows = attempts('100', '2026-05-31', [0, 1, 2])
    rows[1] = { ...rows[1], startedOn: '2026-05-31T01:00:00.000001Z' }
    expect(() =>
      buildSavedStageKillDurationMedians({ season: '101', asOf: AS_OF, rows })
    ).toThrow('Invalid saved stage timing inputs')
  })
})
