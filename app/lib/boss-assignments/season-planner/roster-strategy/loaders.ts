import 'server-only'

import { mapMember } from './shared'
import type {
  RosterStrategyGuild,
  RosterStrategyMember,
  StrategyBattleRow,
  SupabaseService
} from './types'

export const loadGuilds = async (
  service: SupabaseService,
  targetGuildCode: string
): Promise<{ guilds: RosterStrategyGuild[]; clusterCode: string | null }> => {
  const { data: targetGuild, error: targetError } = await service
    .from('guild_config')
    .select('guild_code, display_name, cluster_code, cluster_id, timezone')
    .eq('guild_code', targetGuildCode)
    .eq('enabled', true)
    .maybeSingle()

  if (targetError) {
    throw new Error(`Failed to load guild config: ${targetError.message}`)
  }
  if (!targetGuild) {
    throw new Error('Target guild is not enabled for roster strategy.')
  }

  const clusterId =
    typeof targetGuild?.cluster_id === 'string' &&
    targetGuild.cluster_id.trim().length > 0
      ? targetGuild.cluster_id.trim()
      : null
  const clusterCode =
    clusterId &&
    typeof targetGuild?.cluster_code === 'string' &&
    targetGuild.cluster_code.trim().length > 0
      ? targetGuild.cluster_code.trim()
      : null

  let query = service
    .from('guild_config')
    .select('guild_code, display_name, cluster_code, timezone')
    .eq('enabled', true)
    .order('guild_code')

  if (clusterId) {
    query = query.eq('cluster_id', clusterId)
  } else {
    query = query.eq('guild_code', targetGuildCode)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to load cluster guilds: ${error.message}`)

  const guilds = (
    (data ?? []) as Array<{
      guild_code: string | null
      display_name: string | null
      cluster_code: string | null
      timezone: string | null
    }>
  )
    .filter((row) => typeof row.guild_code === 'string' && row.guild_code)
    .map((row) => ({
      guildCode: row.guild_code!,
      displayName: row.display_name ?? null,
      clusterCode: row.cluster_code ?? null,
      timeZone: row.timezone || 'UTC'
    }))

  if (!guilds.some((guild) => guild.guildCode === targetGuildCode)) {
    guilds.push({
      guildCode: targetGuildCode,
      displayName: targetGuild?.display_name ?? null,
      clusterCode,
      timeZone: targetGuild?.timezone || 'UTC'
    })
  }

  return { guilds, clusterCode }
}

export const loadMembers = async (
  service: SupabaseService,
  guildCodes: string[]
): Promise<RosterStrategyMember[]> => {
  const { data, error } = await service
    .from('player_mapping')
    .select('id, player_id, display_name, guild_code, role')
    .in('guild_code', guildCodes)
    .eq('is_current', true)
    .order('guild_code')
    .order('display_name')

  if (error) throw new Error(`Failed to load cluster members: ${error.message}`)

  return ((data ?? []) as Parameters<typeof mapMember>[0][])
    .map(mapMember)
    .filter((member): member is RosterStrategyMember => Boolean(member))
}

export const loadBattleRows = async (args: {
  service: SupabaseService
  guildCodes: string[]
  playerIds: string[]
  seasons: string[]
}): Promise<StrategyBattleRow[]> => {
  const guildCodes = Array.from(
    new Set(args.guildCodes.map((code) => code.trim()).filter(Boolean))
  )
  const playerIds = Array.from(
    new Set(args.playerIds.map((id) => id.trim()).filter(Boolean))
  )
  const seasons = Array.from(
    new Set(args.seasons.map((season) => season.trim()).filter(Boolean))
  )

  if (
    guildCodes.length === 0 ||
    playerIds.length === 0 ||
    seasons.length === 0
  ) {
    return []
  }

  const pageSize = 1_000
  const playerChunkSize = 40
  const rows: StrategyBattleRow[] = []

  for (const guildCode of guildCodes) {
    for (const season of seasons) {
      for (
        let playerOffset = 0;
        playerOffset < playerIds.length;
        playerOffset += playerChunkSize
      ) {
        const playerChunk = playerIds.slice(
          playerOffset,
          playerOffset + playerChunkSize
        )
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await args.service
            .from('EOT_GR_data')
            .select(
              'userId, displayName, Guild, damageType, startedOn, damageDealt, Name, encounterId, rarity, set, Season'
            )
            .eq('Guild', guildCode)
            .eq('Season', season)
            .in('damageType', ['Battle', 'Bomb'])
            .in('userId', playerChunk)
            .order('startedOn', { ascending: false })
            .range(from, from + pageSize - 1)
          if (error) {
            throw new Error(
              `Failed to load battle history for guild ${guildCode} season ${season}: ${error.message}`
            )
          }

          const page = ((data ?? []) as StrategyBattleRow[]).filter(
            (row) => row?.userId && row?.startedOn
          )
          rows.push(...page)
          if ((data ?? []).length < pageSize) break
        }
      }
    }
  }

  return rows
}
