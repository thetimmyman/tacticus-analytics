import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.roster-development.analysis')
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import {
  analyzeRoster,
  normalizeUnitName,
  type MetaAtlasTeam
} from '@/app/lib/roster-development/analysis'
import {
  buildHeroCatalog,
  HERO_MAPPINGS_SELECT,
  HeroCatalog
} from '@/app/lib/catalogs/heroes'
import { createGuildLokiClient } from '@/app/lib/loki/guild-client'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'
import {
  guildRosterQuery,
  type GuildRosterApiKeyRow
} from '@/app/lib/data/guild-roster'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

export const dynamic = 'force-dynamic'

const MAX_META_TEAMS_PER_BOSS = 10
const MIN_META_ATTACK_COUNT = 30
const API_CONCURRENCY = 4
const MAX_LOKI_FALLBACK = 10
const FALLBACK_SEASON = '83'

const chunkedMap = async <T, R>(
  items: T[],
  chunkSize: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  if (chunkSize <= 0) return []
  const results: R[] = []
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    const chunkResults = await Promise.all(chunk.map(mapper))
    results.push(...chunkResults)
  }
  return results
}

const resolveDisplayName = (
  unitId: string,
  fallbackName: string | undefined,
  heroCatalog: HeroCatalog
) => {
  const resolved = heroCatalog.getById(unitId)?.displayName
  return resolved ?? fallbackName ?? unitId
}

