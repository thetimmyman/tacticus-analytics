import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { resolveLokiIdentity } from '@/app/lib/loki/identity'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { calculateTokenAvailability } from '@/app/lib/calculations/token-calculation'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-tokens.token-service')
import {
  fetchGuildMembersViaLoki,
  fetchGuildMembersViaTacticus
} from '@/app/lib/sync/api-operations'
import { serviceDb } from '@/app/lib/db'
import { fetchLiveTokenDataForMembers } from '@/app/lib/token-service/live-fetch'
import { formatCooldownWithSeconds } from '@/app/lib/token-service/format'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import type {
  BattleQueryRow,
  BattleRow,
  GuildTokenDebugInfo,
  LiveTokenData,
  PlayerTokenStatus,
  RawMemberRow
} from '@/app/lib/token-service/types'

export * from '@/app/lib/token-service/types'
export { fetchLiveTokenDataForMembers } from '@/app/lib/token-service/live-fetch'
export { writeBackPlayerTokenSnapshot } from '@/app/lib/token-service/snapshot-write'

const hasReplayIdentity = (row: BattleQueryRow): row is BattleRow =>
  Boolean(row.userId && row.startedOn)

type GuildConfigRow = {
  guild_id: string | null
  user_id: string | null
  session_id: string | null
  api_key_encrypted: string | null
}

type RpcPlayerTokenStateRow = {
  player_id?: string | null
  display_name?: string | null
  discord_user_id?: string | null
  tokens_available?: number | null
  is_capped?: boolean | null
  data_source?: string | null
  token_next_in_seconds?: number | null
  last_sync_at?: string | null
  tokens_used?: number | null
  max_possible?: number | null
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
  last_battle_time?: string | null
  bombs_available?: number | null
  bomb_next_in_seconds?: number | null
}

function asFiniteInt(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.trunc(value)
}

function asNullableFiniteInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.trunc(value)
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function normalizeTokenDataSource(
  value: unknown
): PlayerTokenStatus['data_source'] {
  if (value === 'live' || value === 'api') return 'live'
  if (value === 'cached') return 'cached'
  return 'calculated'
}

function isCachedTokenRow(value: unknown): value is RpcPlayerTokenStateRow {
  if (!value || typeof value !== 'object') return false
  const row = value as RpcPlayerTokenStateRow
  const integer = (n: unknown, max = Number.MAX_SAFE_INTEGER) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max
  const optionalInteger = (n: unknown) => n == null || integer(n)
  return (
    typeof row.player_id === 'string' &&
    row.player_id.length > 0 &&
    typeof row.display_name === 'string' &&
    row.display_name.length > 0 &&
    integer(row.tokens_available, 3) &&
    integer(row.bombs_available, 1) &&
    integer(row.tokens_used) &&
    integer(row.max_possible) &&
    optionalInteger(row.token_next_in_seconds) &&
    optionalInteger(row.bomb_next_in_seconds) &&
    optionalInteger(row.burned_tokens) &&
    optionalInteger(row.time_over_cap_seconds) &&
    (row.data_source === 'cached' || row.data_source === 'calculated') &&
    (row.last_sync_at == null ||
      (typeof row.last_sync_at === 'string' &&
        Number.isFinite(Date.parse(row.last_sync_at))))
  )
}

async function fetchLiveOverlayForRpcRows(
  supabase: SupabaseClient,
  guildCode: string,
  allowedPlayerIds?: Set<string> | null
): Promise<{
  liveByPlayerId: Map<string, LiveTokenData>
  liveEligible: number
}> {
  const { data: members, error } = await guildRosterQuery(
    supabase,
    guildCode,
    `
      player_id,
      display_name,
      user_id,
      discord_user_id,
      last_sync_tokens,
      last_sync_bombs,
      last_sync_at,
      next_token_seconds,
      next_bomb_seconds,
      api_key_is_valid,
      tacticus_api_key_encrypted
    `
  )

  if (error) {
    logger.warn(
      {
        guildCode,
        error: error.message
      },
      'Failed to fetch members for RPC live token overlay'
    )
    return {
      liveByPlayerId: new Map<string, LiveTokenData>(),
      liveEligible: 0
    }
  }

  const typedMembers = ((members ?? []) as RawMemberRow[]).filter((member) => {
    if (!allowedPlayerIds || allowedPlayerIds.size === 0) return true
    return allowedPlayerIds.has(member.player_id)
  })

  const liveEligible = typedMembers.filter(
    (member) => member.tacticus_api_key_encrypted
  ).length
  if (liveEligible === 0) {
    return {
      liveByPlayerId: new Map<string, LiveTokenData>(),
      liveEligible: 0
    }
  }

  const liveByPlayerId = await fetchLiveTokenDataForMembers(
    typedMembers,
    supabase
  )
  return {
    liveByPlayerId,
    liveEligible
  }
}

