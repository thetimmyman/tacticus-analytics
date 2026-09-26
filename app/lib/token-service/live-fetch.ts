import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
import { writeBackPlayerTokenSnapshot } from '@/app/lib/token-service/snapshot-write'
import type { LiveTokenData, RawMemberRow } from '@/app/lib/token-service/types'
import { settledMapWithConcurrency } from '@/app/lib/utils/bounded-fanout'

const logger = createComponentLogger('lib.token-service.live-fetch')
const BATCH_PER_CALL_TIMEOUT_MS = 3000
const BATCH_MAX_RETRIES = 0
const LIVE_TOKEN_FANOUT_CONCURRENCY = 4
const MAX_LIVE_TOKEN_FANOUT_MEMBERS = 40

export async function fetchLiveTokenDataForMembers(
  members: RawMemberRow[],
  supabase: SupabaseClient
): Promise<Map<string, LiveTokenData>> {
  const liveData = new Map<string, LiveTokenData>()
  const allMembersWithKeys = members.filter((m) => m.tacticus_api_key_encrypted)
  if (allMembersWithKeys.length === 0) return liveData

  const membersWithKeys = allMembersWithKeys.slice(
    0,
    MAX_LIVE_TOKEN_FANOUT_MEMBERS
  )
  if (allMembersWithKeys.length > membersWithKeys.length) {
    logger.warn(
      {
        eligible: allMembersWithKeys.length,
        cap: MAX_LIVE_TOKEN_FANOUT_MEMBERS
      },
      'Live token fan-out truncated to per-invocation member cap'
    )
  }

  const results = await settledMapWithConcurrency(
    membersWithKeys,
    LIVE_TOKEN_FANOUT_CONCURRENCY,
    async (member) => {
      const apiKey = await getPlayerApiKey(member)
      if (!apiKey) {
        logger.debug(
          { player: member.display_name },
          'No decryptable API key for member'
        )
        return {
          playerId: member.player_id,
          data: null as LiveTokenData | null
        }
      }

      const playerData = await tacticusAPI.getPlayerWithRetry(apiKey, {
        timeoutMs: BATCH_PER_CALL_TIMEOUT_MS,
        maxRetries: BATCH_MAX_RETRIES
      })
      const guildRaid = playerData?.progress?.guildRaid
      if (!guildRaid) {
        logger.debug(
          { player: member.display_name },
          'No guild raid progress from API'
        )
        return {
          playerId: member.player_id,
          data: null as LiveTokenData | null
        }
      }

      const data: LiveTokenData = {
        tokensAvailable: guildRaid.tokens?.current ?? 0,
        bombsAvailable: guildRaid.bombTokens?.current ?? 0,
        tokenNextSeconds: guildRaid.tokens?.nextTokenInSeconds ?? null,
        bombNextSeconds: guildRaid.bombTokens?.nextTokenInSeconds ?? null
      }
      writeBackPlayerTokenSnapshot(supabase, member, data)
      return { playerId: member.player_id, data }
    }
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.data) {
      liveData.set(result.value.playerId, result.value.data)
    }
  }

  logger.info(
    {
      eligible: allMembersWithKeys.length,
      fetched: liveData.size,
      attempted: membersWithKeys.length,
      failed: membersWithKeys.length - liveData.size
    },
    'Live token fetch complete'
  )
  return liveData
}
