import {
  assertEquals,
  assertRejects
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { readGuildSeasons } from '../_shared/guild-seasons.ts'
import { planHistoricalSeasons } from './planning.ts'

Deno.test(
  'fills holes in the newest five seasons despite five older records',
  () => {
    assertEquals(
      planHistoricalSeasons({
        currentSeason: 100,
        existingSeasons: [99, 98, 96, 95, 94],
        maxSeasons: 5,
        lookbackSeasons: 20
      }),
      [97]
    )
  }
)

Deno.test('limits discovery to the requested recent coverage window', () => {
  assertEquals(
    planHistoricalSeasons({
      currentSeason: 100,
      existingSeasons: [98, 97, 96, 95],
      maxSeasons: 2,
      lookbackSeasons: 20
    }),
    [99]
  )
})

Deno.test(
  'uses the complete distinct season list returned by the RPC',
  async () => {
    let calls = 0
    const seasons = await readGuildSeasons(async () => {
      calls++
      return { data: ['1', '200', '199', '200'], error: null }
    })
    assertEquals(calls, 1)
    assertEquals(seasons, [200, 199, 1])
  }
)

Deno.test(
  'fails closed when the season RPC errors or returns malformed data',
  async () => {
    await assertRejects(
      () =>
        readGuildSeasons(async () => ({
          data: null,
          error: { message: 'timeout' }
        })),
      Error,
      'timeout'
    )
    await assertRejects(
      () => readGuildSeasons(async () => ({ data: null, error: null })),
      Error,
      'not an array'
    )
    await assertRejects(
      () => readGuildSeasons(async () => ({ data: ['bad'], error: null })),
      Error,
      'invalid season'
    )
  }
)