async function loadGuildTokenStatusesFromRpc(
  supabase: SupabaseClient,
  {
    guildCode,
    season,
    clusterCode,
    allowedPlayerIds,
    skipLiveOverlay = false
  }: {
    guildCode: string
    season?: string | null
    clusterCode?: string | null
    allowedPlayerIds?: Set<string> | null
    skipLiveOverlay?: boolean
  }
): Promise<{
  players: PlayerTokenStatus[]
  debug: GuildTokenDebugInfo
} | null> {
  const desktop = getRuntimeProfile() === 'desktop'
  try {
    const { data, error } = await supabase.rpc(
      desktop ? 'desktop_get_player_token_state' : 'get_player_token_state',
      {
        p_guild_code: guildCode,
        p_season: season ?? null,
        p_cluster_code: clusterCode ?? null,
        p_player_id: null
      }
    )

    if (error) {
      if (desktop)
        throw new Error('Saved token state is unavailable', { cause: error })
      logger.warn(
        {
          guildCode,
          season,
          clusterCode,
          error: error.message
        },
        'get_player_token_state RPC failed; using legacy token service fallback'
      )
      return null
    }

    if (desktop && (!Array.isArray(data) || !data.every(isCachedTokenRow))) {
      throw new Error('Saved token state is malformed')
    }

    const rawRows = Array.isArray(data)
      ? (data as RpcPlayerTokenStateRow[])
      : []
    const mappedRows: PlayerTokenStatus[] = rawRows
      .filter(
        (row) =>
          typeof row?.player_id === 'string' &&
          typeof row?.display_name === 'string'
      )
      .filter((row) => {
        if (!allowedPlayerIds || allowedPlayerIds.size === 0) return true
        return allowedPlayerIds.has(row.player_id as string)
      })
      .map((row): PlayerTokenStatus => {
        const tokenNextIn = asNullableFiniteInt(row.token_next_in_seconds)
        const tokensAvailable = Math.max(
          0,
          Math.min(3, asFiniteInt(row.tokens_available, 3))
        )
        const dataSource = normalizeTokenDataSource(row.data_source)

        return {
          display_name: row.display_name as string,
          player_id: row.player_id as string,
          discord_user_id: asNullableString(row.discord_user_id),
          last_sync_tokens:
            dataSource === 'live' || dataSource === 'cached'
              ? tokensAvailable
              : null,
          last_sync_bombs: asNullableFiniteInt(row.bombs_available),
          last_sync_at: asNullableString(row.last_sync_at),
          next_token_seconds: tokenNextIn,
          next_bomb_seconds: asNullableFiniteInt(row.bomb_next_in_seconds),
          api_key_is_valid: dataSource === 'live',
          tokens_available: tokensAvailable,
          bombs_available: Math.max(0, asFiniteInt(row.bombs_available, 0)),
          token_cooldown: formatCooldownWithSeconds(tokenNextIn),
          bomb_cooldown: formatCooldownWithSeconds(
            asNullableFiniteInt(row.bomb_next_in_seconds)
          ),
          data_source: dataSource,
          last_battle_time: asNullableString(row.last_battle_time),
          battles_with_damage: asFiniteInt(row.tokens_used, 0),
          burned_tokens: asNullableFiniteInt(row.burned_tokens),
          time_over_cap_seconds: asNullableFiniteInt(row.time_over_cap_seconds),
          tokens_used: asFiniteInt(row.tokens_used, 0),
          max_possible: Math.max(0, asFiniteInt(row.max_possible, 0)),
          token_next_in_seconds: tokenNextIn
        }
      })

    // Page-load path skips Tacticus API calls. No job refreshes last_sync_*;
    // the RPC projects the last snapshot forward.
    if (skipLiveOverlay) {
      const tokensSummed = mappedRows.reduce(
        (sum, row) => sum + row.tokens_used,
        0
      )
      return {
        players: mappedRows,
        debug: {
          total_battles: tokensSummed,
          current_season_battles: tokensSummed,
          previous_season_battles: 0,
          seasons_checked: season ? [season] : [],
          live_api_fetched: 0,
          live_api_eligible: 0
        }
      }
    }

    const { liveByPlayerId, liveEligible } = await fetchLiveOverlayForRpcRows(
      supabase,
      guildCode,
      allowedPlayerIds
    )
    if (liveByPlayerId.size > 0) {
      const nowIso = new Date().toISOString()
      mappedRows.forEach((row) => {
        const live = liveByPlayerId.get(row.player_id)
        if (!live) return

        row.last_sync_tokens = live.tokensAvailable
        row.last_sync_bombs = live.bombsAvailable
        row.last_sync_at = nowIso
        row.next_token_seconds = live.tokenNextSeconds
        row.next_bomb_seconds = live.bombNextSeconds
        row.api_key_is_valid = true
        row.tokens_available = live.tokensAvailable
        row.bombs_available = live.bombsAvailable
        row.token_cooldown = formatCooldownWithSeconds(live.tokenNextSeconds)
        row.bomb_cooldown = formatCooldownWithSeconds(live.bombNextSeconds)
        row.data_source = 'live'
        row.token_next_in_seconds = live.tokenNextSeconds
      })
    }

    const tokensSummed = mappedRows.reduce(
      (sum, row) => sum + row.tokens_used,
      0
    )
    const liveCount = mappedRows.filter(
      (row) => row.data_source === 'live'
    ).length

    return {
      players: mappedRows,
      debug: {
        total_battles: tokensSummed,
        current_season_battles: tokensSummed,
        previous_season_battles: 0,
        seasons_checked: season ? [season] : [],
        live_api_fetched: liveCount,
        live_api_eligible: liveEligible
      }
    }
  } catch (error) {
    rethrowIfAppError(error)
    if (desktop) throw error
    logger.warn(
      {
        guildCode,
        season,
        clusterCode,
        error: error instanceof Error ? error.message : String(error)
      },
      'Unexpected get_player_token_state RPC failure; using legacy fallback'
    )
    return null
  }
}

