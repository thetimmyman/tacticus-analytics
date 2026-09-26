import { describe, it, expect } from 'vitest'
import {
  getTopK,
  binarySearch,
  findWithPrefix,
  groupBy,
  uniqueBy,
  ArrayOptimizer
} from '@tacticus/app-core/array-optimizations'

describe('Array optimizations', () => {
  describe('getTopK', () => {
    const asc = (a: number, b: number) => a - b

    it('returns empty array for non-positive k', () => {
      expect(getTopK([3, 1, 2], 0, asc)).toEqual([])
      expect(getTopK([3, 1, 2], -1, asc)).toEqual([])
    })

    it('returns sorted copy when k >= length', () => {
      const input = [3, 1, 2]
      const result = getTopK(input, 10, asc)
      expect(result).toEqual([1, 2, 3])
      expect(input).toEqual([3, 1, 2])
    })

    it('returns top-k values using partial sort', () => {
      const result = getTopK([5, 1, 3, 2, 4], 3, asc)
      expect(result).toEqual([1, 2, 3])
    })

    it('skips undefined values in the tail', () => {
      const result = getTopK([4, 1, 3, undefined, 2], 2, asc)
      expect(result).toEqual([1, 2])
    })
  })

  describe('binarySearch', () => {
    const asc = (a: number, b: number) => a - b

    it('returns index for matching value', () => {
      expect(binarySearch([1, 3, 5, 7], 5, asc)).toBe(2)
    })

    it('returns -1 when value is missing', () => {
      expect(binarySearch([1, 3, 5, 7], 2, asc)).toBe(-1)
    })
  })

  describe('findWithPrefix', () => {
    const items = [
      { name: 'Alpha' },
      { name: 'Alpine' },
      { name: 'Beta' },
      { name: 'Gamma' }
    ]

    it('finds prefix matches case-insensitively', () => {
      const results = findWithPrefix(items, 'al', (item) => item.name, 10)
      expect(results).toEqual([{ name: 'Alpha' }, { name: 'Alpine' }])
    })

    it('respects max results and stops at prefix boundary', () => {
      const results = findWithPrefix(items, 'a', (item) => item.name, 1)
      expect(results).toEqual([{ name: 'Alpha' }])
    })

    it('returns empty array when no match exists', () => {
      const results = findWithPrefix(items, 'zz', (item) => item.name, 5)
      expect(results).toEqual([])
    })
  })

  describe('groupBy', () => {
    it('groups items by key', () => {
      const grouped = groupBy(
        [
          { type: 'a', value: 1 },
          { type: 'b', value: 2 },
          { type: 'a', value: 3 }
        ],
        (item) => item.type
      )
      expect(grouped.a).toHaveLength(2)
      expect(grouped.b).toHaveLength(1)
    })
  })

  describe('uniqueBy', () => {
    it('deduplicates by key while preserving order', () => {
      const result = uniqueBy(
        [
          { id: 1, name: 'Alpha' },
          { id: 2, name: 'Beta' },
          { id: 1, name: 'Alpha Duplicate' }
        ],
        (item) => item.id
      )
      expect(result).toEqual([
        { id: 1, name: 'Alpha' },
        { id: 2, name: 'Beta' }
      ])
    })
  })

  describe('ArrayOptimizer.searchPlayers', () => {
    const players = [
      { display_name: 'Alice' },
      { display_name: 'Alfred' },
      { display_name: 'Vallix' },
      { name: 'Caleb' },
      { display_name: 'Zed' }
    ]

    it('returns limited list when query is empty', () => {
      const result = ArrayOptimizer.searchPlayers(players, ' ', 2)
      expect(result).toEqual([players[0], players[1]])
    })

    it('prioritizes prefix matches before contains matches', () => {
      const result = ArrayOptimizer.searchPlayers(players, 'al', 5)
      expect(result.slice(0, 2)).toEqual([players[0], players[1]])
      expect(result).toContain(players[2])
      expect(result).toContain(players[3])
    })

    it('deduplicates combined results', () => {
      const duplicatePlayers = [
        { display_name: 'Alpha' },
        { display_name: 'Alpha' },
        { name: 'Alpha' }
      ]
      const result = ArrayOptimizer.searchPlayers(duplicatePlayers, 'al', 10)
      expect(result).toHaveLength(1)
    })
  })
})
