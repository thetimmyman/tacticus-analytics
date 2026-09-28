import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { pseudonymizeId, upsertDataBatches } from './db-writer.ts'
import type { Logger } from './db-writer.ts'

Deno.test(
  'upsertDataBatches logs the single-row retry error with row key columns and increments errors by exactly 1',
  async () => {
    const warnCalls: Array<{ ctx: string; msg: string }> = []
    const logger: Logger = {
      info: () => {},
      warn: (ctx, msg) => warnCalls.push({ ctx, msg }),
      error: () => {},
      debug: () => {}
    }

    const record = {
      Guild: 'TEST_GUILD',
      Season: '81',
      userId: 'player1',
      encounterId: 3,
      startedOn: '2026-09-01T00:00:00.000Z',
      completedOn: '2026-09-01T00:05:00.000Z',
      damageDealt: 12345,
      damageType: 'Battle'
    }

    const singleUpsertError = {
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      details:
        'Key (Guild, Season, userId)=(TEST_GUILD, 81, player1) already exists.'
    }

    let upsertCallCount = 0
    const supabase = {
      from: () => ({
        upsert: () => {
          upsertCallCount++
          if (upsertCallCount === 1) {
            return Promise.resolve({ error: { message: 'batch failed' } })
          }
          return Promise.resolve({ error: singleUpsertError, count: null })
        }
      })
    }

    const result = await upsertDataBatches(
      { supabase, logger },
      { table: 'EOT_GR_data', batchSize: 500 },
      'TEST_GUILD',
      [record] as never,
      () => true
    )

    assertEquals(result.errors, 1)
    assertEquals(result.upserted, 0)

    const retryLog = warnCalls.find((call) => call.msg.includes('retry failed'))

    if (!retryLog) {
      throw new Error('expected a warn log for the failed single-row retry')
    }

    assertEquals(
      retryLog.msg.includes('duplicate key value violates unique constraint'),
      true
    )
    assertEquals(retryLog.msg.includes('code: 23505'), true)
    assertEquals(retryLog.msg.includes('Season=81'), true)
    assertEquals(retryLog.msg.includes('encounterId=3'), true)

    // The edge Logger has no PII sanitizer: the player appears only as a pseudonymous token.
    assertEquals(retryLog.msg.includes('player1'), false)
    assertEquals(retryLog.msg.includes('TEST_GUILD'), false)
    assertEquals(
      retryLog.msg.includes(`user=${pseudonymizeId('player1')}`),
      true
    )

    // Postgres `details` can contain the whole failing row.
    assertEquals(retryLog.msg.includes('details'), false)
    assertEquals(retryLog.msg.includes(singleUpsertError.details), false)
  }
)

Deno.test(
  'pseudonymizeId is stable, non-reversible and distinguishes inputs',
  () => {
    assertEquals(pseudonymizeId('player1'), pseudonymizeId('player1'))
    assertEquals(pseudonymizeId('player1') === pseudonymizeId('player2'), false)
    assertEquals(pseudonymizeId('player1').includes('player1'), false)
    assertEquals(pseudonymizeId(undefined), 'anon')
    assertEquals(pseudonymizeId(''), 'anon')
  }
)

Deno.test(
  'validation rejection contributes an error even without a database call',
  async () => {
    let calls = 0
    const logger: Logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    }
    const result = await upsertDataBatches(
      {
        supabase: {
          from: () => {
            calls++
            throw new Error('must not write rejected row')
          }
        },
        logger
      },
      { table: 'EOT_GR_data', batchSize: 500 },
      'guild',
      [{ Guild: 'guild' } as Parameters<typeof upsertDataBatches>[3][number]],
      () => false
    )
    assertEquals(result, { upserted: 0, inserted: 0, updated: 0, errors: 1 })
    assertEquals(calls, 0)
  }
)

for (const count of [null, 0, -1, 2, Number.NaN]) {
  Deno.test(
    `missing or invalid write acknowledgement (${count}) is incomplete`,
    async () => {
      const logger: Logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      }
      const result = await upsertDataBatches(
        {
          supabase: {
            from: () => ({ upsert: async () => ({ error: null, count }) })
          },
          logger
        },
        { table: 'EOT_GR_data', batchSize: 100 },
        'guild',
        [{}] as never,
        () => true
      )
      assertEquals(result.errors > 0, true)
    }
  )
}

for (const retry of [false, true]) {
  Deno.test(
    `upsertDataBatches never sends the battle write clock (retry=${retry})`,
    async () => {
      const payloads: Array<Array<Record<string, unknown>>> = []
      const upsert = (rows: Array<Record<string, unknown>>) => {
        payloads.push(rows)
        return Promise.resolve(
          retry && payloads.length === 1
            ? { error: { message: 'batch failed' }, count: null }
            : { error: null, count: rows.length }
        )
      }
      const logger: Logger = {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      }
      const row = {
        Guild: 'TEST_GUILD',
        Season: '81',
        userId: 'player1',
        encounterId: 3,
        startedOn: '2020-01-01T00:00:00.000Z',
        completedOn: '2020-01-01T00:01:00.000Z',
        damageDealt: 100,
        damageType: 'Battle',
        timestamp: '2020-01-02T00:00:00.000Z'
      }

      await upsertDataBatches(
        // deno-lint-ignore no-explicit-any
        { supabase: { from: () => ({ upsert }) } as any, logger },
        { table: 'EOT_GR_data', batchSize: 10 },
        'TEST_GUILD',
        // deno-lint-ignore no-explicit-any
        [row] as any,
        () => true
      )

      assertEquals(payloads.length, retry ? 2 : 1)
      for (const payload of payloads) {
        assertEquals(
          payload.every((sent) => !('timestamp' in sent)),
          true
        )
        assertEquals(payload[0].damageDealt, 100)
      }
      assertEquals(row.timestamp, '2020-01-02T00:00:00.000Z')
    }
  )
}
