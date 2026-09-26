import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.dashboard.skipped-primes')

/** Only `subN_skip === true` counts: the writer also inserts placeholder rows. Fails open. */
export async function getSkippedPrimeEncounters(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string,
  stageCode: string
): Promise<Set<1 | 2>> {
  const skipped = new Set<1 | 2>()
  try {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types do not include upcoming_season_bosses yet
      .from('upcoming_season_bosses' as any)
      .select('sub_bosses')
      .eq('guild_code', guildCode)
      .eq('season_number', season)
      .eq('level', stageCode)
      .maybeSingle()

    if (error) {
      logger.warn(
        { err: error.message, guildCode, season, stageCode },
        'skipped-primes.read.error'
      )
      return skipped
    }

    const subBosses = (data as { sub_bosses?: unknown } | null)?.sub_bosses
    if (subBosses && typeof subBosses === 'object') {
      const flags = subBosses as Record<string, unknown>
      if (flags.sub1_skip === true) skipped.add(1)
      if (flags.sub2_skip === true) skipped.add(2)
    }
  } catch (err) {
    logger.warn(
      { err, guildCode, season, stageCode },
      'skipped-primes.read.unexpected'
    )
  }
  return skipped
}
