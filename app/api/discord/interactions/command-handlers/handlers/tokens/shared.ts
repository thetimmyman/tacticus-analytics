import type { Supabase } from '../../types'
import type { EOTGRData } from '@tacticus/app-core/types'

export {
  loadActiveRoster,
  isPlayerInRoster,
  resolveCanonicalDisplayName,
  createRosterPlayerKey
} from '../../utils/player-resolution'

export const READY_ONLY_MEMBER_LIMIT = 40
export const SEASON_CACHE_DURATION = 0 // Disabled - always fetch fresh season

function createTTLValue<T>(ttl: number) {
  let cached: { value: T; expiry: number } | null = null
  return {
    get(): T | null {
      if (cached && cached.expiry > Date.now()) {
        return cached.value
      }
      cached = null
      return null
    },
    set(value: T) {
      cached = { value, expiry: Date.now() + ttl }
    },
    clear() {
      cached = null
    }
  }
}

const seasonCache = createTTLValue<string>(SEASON_CACHE_DURATION)

export type TokenUsageRow = Pick<EOTGRData, 'displayName' | 'userId' | 'Guild'>

export async function getCurrentSeason(supabase: Supabase): Promise<string> {
  const cached = seasonCache.get()
  if (cached) {
    return cached
  }

  // "Season" is TEXT, so ORDER BY desc sorts lexically ("9" > "83").
  const { data: rpcSeason, error } = await supabase.rpc('get_latest_season')

  if (error || !rpcSeason) {
    const details = error?.message ?? 'RPC returned null'
    throw new Error(`Failed to fetch current season: ${details}`)
  }

  const season = String(rpcSeason)
  seasonCache.set(season)
  return season
}

export function resolveGuildLabel(
  upper: string,
  accessibleGuildsUpper: string[],
  accessibleGuilds: string[]
): string {
  const index = accessibleGuildsUpper.indexOf(upper)
  if (index >= 0 && index < accessibleGuilds.length) {
    return accessibleGuilds[index] ?? upper
  }
  return upper
}