const extractUnitsFromPlayer = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  player: any,
  heroCatalog: HeroCatalog
) => {
  const units: string[] = []
  const rawUnits = Array.isArray(player?.units) ? player.units : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawUnits.forEach((unit: any) => {
    const unitId =
      typeof unit?.id === 'string' ? unit.id : String(unit?.id ?? '')
    if (!unitId) return
    const displayName = resolveDisplayName(unitId, unit?.name, heroCatalog)
    if (displayName) units.push(displayName)
  })

  const machinesOfWar =
    player?.machinesOfWar ||
    player?.machines_of_war ||
    player?.machineOfWar ||
    player?.machine_of_war ||
    null

  if (Array.isArray(machinesOfWar)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    machinesOfWar.forEach((unit: any) => {
      const unitId =
        typeof unit?.id === 'string' ? unit.id : String(unit?.id ?? '')
      if (!unitId) return
      const displayName = resolveDisplayName(unitId, unit?.name, heroCatalog)
      if (displayName) units.push(displayName)
    })
  }

  return units
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      throw Errors.fromResponse(401, { error: 'Authentication required' })
    }
    await assertUnbannedAuthUser(user)

    const access = await checkFeatureAccess(user.id, 'roster_development')
    if (!access.has_access) {
      throw Errors.fromResponse(403, {
        error: 'Roster development access required'
      })
    }

    const { data: profile, error: profileError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('guild_code, role')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (profileError || !profile?.guild_code) {
      throw Errors.fromResponse(403, {
        error: 'Profile not found or access denied'
      })
    }

    const guildCode = profile.guild_code

    if (!isOfficerLeaderOrAdminRole(profile.role)) {
      throw Errors.fromResponse(403, { error: 'Insufficient permissions' })
    }

    const searchParams = request.nextUrl.searchParams
    const includeLoki = searchParams.get('include_loki') === 'true'
    const requestedSeason = searchParams.get('season')

    const serviceClient = serviceDb()
    const warnings: string[] = []

    const { data: heroMappings } = await serviceClient
      .from('hero_mappings')
      .select(HERO_MAPPINGS_SELECT)
    const heroCatalog = buildHeroCatalog(heroMappings)

    // Keyed by normalizeUnitName; only display names come from the catalog.
    const canonicalNameByNormalized = new Map<string, string>()
    const heroIcons: Record<string, string> = {}

    heroCatalog.getAll().forEach((hero) => {
      canonicalNameByNormalized.set(
        normalizeUnitName(hero.displayName),
        hero.displayName
      )
      // Same precedence as resolveHeroPortrait.
      const portraitUrl = hero.portraitUrl || hero.iconUrl
      if (portraitUrl) {
        heroIcons[hero.displayName.toLowerCase()] = portraitUrl
      }
    })

    const { data: members, error: membersError } =
      await guildRosterQuery<GuildRosterApiKeyRow>(
        serviceClient,
        guildCode,
        'player_id, display_name, tacticus_api_key_encrypted, api_key_is_valid'
      ).order('display_name')

    if (membersError || !members) {
      logger.error(
        { error: membersError },
        'Roster development: failed to load guild members'
      )
      throw Errors.fromResponse(500, { error: 'Failed to load guild members' })
    }

    const membersTotal = members.length
    const membersWithApiKey = members.filter(
      (member) =>
        member.tacticus_api_key_encrypted && member.api_key_is_valid !== false
    )

    const rosterSet = new Set<string>()
    let rosterMemberCount = 0

    const apiRosterResults = await chunkedMap(
      membersWithApiKey,
      API_CONCURRENCY,
      async (member) => {
        const apiKey = await getPlayerApiKey(member)
        if (!apiKey) return null
        const player = await tacticusAPI.getPlayer(apiKey)
        if (!player) return null
        const units = extractUnitsFromPlayer(player, heroCatalog)
        if (units.length === 0) return null
        return { playerId: member.player_id, units }
      }
    )

    apiRosterResults.forEach((result) => {
      if (!result) return
      rosterMemberCount += 1
      result.units.forEach((unit) => {
        const normalized = normalizeUnitName(unit)
        if (normalized) rosterSet.add(normalized)
      })
    })

    let lokiUsed = false
    let membersWithLoki = 0

    if (includeLoki) {
      const membersMissingRoster = members.filter(
        (member) =>
          !member.tacticus_api_key_encrypted ||
          member.api_key_is_valid === false
      )

      if (membersMissingRoster.length > 0) {
        const lokiClient = await createGuildLokiClient(serviceClient, guildCode)

        if (lokiClient) {
          const targets = membersMissingRoster.slice(0, MAX_LOKI_FALLBACK)
          const lokiResults = await chunkedMap(targets, 2, async (member) => {
            const result = await lokiClient.getPlayerInfo(member.player_id)
            if (!result.ok) {
              return null
            }
            const units = result.data?.heroInfo?.units?.units
            if (!units) return null
            const unitIds = Object.keys(units)
            if (unitIds.length === 0) return null
            const resolvedUnits = unitIds.map((unitId) =>
              resolveDisplayName(unitId, undefined, heroCatalog)
            )
            return { playerId: member.player_id, units: resolvedUnits }
          })

          lokiResults.forEach((result) => {
            if (!result) return
            lokiUsed = true
            membersWithLoki += 1
            rosterMemberCount += 1
            result.units.forEach((unit) => {
              const normalized = normalizeUnitName(unit)
              if (normalized) rosterSet.add(normalized)
            })
          })
        } else {
          warnings.push('LOKI fallback unavailable for this guild.')
        }
      }
    }

    if (membersTotal === 0) {
      return NextResponse.json({
        guild_code: guildCode,
        season: requestedSeason ?? FALLBACK_SEASON,
        summary: {
          members_total: 0,
          members_with_roster: 0,
          members_with_api_key: 0,
          members_with_loki: 0,
          roster_coverage_pct: 0,
          hero_count: 0,
          missing_heroes: 0,
          meta_teams_analyzed: 0,
          roster_complete: false,
          partial_roster: false,
          loki_used: false
        },
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        hero_icons: heroIcons,
        warnings: ['No guild members found.']
      })
    }

    const { data: seasonData } = requestedSeason
      ? { data: requestedSeason }
      : await serviceClient.rpc('get_latest_season')

    const season = seasonData || requestedSeason || FALLBACK_SEASON

    const { data: metaData, error: metaError } = await serviceClient
      .from('meta_atlas_data')
      .select(
        'boss_type, team_composition, damage_p90, damage_avg, attack_count, rarity, rarity_set'
      )
      .eq('season', season)
      .gte('attack_count', MIN_META_ATTACK_COUNT)
      .not('team_composition', 'is', null)
      .order('damage_p90', { ascending: false })

    if (metaError || !metaData) {
      logger.error(
        { error: metaError },
        'Roster development: failed to load meta atlas data'
      )
      warnings.push(
        'Meta Atlas data unavailable. Showing roster coverage only.'
      )
    }

    const bossCounts = new Map<string, number>()
    const selectedTeams: MetaAtlasTeam[] = []

    if (metaData) {
      metaData.forEach((team) => {
        const count = bossCounts.get(team.boss_type) ?? 0
        if (count >= MAX_META_TEAMS_PER_BOSS) return
        bossCounts.set(team.boss_type, count + 1)
        selectedTeams.push(team)
      })
    }

    const analysis = analyzeRoster({
      teams: selectedTeams,
      roster: rosterSet,
      canonicalNameByNormalized
    })

    const rosterCoveragePct =
      membersTotal > 0
        ? Math.round((rosterMemberCount / membersTotal) * 100)
        : 0

    const rosterComplete =
      membersTotal > 0 && rosterMemberCount === membersTotal
    const partialRoster =
      rosterMemberCount > 0 && rosterMemberCount < membersTotal

    return NextResponse.json({
      guild_code: guildCode,
      season,
      summary: {
        members_total: membersTotal,
        members_with_roster: rosterMemberCount,
        members_with_api_key: membersWithApiKey.length,
        members_with_loki: membersWithLoki,
        roster_coverage_pct: rosterCoveragePct,
        hero_count: rosterSet.size,
        missing_heroes: analysis.gaps.length,
        meta_teams_analyzed: analysis.meta_teams_analyzed,
        roster_complete: rosterComplete,
        partial_roster: partialRoster,
        loki_used: lokiUsed
      },
      gaps: analysis.gaps,
      development_priorities: analysis.development_priorities,
      coverage_by_boss: analysis.coverage_by_boss,
      recommendations_by_boss: analysis.recommendations_by_boss,
      hero_icons: heroIcons,
      warnings
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Roster development analysis error')
    throw Errors.fromResponse(500, {
      error: 'Failed to generate roster analysis'
    })
  }
})
