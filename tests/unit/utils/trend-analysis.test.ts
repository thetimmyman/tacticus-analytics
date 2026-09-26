import { describe, it, expect } from 'vitest'
import {
  generateTrendlineData,
  interpolateTrendValue,
  calculateLinearRegression,
  formatTrendPerSeason,
  seasonNumberX
} from '@/app/lib/utils/trend-analysis'

const identity = (v: number | null) => v

const renderTrendline = (
  data: Array<number | null>,
  trend: { startY: number; endY: number } | null
) => data.map((_, i) => interpolateTrendValue(trend, i, data.length))

describe('generateTrendlineData', () => {
  it('no filtering: endpoints are the regression values at the first and last index', () => {
    const trend = generateTrendlineData([10, 20, 30], identity)
    expect(trend).not.toBeNull()
    expect(trend!.startY).toBeCloseTo(10) // intercept (regression at index 0)
    expect(trend!.endY).toBeCloseTo(30) // regression at index 2
  })

  it('REGRESSION: a LEADING null no longer drags endY below the data', () => {
    const data = [null, null, 10, 20, 30]
    const trend = generateTrendlineData(data, identity)
    expect(trend).not.toBeNull()
    expect(trend!.startY).toBeCloseTo(-10)
    // endY uses data.length - 1, not validData.length - 1.
    expect(trend!.endY).toBeCloseTo(30)
  })

  it('REGRESSION: rendered overlay tracks the data exactly at surviving indices (leading null)', () => {
    const data = [null, null, 10, 20, 30]
    const trend = generateTrendlineData(data, identity)
    const rendered = renderTrendline(data, trend)
    expect(rendered[2]).toBeCloseTo(10)
    expect(rendered[3]).toBeCloseTo(20)
    expect(rendered[4]).toBeCloseTo(30)
  })

  it('REGRESSION: a TRAILING null keeps the overlay on the regression line through the data', () => {
    const data = [10, 20, 30, null, null]
    const trend = generateTrendlineData(data, identity)
    expect(trend!.startY).toBeCloseTo(10)
    expect(trend!.endY).toBeCloseTo(50)
    const rendered = renderTrendline(data, trend)
    expect(rendered[0]).toBeCloseTo(10)
    expect(rendered[1]).toBeCloseTo(20)
    expect(rendered[2]).toBeCloseTo(30)
  })

  it('interior null: overlay still coincides with the regression line at the kept points', () => {
    const data = [10, null, 30, 40] // indices 0,2,3 survive; linear y = 10*x + 10
    const trend = generateTrendlineData(data, identity)
    const rendered = renderTrendline(data, trend)
    expect(rendered[0]).toBeCloseTo(10)
    expect(rendered[2]).toBeCloseTo(30)
    expect(rendered[3]).toBeCloseTo(40)
  })

  it('returns null when fewer than 2 points survive the filter', () => {
    expect(generateTrendlineData([null, 5, null], identity)).toBeNull()
    expect(generateTrendlineData([], identity)).toBeNull()
  })

  it('endY matches the regression evaluated at data.length - 1 (general property)', () => {
    const data = [null, 4, null, 9, 12, null]
    const trend = generateTrendlineData(data, identity)!
    const validData = data
      .map((y, x) => ({ x, y }))
      .filter((d): d is { x: number; y: number } => d.y != null)
    const { slope, intercept } = calculateLinearRegression(validData)
    expect(trend.endY).toBeCloseTo(slope * (data.length - 1) + intercept)
  })

  it('returns the regression slope (per-season trend) alongside the endpoints', () => {
    const trend = generateTrendlineData([10, 20, 30], identity)!
    expect(trend.slope).toBeCloseTo(10)
    const declining = generateTrendlineData([30, 20, 10], identity)!
    expect(declining.slope).toBeCloseTo(-10)
  })

  it('slope stays defined for zero-crossing series where CAGR is N/A (vs-guild/vs-cluster case)', () => {
    const trend = generateTrendlineData([-13, -5, 0, 8, 12], identity)!
    expect(trend.cagr).toBeNull() // CAGR undefined for non-positive endpoints
    expect(trend.slope).toBeCloseTo(6.3) // regression slope: overall trend
  })

  it('slope stays defined when a value is 0 (reliability score case)', () => {
    const trend = generateTrendlineData([0, 50, 80], identity)!
    expect(trend.cagr).toBeNull()
    expect(trend.slope).toBeCloseTo(40)
  })

  it('REGRESSION: CAGR periods use the season span, not the surviving-point count', () => {
    const trend = generateTrendlineData([10, null, 40], identity)!
    expect(trend.cagr).toBeCloseTo(100)
  })

  it('REGRESSION: getX makes the slope per-SEASON when seasons are missing from the array (codex P2, #430)', () => {
    const rows = [
      { season: 'S10', value: 0 },
      { season: 'S12', value: 20 }
    ]
    const trend = generateTrendlineData(rows, (r) => r.value, seasonNumberX)!
    expect(trend.slope).toBeCloseTo(10)
    expect(trend.startY).toBeCloseTo(0)
    expect(trend.endY).toBeCloseTo(20)
  })

  it('getX also fixes CAGR periods across season gaps', () => {
    const rows = [
      { season: '10', value: 10 },
      { season: '12', value: 40 }
    ]
    const trend = generateTrendlineData(rows, (r) => r.value, seasonNumberX)!
    expect(trend.cagr).toBeCloseTo(100)
  })

  it('getX falls back to the index for unparsable rows', () => {
    const rows = [
      { season: '???', value: 10 },
      { season: '???', value: 20 },
      { season: '???', value: 30 }
    ]
    const trend = generateTrendlineData(rows, (r) => r.value, seasonNumberX)!
    expect(trend.slope).toBeCloseTo(10)
  })
})

describe('seasonNumberX', () => {
  it('parses bare and S-prefixed season labels', () => {
    expect(seasonNumberX({ season: '104' })).toBe(104)
    expect(seasonNumberX({ season: 'S104' })).toBe(104)
    expect(seasonNumberX({ season: 's99' })).toBe(99)
  })

  it('returns null for unparsable labels', () => {
    expect(seasonNumberX({ season: 'preseason' })).toBeNull()
    expect(seasonNumberX({ season: '' })).toBeNull()
  })
})

describe('formatTrendPerSeason', () => {
  it('formats positive and negative slopes compactly with sign and unit', () => {
    expect(formatTrendPerSeason(0.42, '%')).toBe('+0.4%')
    expect(formatTrendPerSeason(-0.87, '%')).toBe('-0.9%')
    expect(formatTrendPerSeason(-4.83)).toBe('-4.8')
    expect(formatTrendPerSeason(0)).toBe('+0.0')
  })

  it('returns N/A for null/undefined/non-finite slopes', () => {
    expect(formatTrendPerSeason(null)).toBe('N/A')
    expect(formatTrendPerSeason(undefined)).toBe('N/A')
    expect(formatTrendPerSeason(Number.NaN)).toBe('N/A')
  })
})
