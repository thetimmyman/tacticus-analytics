/** Fast-path token/bomb availability from /guildRaid + /guild, overlaid with live counts for key holders. */
import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.tokens.guild-raid-tokens'
)
import { decryptApiKey } from '@tacticus/app-core/encryption'
import {
  normalizeGuildRaidEntryTimestamps,
  tacticusAPI,
  type GuildRaidEntry
} from '@/app/lib/api/tacticus-client'
import {
  calculateTokenAvailability,
  MAX_TOKENS
} from '@/app/lib/calculations/token-calculation'
import {
  MAX_BOMBS,
  BOMB_COOLDOWN_SECONDS,
  computeBombAvailability
} from '@/app/lib/calculations/bomb-availability'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'
import {
  fetchLiveTokenDataForMembers,
  loadGuildTokenStatuses,
  type LiveTokenData,
  type PlayerTokenStatus,
  type RawMemberRow
} from '@/app/api/guild-tokens/token-service'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { Supabase } from '../../types'
import type { FetchGuildTokenCandidatesResult } from './fetch-guild-tokens'

// Economy logic is delegated so this path cannot drift from web/Herald.

export interface GuildRaidTokenStatus {
  userId: string
  username: string
  tokensAvailable: number
  tokensUsed: number
  bombsAvailable: number
  tokenCooldown: string | null
  tokenNextSeconds: number | null
  bombCooldown: string | null
}

/** Combines both seasons for cooldown continuity; `anchorStart` omitted means first-battle anchor. */
export function computeTokensFromGuildRaid(
  currentEntries: GuildRaidEntry[],
  prevEntries: GuildRaidEntry[],
  guildMemberIds: string[],
  now?: Date,
  anchorStart?: Date
): GuildRaidTokenStatus[] {
  const nowDate = now ?? new Date()
  const nowSec = Math.floor(nowDate.getTime() / 1000)
  const normalizedCurrentEntries = currentEntries.map(
    normalizeGuildRaidEntryTimestamps
  )
  const normalizedPrevEntries = prevEntries.map(
    normalizeGuildRaidEntryTimestamps
  )

  const currentMembers = new Set(guildMemberIds)

  const prevUsers = new Set<string>()
  for (const e of normalizedPrevEntries) {
    if (e.damageType !== 'Bomb') {
      prevUsers.add(e.userId)
    }
  }

  const formerMembers = new Set(
    Array.from(prevUsers).filter((id) => !currentMembers.has(id))
  )

  const combinedEntries = normalizedCurrentEntries.concat(normalizedPrevEntries)

  const currentBattlesByUser = new Map<string, number>()
  for (const e of normalizedCurrentEntries) {
    if (e.damageType !== 'Bomb' && !formerMembers.has(e.userId)) {
      currentBattlesByUser.set(
        e.userId,
        (currentBattlesByUser.get(e.userId) ?? 0) + 1
      )
    }
  }

  const byUser = new Map<
    string,
    { username: string; battles: GuildRaidEntry[]; bombs: GuildRaidEntry[] }
  >()
  for (const e of combinedEntries) {
    if (formerMembers.has(e.userId)) continue

    let bucket = byUser.get(e.userId)
    if (!bucket) {
      bucket = { username: e.username, battles: [], bombs: [] }
      byUser.set(e.userId, bucket)
    }
    if (e.username) bucket.username = e.username
    if (e.damageType === 'Bomb') {
      bucket.bombs.push(e)
    } else {
      bucket.battles.push(e)
    }
  }

  const results: GuildRaidTokenStatus[] = []

  // Roster members with no entries regen from the anchor, or get full tokens without one.
  const fullTokenState = calculateTokenAvailability([], anchorStart, nowDate)

  for (const [userId, { username, battles, bombs }] of byUser) {
    const tokenBattles = battles
      .filter((b) => b.startedOn !== null)
      .map((b) => ({
        displayName: username,
        damageType: 'Battle' as const,
        startedOn: new Date((b.startedOn as number) * 1000).toISOString()
      }))
    const tokenResult = calculateTokenAvailability(
      tokenBattles,
      anchorStart,
      nowDate
    )

    let bombsAvailable = MAX_BOMBS
    let bombCooldown: string | null = null

    if (bombs.length > 0) {
      bombs.sort((a, b) => b.startedOn - a.startedOn) // newest first
      const lastBombTime = bombs[0]?.startedOn
      if (lastBombTime === undefined) continue
      const bomb = computeBombAvailability(lastBombTime, nowSec)

      if (!bomb.available) {
        bombsAvailable = 0
        bombCooldown = formatCooldown(bomb.remainingSeconds)
      } else {
        bombCooldown = formatCooldown(
          nowSec - lastBombTime - BOMB_COOLDOWN_SECONDS
        )
      }
    }

    results.push({
      userId,
      username,
      tokensAvailable: tokenResult.tokensAvailable,
      tokensUsed: currentBattlesByUser.get(userId) ?? 0,
      bombsAvailable,
      tokenCooldown: tokenResult.tokenCooldown,
      tokenNextSeconds: tokenResult.tokenNextSeconds ?? null,
      bombCooldown
    })
  }

  for (const memberId of guildMemberIds) {
    if (!byUser.has(memberId)) {
      results.push({
        userId: memberId,
        username: '', // Will be resolved from player_mapping
        tokensAvailable: fullTokenState.tokensAvailable,
        tokensUsed: 0,
        bombsAvailable: MAX_BOMBS,
        tokenCooldown: fullTokenState.tokenCooldown,
        tokenNextSeconds: fullTokenState.tokenNextSeconds ?? null,
        bombCooldown: null
      })
    }
  }

  return results
}