async function fetchLiveRosterPlayerIds(
  supabase: SupabaseClient,
  guildCode: string
): Promise<Set<string> | null> {
  try {
    const { data: guildConfig } = await supabase
      .from('guild_config')
      .select('guild_id, user_id, session_id, api_key_encrypted')
      .eq('guild_code', guildCode)
      .single()

    if (!guildConfig) {
      return null
    }

    const config = guildConfig as GuildConfigRow

    if (config.api_key_encrypted && config.guild_id) {
      const result = await fetchGuildMembersViaTacticus(
        config.api_key_encrypted,
        config.guild_id,
        guildCode
      )
      if (result.success && result.memberIds.length > 0) {
        return new Set(result.memberIds)
      }
    }

    // Env scraper id first: a legacy row user_id never pairs with the shared secret.
    const clientSecret = process.env.LOKI_SCRAPER_CLIENT_SECRET
    const lokiIdentity = resolveLokiIdentity(config)
    const userId = lokiIdentity.userId

    if (config.guild_id && userId && clientSecret) {
      const serviceSupabase = serviceDb()
      const lokiResult = await fetchGuildMembersViaLoki(
        guildCode,
        config.guild_id,
        userId,
        lokiIdentity.sessionId,
        clientSecret,
        serviceSupabase
      )
      if (lokiResult.members.length > 0) {
        return new Set(lokiResult.members.map((m) => m.userId))
      }
    }

    return null
  } catch (error) {
    rethrowIfAppError(error)
    logger.warn(
      {
        guildCode,
        error: error instanceof Error ? error.message : String(error)
      },
      'Failed to fetch live roster for verification'
    )
    return null
  }
}

