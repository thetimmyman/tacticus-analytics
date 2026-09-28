import { describe, expect, it, vi } from 'vitest'
import { withoutWriteClock } from '@/supabase/functions/_shared/sync-modules/helpers'
import { upsertDataBatches as upsertAppBatches } from '@/app/lib/sync/db-operations/raid-upsert'
import { upsertDataBatches as upsertEdgeBatches } from '@/supabase/functions/_shared/sync-modules/db-writer'

const row = {
  Guild: 'TESTGUILD',
  Season: '1',
  userId: 'TestPlayerA',
  encounterId: 2,
  startedOn: '2020-01-01T00:00:00.000Z',
  completedOn: '2020-01-01T00:01:00.000Z',
  damageDealt: 100,
  damageType: 'Battle',
  timestamp: '2020-01-02T00:00:00.000Z'
}
const expected = { ...row }
delete (expected as Partial<typeof row>).timestamp

describe('battle write clock', () => {
  it('removes only timestamp from a copy', () => {
    const result = withoutWriteClock(row)
    expect(result).toEqual(expected)
    expect(result).not.toBe(row)
    expect(row.timestamp).toBe('2020-01-02T00:00:00.000Z')
  })

  it.each([false, true])(
    'app writer strips batch and retry payloads (retry=%s)',
    async (retry) => {
      const payloads: unknown[][] = []
      const options: unknown[] = []
      const upsert = vi.fn((rows: unknown[], opts: unknown) => {
        payloads.push(rows)
        options.push(opts)
        return {
          select: async () => ({
            data:
              retry && payloads.length === 1
                ? null
                : [{ id: 1, timestamp: row.timestamp }],
            error:
              retry && payloads.length === 1
                ? { message: 'batch failed' }
                : null
          })
        }
      })
      await upsertAppBatches(
        { from: () => ({ upsert }) } as never,
        'TESTGUILD',
        [row] as never
      )
      expect(payloads).toEqual(retry ? [[expected], [expected]] : [[expected]])
      expect(options).toEqual(
        retry
          ? [
              {
                onConflict:
                  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
                defaultToNull: false
              },
              {
                onConflict:
                  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType'
              }
            ]
          : [
              {
                onConflict:
                  'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
                defaultToNull: false
              }
            ]
      )
    }
  )

  it.each([false, true])(
    'edge writer strips batch and retry payloads (retry=%s)',
    async (retry) => {
      const payloads: unknown[][] = []
      const options: unknown[] = []
      const upsert = vi.fn(async (rows: unknown[], opts: unknown) => {
        payloads.push(rows)
        options.push(opts)
        return retry && payloads.length === 1
          ? { error: { message: 'batch failed' }, count: null }
          : { error: null, count: rows.length }
      })
      await upsertEdgeBatches(
        {
          supabase: { from: () => ({ upsert }) },
          logger: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn()
          }
        },
        { table: 'EOT_GR_data', batchSize: 10 },
        'TESTGUILD',
        [row] as never,
        () => true
      )
      expect(payloads).toEqual(retry ? [[expected], [expected]] : [[expected]])
      expect(options).toEqual(
        Array(retry ? 2 : 1).fill({
          onConflict:
            'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
          defaultToNull: false,
          count: 'exact'
        })
      )
    }
  )
})
