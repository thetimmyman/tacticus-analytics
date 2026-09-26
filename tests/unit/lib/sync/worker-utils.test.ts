import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/errors/AppError', () => ({
  Errors: {
    fromResponse: vi.fn((status: number, body: object) =>
      Object.assign(new Error('AppError'), {
        statusCode: status,
        body,
        isAppError: true
      })
    )
  }
}))

import {
  parseSyncJob,
  isSyncJobType,
  toIntegerOrNull,
  cleanNullString,
  resolveEntryTimestampOrNull,
  resolveSeasonNumber,
  callRpc
} from '@/app/lib/sync/worker-utils'

describe('worker-utils', () => {
  describe('parseSyncJob', () => {
    it('returns a valid SyncJob for complete data', () => {
      const result = parseSyncJob({
        id: 'job-1',
        guild_code: 'GUILD01',
        job_type: 'full_sync',
        payload: { key: 'val' }
      })
      expect(result).toEqual({
        id: 'job-1',
        guild_code: 'GUILD01',
        job_type: 'full_sync',
        payload: { key: 'val' }
      })
    })

    it('returns null for null input', () => {
      expect(parseSyncJob(null)).toBeNull()
    })

    it('returns null when id is missing', () => {
      expect(
        parseSyncJob({ id: null, guild_code: 'G', job_type: 'full_sync' })
      ).toBeNull()
    })

    it('returns null when guild_code is missing', () => {
      expect(
        parseSyncJob({ id: '1', guild_code: null, job_type: 'full_sync' })
      ).toBeNull()
    })

    it('returns null for invalid job type', () => {
      expect(
        parseSyncJob({ id: '1', guild_code: 'G', job_type: 'bad_type' })
      ).toBeNull()
    })

    it('defaults payload to null when undefined', () => {
      const result = parseSyncJob({
        id: '1',
        guild_code: 'G',
        job_type: 'player_sync'
      })
      expect(result?.payload).toBeNull()
    })
  })

  describe('isSyncJobType', () => {
    it.each([
      'full_sync',
      'incremental_sync',
      'realtime_sync',
      'player_sync',
      'validation_sync'
    ])('returns true for %s', (type) => {
      expect(isSyncJobType(type)).toBe(true)
    })

    it('returns false for unknown type', () => {
      expect(isSyncJobType('unknown')).toBe(false)
    })
  })

  describe('toIntegerOrNull', () => {
    it('returns truncated number for integers', () => {
      expect(toIntegerOrNull(42)).toBe(42)
    })

    it('truncates decimals', () => {
      expect(toIntegerOrNull(3.9)).toBe(3)
    })

    it('parses numeric strings', () => {
      expect(toIntegerOrNull('  123  ')).toBe(123)
    })

    it('returns null for empty string', () => {
      expect(toIntegerOrNull('')).toBeNull()
    })

    it('returns null for non-numeric string', () => {
      expect(toIntegerOrNull('abc')).toBeNull()
    })

    it('returns null for null/undefined', () => {
      expect(toIntegerOrNull(null)).toBeNull()
      expect(toIntegerOrNull(undefined)).toBeNull()
    })

    it('returns null for NaN', () => {
      expect(toIntegerOrNull(NaN)).toBeNull()
    })

    it('returns null for Infinity', () => {
      expect(toIntegerOrNull(Infinity)).toBeNull()
    })
  })

  describe('cleanNullString', () => {
    it('returns null for literal "null"', () => {
      expect(cleanNullString('null')).toBeNull()
    })

    it('returns null for literal "undefined"', () => {
      expect(cleanNullString('undefined')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(cleanNullString('')).toBeNull()
    })

    it('returns null for actual null', () => {
      expect(cleanNullString(null)).toBeNull()
    })

    it('returns value for normal string', () => {
      expect(cleanNullString('hello')).toBe('hello')
    })
  })

  describe('resolveEntryTimestampOrNull', () => {
    it.each([null, undefined, false, 12, [], 'invalid'])(
      'returns null for malformed entry %j',
      (entry) => {
        expect(resolveEntryTimestampOrNull(entry as any)).toBeNull()
      }
    )
    it('resolves ISO timestamp field', () => {
      const entry = { timestamp: '2024-01-15T12:00:00.000Z' } as any
      expect(resolveEntryTimestampOrNull(entry)).toBe(
        '2024-01-15T12:00:00.000Z'
      )
    })

    it('resolves epoch seconds', () => {
      const entry = { timestamp: 1705312800 } as any // 2024-01-15T10:00:00Z
      const result = resolveEntryTimestampOrNull(entry)
      expect(result).toBeTruthy()
      expect(new Date(result!).getFullYear()).toBe(2024)
    })

    it('resolves epoch milliseconds', () => {
      const entry = { timestamp: 1705312800000 } as any
      const result = resolveEntryTimestampOrNull(entry)
      expect(result).toBeTruthy()
    })

    it('falls back to completedOn when timestamp is null', () => {
      const entry = {
        timestamp: null,
        completedOn: '2024-06-01T00:00:00Z'
      } as any
      expect(resolveEntryTimestampOrNull(entry)).toBe(
        '2024-06-01T00:00:00.000Z'
      )
    })

    it('falls back to startedOn', () => {
      const entry = {
        timestamp: null,
        completedOn: null,
        startedOn: '2024-03-01T00:00:00Z'
      } as any
      expect(resolveEntryTimestampOrNull(entry)).toBe(
        '2024-03-01T00:00:00.000Z'
      )
    })

    it('returns null when all fields are null', () => {
      const entry = {
        timestamp: null,
        completedOn: null,
        startedOn: null
      } as any
      expect(resolveEntryTimestampOrNull(entry)).toBeNull()
    })
  })

  describe('resolveSeasonNumber', () => {
    it('resolves season from season field', () => {
      expect(resolveSeasonNumber({ season: 5 } as any)).toBe(5)
    })

    it('resolves the supported nested response season', () => {
      expect(
        resolveSeasonNumber({ body: { season: 110, entries: [] } } as any)
      ).toBe(110)
    })

    it('resolves from currentSeason as fallback', () => {
      expect(resolveSeasonNumber({ currentSeason: 3 } as any)).toBe(3)
    })

    it('throws when season is missing', () => {
      expect(() => resolveSeasonNumber({} as any)).toThrow(
        'API response missing season number'
      )
    })

    it('throws when season is zero', () => {
      expect(() => resolveSeasonNumber({ season: 0 } as any)).toThrow(
        'API response missing season number'
      )
    })

    it('throws when season is negative', () => {
      expect(() => resolveSeasonNumber({ season: -1 } as any)).toThrow(
        'API response missing season number'
      )
    })
  })

  describe('callRpc', () => {
    let mockSupabase: any

    beforeEach(() => {
      mockSupabase = {
        rpc: vi.fn()
      }
    })

    it('calls rpc with function name and no args', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 'result', error: null })
      const result = await callRpc(mockSupabase, 'my_function')
      expect(mockSupabase.rpc).toHaveBeenCalledWith('my_function')
      expect(result).toEqual({ data: 'result', error: null })
    })

    it('calls rpc with function name and args', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: 42, error: null })
      const result = await callRpc(mockSupabase, 'my_fn', { p_id: '123' })
      expect(mockSupabase.rpc).toHaveBeenCalledWith('my_fn', { p_id: '123' })
      expect(result).toEqual({ data: 42, error: null })
    })

    it('normalizes missing data/error fields', async () => {
      mockSupabase.rpc.mockResolvedValue({})
      const result = await callRpc(mockSupabase, 'fn')
      expect(result).toEqual({ data: null, error: null })
    })

    it('handles null response', async () => {
      mockSupabase.rpc.mockResolvedValue(null)
      const result = await callRpc(mockSupabase, 'fn')
      expect(result).toEqual({ data: null, error: null })
    })
  })
})
