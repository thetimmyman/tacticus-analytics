import { describe, it, expect } from 'vitest'
import {
  castRpcResult,
  castQueryResult,
  castSingleResult
} from '@tacticus/app-core/database-extensions'

describe('database-extensions helpers', () => {
  describe('castRpcResult', () => {
    it('returns null for null or undefined input', () => {
      expect(castRpcResult(null)).toBeNull()
      expect(castRpcResult(undefined)).toBeNull()
    })

    it('returns falsy non-null values intact', () => {
      expect(castRpcResult(0)).toBe(0)
      expect(castRpcResult('')).toBe('')
      expect(castRpcResult(false)).toBe(false)
    })

    it('returns object values intact', () => {
      const payload = { ok: true, count: 2 }
      expect(castRpcResult(payload)).toBe(payload)
    })
  })

  describe('castQueryResult', () => {
    it('returns empty array when input is not an array', () => {
      expect(castQueryResult(null)).toEqual([])
      expect(castQueryResult(undefined)).toEqual([])
      expect(castQueryResult({})).toEqual([])
      expect(castQueryResult('not-array')).toEqual([])
    })

    it('returns array values intact', () => {
      const rows = [{ id: 1 }, { id: 2 }]
      const result = castQueryResult(rows)
      expect(result).toBe(rows)
      expect(result).toEqual(rows)
    })
  })

  describe('castSingleResult', () => {
    it('returns null for null or undefined input', () => {
      expect(castSingleResult(null)).toBeNull()
      expect(castSingleResult(undefined)).toBeNull()
    })

    it('returns falsy non-null values intact', () => {
      expect(castSingleResult(0)).toBe(0)
      expect(castSingleResult('')).toBe('')
      expect(castSingleResult(false)).toBe(false)
    })

    it('returns object values intact', () => {
      const record = { id: 7, label: 'row' }
      expect(castSingleResult(record)).toBe(record)
    })
  })
})