function formatCooldown(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Returns null without a guild-level API key (caller falls back). */
export async function fetchGuildTokensFast(
  supabase: Supabase,
  guildCode: string
): Promise<FetchGuildTokenCandidatesResult | null> {
  try {
    const { data: config } = await supabase
      .from('guild_config')
      .select('api_key_encrypted')
      .eq('guild_code', guildCode)
      .single()

    if (!config?.api_key_encrypted) {
      logger.debug({ guildCode }, 'No guild API key for fast path')
      return null
    }

    const apiKey = await decryptApiKey(config.api_key_encrypted)
    if (!apiKey) {
      return null
    }

    const raidData = await tacticusAPI.getCurrentGuildRaid(apiKey)
    if (!raidData || !raidData.entries) {
      logger.warn({ guildCode }, 'Guild raid fast path returned no data')
      return null
    }

    let prevEntries: GuildRaidEntry[] = []
    if (raidData.season > 1) {
      const prevData = await tacticusAPI.getGuildRaidBySeason(
        apiKey,
        raidData.season - 1
      )
      if (prevData?.entries) {
        prevEntries = prevData.entries
      }
    }

    const guild = await tacticusAPI.getGuild(apiKey)
    const guildMemberIds = guild?.members?.map((m) => m.userId) ?? []

    let anchorStart: Date | undefined
    try {
      const anchorSeason =
        raidData.season > 1 ? raidData.season - 1 : raidData.season
      anchorStart = new Date((await getSeasonTiming(anchorSeason)).seasonStart)
    } catch (timingError) {
      logger.warn(
        {
          guildCode,
          season: raidData.season,
          error:
            timingError instanceof Error
              ? timingError.message
              : String(timingError)
        },
        'Season timing unavailable; replay uses first-battle anchor'
      )
    }

    const statuses = computeTokensFromGuildRaid(
      raidData.entries,
      prevEntries,
      guildMemberIds,
      undefined,
      anchorStart
    )

    // With an empty roster too, fall back rather than render an authoritative-looking 0-player report.
    if (statuses.length === 0) {
      logger.warn(
        { guildCode, entries: raidData.entries.length },
        'Guild raid fast path computed zero players, falling back'
      )
      return null
    }

    const userIds = statuses.map((s) => s.userId)
    const { data: mappings } = await guildRosterQuery(
      supabase,
      guildCode,
      'player_id, discord_user_id, display_name, user_id, last_sync_tokens, last_sync_bombs, last_sync_at, next_token_seconds, next_bomb_seconds, api_key_is_valid, tacticus_api_key_encrypted'
    ).in('player_id', userIds)

    const discordMap = new Map<string, string | null>()
    const nameMap = new Map<string, string>()
    if (mappings) {
      for (const m of mappings) {
        discordMap.set(m.player_id, m.discord_user_id ?? null)
        if (m.display_name) nameMap.set(m.player_id, m.display_name)
      }
    }

    // Precedence: live player API > snapshot projection > replay; projection fetched once, on a miss.
    let liveByPlayerId = new Map<string, LiveTokenData>()
    const projectionByPlayerId = new Map<string, PlayerTokenStatus>()
    let liveMissedKeyHolders = 0
    const keyHolders = ((mappings ?? []) as RawMemberRow[]).filter(
      (m) => m.tacticus_api_key_encrypted
    )
    if (keyHolders.length > 0) {
      liveByPlayerId = await fetchLiveTokenDataForMembers(keyHolders, supabase)

      const missedKeyHolderIds = new Set(
        keyHolders
          .map((m) => m.player_id)
          .filter((id) => !liveByPlayerId.has(id))
      )
      liveMissedKeyHolders = missedKeyHolderIds.size

      if (missedKeyHolderIds.size > 0) {
        try {
          // skipLiveOverlay avoids a second fan-out.
          const projection = await loadGuildTokenStatuses(supabase, {
            guildCode,
            season: String(raidData.season),
            skipLiveOverlay: true
          })
          for (const player of projection.players) {
            if (missedKeyHolderIds.has(player.player_id)) {
              projectionByPlayerId.set(player.player_id, player)
            }
          }
        } catch (projectionError) {
          logger.warn(
            {
              guildCode,
              error:
                projectionError instanceof Error
                  ? projectionError.message
                  : String(projectionError)
            },
            'Token projection fallback failed; missed key-holders keep replay estimate'
          )
        }
      }

      for (const status of statuses) {
        const live = liveByPlayerId.get(status.userId)
        if (live) {
          status.tokensAvailable = Math.max(
            0,
            Math.min(MAX_TOKENS, live.tokensAvailable)
          )
          status.bombsAvailable = Math.max(
            0,
            Math.min(MAX_BOMBS, live.bombsAvailable)
          )
          status.tokenNextSeconds = live.tokenNextSeconds
          status.tokenCooldown =
            live.tokenNextSeconds && live.tokenNextSeconds > 0
              ? formatCooldown(live.tokenNextSeconds)
              : null
          status.bombCooldown =
            live.bombNextSeconds && live.bombNextSeconds > 0
              ? formatCooldown(live.bombNextSeconds)
              : null
          continue
        }

        const projected = projectionByPlayerId.get(status.userId)
        if (projected) {
          status.tokensAvailable = Math.max(
            0,
            Math.min(MAX_TOKENS, projected.tokens_available)
          )
          status.bombsAvailable = Math.max(
            0,
            Math.min(MAX_BOMBS, projected.bombs_available)
          )
          status.tokenNextSeconds = projected.token_next_in_seconds
          status.tokenCooldown =
            projected.token_next_in_seconds &&
            projected.token_next_in_seconds > 0
              ? formatCooldown(projected.token_next_in_seconds)
              : null
          status.bombCooldown =
            projected.next_bomb_seconds && projected.next_bomb_seconds > 0
              ? formatCooldown(projected.next_bomb_seconds)
              : null
        }
      }
    }

    logger.info(
      {
        guildCode,
        season: raidData.season,
        entries: raidData.entries.length,
        prevEntries: prevEntries.length,
        rosterMembers: guildMemberIds.length,
        players: statuses.length,
        anchored: Boolean(anchorStart),
        liveEligible: keyHolders.length,
        liveOverlaid: liveByPlayerId.size,
        liveMissed: liveMissedKeyHolders,
        projectionFallback: projectionByPlayerId.size
      },
      'Guild raid fast path succeeded'
    )

    return {
      ok: true,
      players: statuses.map((s) => ({
        playerId: s.userId,
        displayName: nameMap.get(s.userId) || s.username || 'Unknown',
        discordUserId: discordMap.get(s.userId) ?? null,
        tokensAvailable: s.tokensAvailable,
        tokensUsed: s.tokensUsed,
        bombsAvailable: s.bombsAvailable,
        tokenCooldown: s.tokenCooldown,
        tokenNextSeconds: s.tokenNextSeconds,
        bombCooldown: s.bombCooldown
      }))
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.warn(
      {
        guildCode,
        error: error instanceof Error ? error.message : String(error)
      },
      'Guild raid fast path failed, will fall back'
    )
    return null
  }
}
