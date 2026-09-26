/**
 * Token bank from live `/guildRaid` entries (`last_sync_tokens` may be hours stale).
 * Never throws, so the route can fall back to stored sync.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import {
  normalizeGuildRaidEntryTimestamps,
  tacticusAPI,
  type GuildRaidEntry
} from '@/app/lib/api/tacticus-client'
import { calculateTokenAvailability } from '@/app/lib/calculations/token-calculation'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'

export type LiveTokensSource =
  'live_api' | 'no_api_key' | 'api_unavailable' | 'decrypt_failed'

export interface LiveTokensResult {
  source: LiveTokensSource
  tokens: Record<string, number> | null
  apiCalledAt: string | null
  entriesCount: number
}

interface LoadLiveGuildTokensArgs {
  supabase: SupabaseClient<Database>
  guildCode: string
  seasonStart?: Date
  currentTime?: Date
}

// Single-flight per guild so members do not each trigger a key-decrypting API call.
const LIVE_TOKENS_CACHE_TTL_MS = 45_000

interface LiveTokensCacheEntry {
  promise: Promise<LiveTokensResult>
  expiresAt: number
}

const liveTokensCache = new Map<string, LiveTokensCacheEntry>()

/** Only `live_api` results are cached. */
export async function loadLiveGuildTokens(
  args: LoadLiveGuildTokensArgs
): Promise<LiveTokensResult> {
  if (args.seasonStart !== undefined || args.currentTime !== undefined) {
    return fetchLiveGuildTokensUncached(args)
  }

  const now = Date.now()
  const cached = liveTokensCache.get(args.guildCode)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = fetchLiveGuildTokensUncached(args)
  liveTokensCache.set(args.guildCode, {
    promise,
    expiresAt: now + LIVE_TOKENS_CACHE_TTL_MS
  })

  const evictIfStillOurs = () => {
    const current = liveTokensCache.get(args.guildCode)
    if (current?.promise === promise) {
      liveTokensCache.delete(args.guildCode)
    }
  }
  try {
    const result = await promise
    if (result.source !== 'live_api') evictIfStillOurs()
    return result
  } catch (err) {
    evictIfStillOurs()
    throw err
  }
}

async function fetchLiveGuildTokensUncached(
  args: LoadLiveGuildTokensArgs
): Promise<LiveTokensResult> {
  const { supabase, guildCode, seasonStart, currentTime } = args

  const { data: guildConfig, error: configError } = await supabase
    .from('guild_config')
    .select('api_key_encrypted')
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (configError || !guildConfig?.api_key_encrypted) {
    return {
      source: 'no_api_key',
      tokens: null,
      apiCalledAt: null,
      entriesCount: 0
    }
  }

  let apiKey: string
  try {
    apiKey = await decryptApiKey(guildConfig.api_key_encrypted)
  } catch {
    return {
      source: 'decrypt_failed',
      tokens: null,
      apiCalledAt: null,
      entriesCount: 0
    }
  }

  const apiCalledAt = new Date().toISOString()
  const response = await tacticusAPI.getCurrentGuildRaid(apiKey)
  if (!response) {
    return {
      source: 'api_unavailable',
      tokens: null,
      apiCalledAt,
      entriesCount: 0
    }
  }

  let effectiveSeasonStart = seasonStart
  if (effectiveSeasonStart === undefined) {
    try {
      effectiveSeasonStart = new Date(
        (await getSeasonTiming(response.season)).seasonStart
      )
    } catch {
      effectiveSeasonStart = undefined
    }
  }

  const tokens = derivePlayerTokensFromEntries({
    entries: response.entries,
    seasonStart: effectiveSeasonStart,
    currentTime
  })

  return {
    source: 'live_api',
    tokens,
    apiCalledAt,
    entriesCount: response.entries.length
  }
}

export function derivePlayerTokensFromEntries(args: {
  entries: ReadonlyArray<GuildRaidEntry>
  seasonStart?: Date
  currentTime?: Date
}): Record<string, number> {
  const grouped = new Map<string, GuildRaidEntry[]>()
  for (const entry of args.entries) {
    const list = grouped.get(entry.userId)
    if (list) list.push(entry)
    else grouped.set(entry.userId, [entry])
  }

  const out: Record<string, number> = {}
  for (const [userId, userEntries] of grouped) {
    // The API sends epoch seconds; calculateTokenAvailability expects ISO strings.
    const battles = userEntries.map((rawEntry) => {
      const e = normalizeGuildRaidEntryTimestamps(rawEntry)
      return {
        displayName: e.username,
        damageType: e.damageType,
        startedOn: new Date(e.startedOn * 1000).toISOString(),
        completedOn: new Date(e.completedOn * 1000).toISOString()
      }
    })
    const result = calculateTokenAvailability(
      battles,
      args.seasonStart,
      args.currentTime
    )
    out[userId] = result.tokensAvailable
  }

  return out
}
