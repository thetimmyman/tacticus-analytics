import { describe, it, expect } from 'vitest'
import { generateSeasons } from '@/app/lib/player-stats/generate-seasons'

describe('generateSeasons', () => {
  it('generates 10 seasons going back from current season', () => {
    const result = generateSeasons('25')
    expect(result).toEqual([
      '25',
      '24',
      '23',
      '22',
      '21',
      '20',
      '19',
      '18',
      '17',
      '16'
    ])
  })

  it('stops at season 1 (never goes below)', () => {
    const result = generateSeasons('3')
    expect(result).toEqual(['3', '2', '1'])
  })

  it('returns single season for season "1"', () => {
    const result = generateSeasons('1')
    expect(result).toEqual(['1'])
  })

  it('returns empty for season "0"', () => {
    const result = generateSeasons('0')
    expect(result).toEqual([])
  })

  it('returns empty for NaN input', () => {
    const result = generateSeasons('abc')
    expect(result).toEqual([])
  })

  it('supports custom count parameter', () => {
    const result = generateSeasons('25', 3)
    expect(result).toEqual(['25', '24', '23'])
  })

  it('returns string values (not numbers)', () => {
    const result = generateSeasons('5', 2)
    result.forEach((s) => expect(typeof s).toBe('string'))
  })
})
