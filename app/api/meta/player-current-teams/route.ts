import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { getUserAccessLevels } from '@/app/lib/services/feature-release-service'
import { requireFeatureAccess } from '@/app/lib/services/feature-access-gate'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.player-current-teams')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

interface PlayerTeamUsage {
  boss_name: string
  boss_type: string
  rarity: string
  set_num?: number | null
  rarity_set?: string | null
  encounter_index: number
  encounter_type: string | null
  team_hash: string
  team_composition: string
  attack_count: number
  avg_damage: number
  meta_team: string | null
}

type CurrentTeamSummary = {
  boss_name: string
  boss_type: string
  rarity: string
  rarity_set: string | null
  encounter_index: number | null
  encounter_type: string | null
  current_team: string
  current_team_hash: string
  attack_count: number
  avg_damage: number
  last_battle_time: string | null
  meta_team: string | null
}

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const seasonParam = searchParams.get('season')
  const playerNameParam = searchParams.get('player_name')
  const guildCodeParam = searchParams.get('guild_code')

  try {
    const authSupabase = await db()
    const user = await requireSessionUser(authSupabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    await requireFeatureAccess(
      user.id,
      'meta_atlas',
      'Meta Atlas feature access required'
    )

    const accessLevels = await getUserAccessLevels(user.id)
    let playerName = playerNameParam
    let guildCode = guildCodeParam

    if (playerNameParam || guildCodeParam) {
      if (!playerNameParam || !guildCodeParam) {
        throw Errors.fromResponse(400, {
          error: 'player_name and guild_code are required'
        })
      }

      if (
        accessLevels.guild_code !== guildCodeParam &&
        !accessLevels.is_app_admin
      ) {
        throw Errors.fromResponse(403, {
          error: 'You can only view teams for your own guild'
        })
      }
    } else {
      const { data: profile } = await authSupabase
        .from(CURRENT_USER_PLAYER_MAPPING)
        .select('display_name, guild_code')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .single()

      playerName = profile?.display_name || null
      guildCode = profile?.guild_code || null
    }

    if (!playerName || !guildCode) {
      throw Errors.fromResponse(400, {
        error:
          'Player profile not found. Complete your profile to enable auto-detection.'
      })
    }

    const supabase = serviceDb()
    let resolvedSeason = seasonParam

    if (!resolvedSeason) {
      const { data: currentSeason, error: seasonError } =
        await supabase.rpc('get_current_season')
      if (seasonError) {
        logger.warn(
          { error: seasonError },
          'Failed to resolve current season for player-current-teams'
        )
      } else {
        resolvedSeason = currentSeason
      }
    }

    const { data: playerTeams, error: playerError } = await supabase.rpc(
      'get_player_team_usage',
      {
        p_player_name: playerName,
        p_guild_code: guildCode,
        p_season: resolvedSeason || ''
      }
    )

    if (playerError) {
      logger.error(
        { playerName, guildCode, error: playerError },
        'Player teams error'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to fetch player team usage',
        details: playerError.message
      })
    }

    if (!playerTeams || playerTeams.length === 0) {
      return NextResponse.json({
        player_name: playerName,
        guild_code: guildCode,
        season: resolvedSeason || 'current',
        current_teams: [],
        message: 'No battle data found for this player'
      })
    }

    const typedPlayerTeams = playerTeams as unknown as PlayerTeamUsage[]

    const bossNames = Array.from(
      new Set(
        typedPlayerTeams
          .map((team) => team.boss_name)
          .filter((name) => Boolean(name))
      )
    )
    const bossTypeMap = new Map<string, string>()
    if (bossNames.length > 0) {
      const { data: bossMappings } = await supabase
        .from('boss_mapping')
        .select('boss_type, boss_name, encounter_index')
        .in('boss_name', bossNames)

      for (const mapping of bossMappings || []) {
        const key = `${mapping.boss_name}|${mapping.encounter_index ?? 0}`
        bossTypeMap.set(key, mapping.boss_type)
      }
    }

    const bossMap = new Map<string, PlayerTeamUsage>()
    for (const team of typedPlayerTeams) {
      const mappingKey = `${team.boss_name}|${team.encounter_index ?? 0}`
      const mappedBossType = bossTypeMap.get(mappingKey) || team.boss_type
      const key = mappedBossType
      const existing = bossMap.get(key)
      const shouldReplace =
        !existing ||
        team.attack_count > existing.attack_count ||
        (team.attack_count === existing.attack_count &&
          team.avg_damage > existing.avg_damage)

      if (shouldReplace) {
        bossMap.set(key, { ...team, boss_type: mappedBossType })
      }
    }

    const lastBattleTimes = new Map<string, string | null>()

    if (bossNames.length > 0) {
      let battleQuery = supabase
        .from('EOT_GR_data')
        .select('Name, completedOn, timestamp')
        .eq('displayName', playerName)
        .eq('Guild', guildCode)
        .in('damageType', ['Battle', 'Bomb'])
        .in('Name', bossNames)
        .order('startedOn', { ascending: false })

      if (resolvedSeason) {
        battleQuery = battleQuery.eq('Season', resolvedSeason)
      }

      const { data: battleRows } = await battleQuery

      for (const row of battleRows || []) {
        const boss = row.Name
        const timeValue = row.completedOn || row.timestamp
        if (!boss || !timeValue) continue
        const current = lastBattleTimes.get(boss)
        if (
          !current ||
          new Date(timeValue).getTime() > new Date(current).getTime()
        ) {
          lastBattleTimes.set(boss, timeValue)
        }
      }
    }

    const currentTeams: CurrentTeamSummary[] = Array.from(bossMap.values()).map(
      (team) => ({
        boss_name: team.boss_name,
        boss_type: team.boss_type,
        rarity: team.rarity,
        rarity_set:
          typeof team.rarity_set === 'string' ? team.rarity_set : null,
        encounter_index:
          typeof team.encounter_index === 'number'
            ? team.encounter_index
            : null,
        encounter_type: team.encounter_type ?? null,
        current_team: team.team_composition,
        current_team_hash: team.team_hash,
        attack_count: Number(team.attack_count) || 0,
        avg_damage: Math.round(Number(team.avg_damage) || 0),
        last_battle_time: lastBattleTimes.get(team.boss_name) || null,
        meta_team: team.meta_team ?? null
      })
    )

    return NextResponse.json({
      player_name: playerName,
      guild_code: guildCode,
      season: resolvedSeason || 'current',
      current_teams: currentTeams
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Player current teams error')
    throw Errors.fromResponse(500, { error: 'Failed to load current teams' })
  }
})