export async function loadGuildTokenStatuses(
  supabase: SupabaseClient,
  {
    guildCode,
    season,
    clusterCode,
    verifyLiveRoster = false,
    skipLiveOverlay = false
  }: {
    guildCode: string
    season?: string | null
    clusterCode?: string | null
    verifyLiveRoster?: boolean
    skipLiveOverlay?: boolean
  }
): Promise<{
  players: PlayerTokenStatus[]
  debug: GuildTokenDebugInfo
}> {
  const desktop = getRuntimeProfile() === 'desktop'
  if (desktop) {
    // The local database adapter projects saved snapshots with canonical math.
    // Never verify a live roster or fall through to key-based legacy acquisition.
    const cached = await loadGuildTokenStatusesFromRpc(supabase, {
      guildCode,
      season,
      clusterCode,
      skipLiveOverlay: true
    })
    if (!cached) throw new Error('Saved token state is unavailable')
    return cached
  }
  let liveRosterPlayerIds: Set<string> | null = null
  if (verifyLiveRoster) {
    liveRosterPlayerIds = await fetchLiveRosterPlayerIds(supabase, guildCode)
    if (liveRosterPlayerIds) {
      logger.info(
        {
          guildCode,
          liveRosterCount: liveRosterPlayerIds.size
        },
        'Live roster verification enabled'
      )
    }
  }

  const rpcResult = await loadGuildTokenStatusesFromRpc(supabase, {
    guildCode,
    season,
    clusterCode,
    allowedPlayerIds: liveRosterPlayerIds,
    skipLiveOverlay
  })
  if (rpcResult && (rpcResult.players.length > 0 || Boolean(season))) {
    return rpcResult
  }

  const { data: members, error: membersError } = await guildRosterQuery(
    supabase,
    guildCode,
    `
      player_id,
      display_name,
      user_id,
      discord_user_id,
      last_sync_tokens,
      last_sync_bombs,
      last_sync_at,
      next_token_seconds,
      next_bomb_seconds,
      api_key_is_valid,
      tacticus_api_key_encrypted
    `
  ).order('display_name')

  if (membersError) {
    throw new Error(`Failed to fetch guild members: ${membersError.message}`)
  }

  let typedMembers = (members ?? []) as RawMemberRow[]

  if (liveRosterPlayerIds && liveRosterPlayerIds.size > 0) {
    const beforeCount = typedMembers.length
    typedMembers = typedMembers.filter((m) =>
      liveRosterPlayerIds.has(m.player_id)
    )
    const filteredCount = beforeCount - typedMembers.length
    if (filteredCount > 0) {
      logger.info(
        {
          guildCode,
          beforeCount,
          afterCount: typedMembers.length,
          filteredCount
        },
        'Filtered stale players not in live roster'
      )
    }
  }

  if (typedMembers.length === 0) {
    return {
      players: [],
      debug: {
        total_battles: 0,
        current_season_battles: 0,
        previous_season_battles: 0,
        seasons_checked: []
      }
    }
  }

  const currentSeason = season || ''

  let previousSeason = ''
  if (season) {
    const seasonNum = parseInt(season, 10)
    if (!Number.isNaN(seasonNum) && seasonNum > 0) {
      previousSeason = String(seasonNum - 1)
    } else if (season.length === 8) {
      const year = parseInt(season.substring(0, 4), 10)
      const month = parseInt(season.substring(4, 6), 10)
      const day = parseInt(season.substring(6, 8), 10)
      if (!Number.isNaN(year) && !Number.isNaN(month) && !Number.isNaN(day)) {
        const seasonDate = new Date(year, month - 1, day)
        seasonDate.setDate(seasonDate.getDate() - 15)
        const prevYear = seasonDate.getFullYear()
        const prevMonth = String(seasonDate.getMonth() + 1).padStart(2, '0')
        const prevDay = String(seasonDate.getDate()).padStart(2, '0')
        previousSeason = `${prevYear}${prevMonth}${prevDay}`
      }
    }
  }

  const buildBattleQuery = (targetSeason: string) => {
    let query = supabase
      .from('EOT_GR_data')
      .select('userId, displayName, damageType, startedOn, damageDealt')
      .eq('Guild', guildCode)
      .eq('Season', targetSeason)
      .in('damageType', ['Battle', 'Bomb'])
      .order('startedOn', { ascending: true })

    if (clusterCode) {
      query = query.eq('cluster_code', clusterCode)
    }
    return query
  }

  const [currentBattlesResult, prevBattlesResult] = await Promise.all([
    currentSeason
      ? buildBattleQuery(currentSeason)
      : Promise.resolve({ data: [], error: null }),
    previousSeason
      ? buildBattleQuery(previousSeason)
      : Promise.resolve({ data: [], error: null })
  ])

  if (currentBattlesResult.error) {
    logger.error(
      { err: currentBattlesResult.error },
      'Error fetching current battles:'
    )
  }
  if (prevBattlesResult.error) {
    logger.error(
      { err: prevBattlesResult.error },
      'Error fetching previous battles:'
    )
  }

  const battles = [
    ...(currentBattlesResult.data ?? []),
    ...(prevBattlesResult.data ?? [])
  ]
    .filter(hasReplayIdentity)
    .sort(
      (a, b) =>
        new Date(a.startedOn).getTime() - new Date(b.startedOn).getTime()
    )

  // Anchor on the EARLIEST season in the window. 8-digit date-form ids give a far-future start that
  // min(anchor, first-battle) or the non-negative regen clamp neutralizes.
  const anchorSeasonNum = Number(previousSeason || currentSeason)
  const seasonStartDate =
    Number.isFinite(anchorSeasonNum) && anchorSeasonNum > 0
      ? new Date((await getSeasonTiming(anchorSeasonNum)).seasonStart)
      : undefined
  const results: PlayerTokenStatus[] = []

  const tokenCountsByPlayer = new Map<string, number>()
  for (const battle of (currentBattlesResult.data || []).filter(
    hasReplayIdentity
  )) {
    if (battle.damageType === 'Battle' && (battle.damageDealt ?? 0) > 0) {
      const playerId = battle.userId
      tokenCountsByPlayer.set(
        playerId,
        (tokenCountsByPlayer.get(playerId) || 0) + 1
      )
    }
  }
  const maxPossible = Math.max(0, ...Array.from(tokenCountsByPlayer.values()))

  const liveTokenData = skipLiveOverlay
    ? new Map<string, LiveTokenData>()
    : await fetchLiveTokenDataForMembers(typedMembers, supabase)

  for (const member of typedMembers) {
    const liveData = liveTokenData.get(member.player_id)

    const playerBattles = battles
      .filter((b) => b.userId === member.player_id)
      .map((b) => ({
        ...b,
        damageType:
          b.damageType === 'Battle' || b.damageType === 'Bomb'
            ? b.damageType
            : ('Battle' as const)
      }))

    const currentSeasonBattles = (currentBattlesResult.data || []).filter(
      (b) => b.userId === member.player_id
    )
    const battlesWithDamage = currentSeasonBattles.filter(
      (b) => b.damageType === 'Battle'
    )
    const lastBattle = playerBattles[playerBattles.length - 1]

    if (liveData) {
      results.push({
        display_name: member.display_name,
        player_id: member.player_id,
        discord_user_id: member.discord_user_id ?? null,
        last_sync_tokens: liveData.tokensAvailable,
        last_sync_bombs: liveData.bombsAvailable,
        last_sync_at: new Date().toISOString(),
        next_token_seconds: liveData.tokenNextSeconds,
        next_bomb_seconds: liveData.bombNextSeconds,
        api_key_is_valid: true,
        tokens_available: liveData.tokensAvailable,
        bombs_available: liveData.bombsAvailable,
        token_cooldown: formatCooldownWithSeconds(liveData.tokenNextSeconds),
        bomb_cooldown: formatCooldownWithSeconds(liveData.bombNextSeconds),
        data_source: 'live',
        last_battle_time: lastBattle?.startedOn || null,
        battles_with_damage: battlesWithDamage.length,
        burned_tokens: null,
        time_over_cap_seconds: null,
        tokens_used: battlesWithDamage.length,
        max_possible: maxPossible,
        token_next_in_seconds: liveData.tokenNextSeconds
      })
    } else {
      const battleData = playerBattles
        .filter((b) => b.damageType === 'Battle' || b.damageType === 'Bomb')
        .map((b) => ({
          // Old rows may lack a name; the replay keys on userId, so keep the spend and use the roster label.
          displayName: b.displayName ?? member.display_name,
          damageType: b.damageType as 'Battle' | 'Bomb',
          startedOn: b.startedOn
        }))

      const calculated = calculateTokenAvailability(battleData, seasonStartDate)

      results.push({
        display_name: member.display_name,
        player_id: member.player_id,
        discord_user_id: member.discord_user_id ?? null,
        last_sync_tokens: member.last_sync_tokens,
        last_sync_bombs: member.last_sync_bombs,
        last_sync_at: member.last_sync_at,
        next_token_seconds: calculated.tokenNextSeconds ?? null,
        next_bomb_seconds: calculated.bombNextSeconds ?? null,
        api_key_is_valid: false,
        tokens_available: calculated.tokensAvailable,
        bombs_available: calculated.bombsAvailable,
        token_cooldown: formatCooldownWithSeconds(
          calculated.tokenNextSeconds ?? null
        ),
        bomb_cooldown: formatCooldownWithSeconds(
          calculated.bombNextSeconds ?? null
        ),
        data_source: 'calculated',
        last_battle_time: lastBattle?.startedOn || null,
        battles_with_damage: battlesWithDamage.length,
        burned_tokens: null,
        time_over_cap_seconds: null,
        tokens_used: battlesWithDamage.length,
        max_possible: maxPossible,
        token_next_in_seconds: calculated.tokenNextSeconds ?? null
      })
    }
  }

  return {
    players: results,
    debug: {
      total_battles: battles.length,
      current_season_battles: (currentBattlesResult.data || []).length,
      previous_season_battles: (prevBattlesResult.data || []).length,
      seasons_checked: [currentSeason, previousSeason].filter(Boolean),
      live_api_fetched: liveTokenData.size,
      live_api_eligible: typedMembers.filter(
        (m) => m.tacticus_api_key_encrypted
      ).length
    }
  }
}
