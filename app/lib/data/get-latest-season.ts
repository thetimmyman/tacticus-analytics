import { serviceDb } from '@/app/lib/db'
import { cacheCompat } from '@/app/lib/utils/react-cache'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.data.get-latest-season')

/** Null when unresolvable: never fall back to a hardcoded season. */
export const getLatestSeason = cacheCompat(async (): Promise<string | null> => {
  try {
    // serviceDb(): the RPC is SECURITY INVOKER; the latest season is a global max, not user-scoped.
    const supabase = serviceDb()

    const { data: rpcData, error: rpcError } =
      await supabase.rpc('get_latest_season')

    if (!rpcError && rpcData) {
      return rpcData
    }

    // On several pages' render path, so it must stay bounded: the `season_num` DESC index makes this
    // one tuple. Never order by "Season" (TEXT lex-sort) or "startedOn" (unindexed).
    const { data, error } = await supabase
      .from('EOT_GR_data')
      .select('season_num')
      .order('season_num', { ascending: false, nullsFirst: false })
      .limit(1)

    const latestSeasonNum = data?.[0]?.season_num

    if (error || latestSeasonNum === null || latestSeasonNum === undefined) {
      logger.error(
        { err: error || 'No data' },
        'Failed to fetch latest season:'
      )
      return null
    }

    return String(latestSeasonNum)
  } catch (error) {
    logger.error({ err: error }, '[getLatestSeason] Unexpected error:')
    return null
  }
})
