import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.playerstats.hooks.data-fetchers.fetchAvailablePlayers'
)
import { logQuery } from '@tacticus/app-core/performance-monitor'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface FetchAvailablePlayersParams {
  supabase: SupabaseClient
  season: string
  guild: string
  userRole: string
  userDisplayName: string
  clusterCode: string
  isRestricted: boolean
}

export interface FetchAvailablePlayersResult {
  players: string[]
  guildMap: Record<string, string>
}

export async function fetchAvailablePlayers(
  params: FetchAvailablePlayersParams
): Promise<FetchAvailablePlayersResult> {
  const {
    supabase,
    season,
    guild,
    userRole,
    userDisplayName,
    clusterCode,
    isRestricted
  } = params

  if (!season) {
    return { players: [], guildMap: {} }
  }

  if (isRestricted && userDisplayName) {
    return {
      players: [userDisplayName],
      guildMap: { [userDisplayName]: guild }
    }
  }

  try {
    logQuery('PlayerStatsController', 'fetchAvailablePlayers')

    const guildAccumulator = new Set<string>()
    if (guild) {
      guildAccumulator.add(guild)
    }

    let players: { display_name: string; guild_code?: string | null }[] = []
    const role = (userRole || '').toLowerCase()

    const fetchMapping = async (guilds: string[]) => {
      const { data, error } = await supabase
        .from('player_mapping')
        .select('display_name, guild_code')
        .in('guild_code', guilds)
        .eq('is_current', true)

      if (error) throw error
      return data ?? []
    }

    if (role === 'member') {
      if (userDisplayName) {
        players = [{ display_name: userDisplayName, guild_code: guild }]
      }
    } else if (role === 'officer') {
      players = await fetchMapping([guild])
    } else if (role === 'leader') {
      if (clusterCode) {
        const { data: guildRows, error: guildError } = await supabase
          .from('guild_config')
          .select('guild_code')
          .eq('cluster_code', clusterCode)
          .eq('enabled', true)

        if (guildError) throw guildError

        const guildCodes = (guildRows || []).map((row) => row.guild_code)
        if (guildCodes.length === 0) {
          guildCodes.push(guild)
        }
        guildCodes.forEach((code) => {
          if (code) guildAccumulator.add(code)
        })

        players = await fetchMapping(guildCodes)
      } else {
        players = await fetchMapping([guild])
      }
    } else {
      players = await fetchMapping([guild])
    }

    players.forEach((player) => {
      if (player.guild_code) {
        guildAccumulator.add(String(player.guild_code))
      }
    })

    const guildList = Array.from(guildAccumulator).filter(Boolean)
    if (guildList.length > 0) {
      const { data: battlePlayers, error: battleError } = await supabase
        .from('EOT_GR_data')
        .select('displayName, Guild')
        .in('Guild', guildList)
        .eq('Season', season)
        .eq('damageType', 'Battle')
        .in('rarity', ['Legendary', 'Mythic'])
        .gt('damageDealt', 0)
        .order('startedOn', { ascending: false })
        .limit(5000)

      if (!battleError && Array.isArray(battlePlayers)) {
        const seen = new Set(
          players.map((row) => `${row.display_name}::${row.guild_code ?? ''}`)
        )
        battlePlayers.forEach((row) => {
          if (!row.displayName) return
          const display = String(row.displayName).trim()
          if (!display) return
          const key = `${display}::${row.Guild || ''}`
          if (seen.has(key)) return
          players.push({ display_name: display, guild_code: row.Guild })
          seen.add(key)
        })
      } else if (battleError) {
        logger.warn(
          { battleError: battleError },
          'Unable to merge battle log players into search list'
        )
      }
    }

    if (!players || players.length === 0) {
      if (userDisplayName) {
        return {
          players: [userDisplayName],
          guildMap: { [userDisplayName]: guild }
        }
      }
      return { players: [], guildMap: {} }
    }

    const tempGuildMap: Record<string, string> = {}
    const playerNames = players
      .map((player) => {
        if (!player?.display_name) return null
        const name = String(player.display_name).trim()
        if (!name) return null
        if (player.guild_code) {
          tempGuildMap[name] = String(player.guild_code)
        }
        return name
      })
      .filter((name): name is string => Boolean(name))

    const uniquePlayers = Array.from(new Set(playerNames)).sort((a, b) =>
      a.localeCompare(b)
    )
    const stableGuildMap: Record<string, string> = Object.fromEntries(
      Object.entries(tempGuildMap).sort(([a], [b]) => a.localeCompare(b))
    )

    return { players: uniquePlayers, guildMap: stableGuildMap }
  } catch (error) {
    logger.error({ err: error }, 'Error in fetchAvailablePlayers')

    if (userDisplayName) {
      return {
        players: [userDisplayName],
        guildMap: { [userDisplayName]: guild }
      }
    }
    return { players: [], guildMap: {} }
  }
}
