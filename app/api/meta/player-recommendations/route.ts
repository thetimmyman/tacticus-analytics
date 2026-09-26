import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.player-recommendations')
import {
  checkFeatureAccess,
  getUserAccessLevels
} from '@/app/lib/services/feature-release-service'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { appCache } from '@tacticus/app-core/app-cache'
import {
  buildHeroCatalog,
  HERO_MAPPINGS_SELECT
} from '@/app/lib/catalogs/heroes'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

// Auth and feature access still run per request.
const META_PLAYER_RECS_TTL_SECONDS = 5 * 60

interface PlayerTeamUsage {
  boss_type: string
  rarity: string
  encounter_index: number | null
  encounter_type: string | null
  team_hash: string
  team_composition: string
  attack_count: number
  avg_damage: number
  meta_team: string | null
}

interface MetaTeamData {
  team_hash: string
  team_composition: string
  meta_team: string | null
  damage_p75: number
  damage_p90: number
  damage_avg: number
  attack_count: number
}

interface BossComparison {
  boss_type: string
  rarity: string
  encounter_index: number | null
  encounter_type: string | null
  your_team: {
    composition: string
    avg_damage: number
    attack_count: number
    meta_team: string | null
  }
  best_alternative: {
    composition: string
    damage_avg: number
    damage_p90: number
    attack_count: number
    meta_team: string | null
    changes: string[]
  } | null
  comparison: {
    damage_difference: number
    damage_difference_pct: number
    is_optimal: boolean
    your_percentile: number
  }
}

interface RosterGap {
  hero_name: string
  appears_in_meta_teams: number
  damage_boost_potential: number
  boss_types: string[]
}

function parseHeroesFromComposition(composition: string): {
  heroes: string[]
  mow: string | null
} {
  if (!composition) return { heroes: [], mow: null }
  const parts = composition.split(' + ')
  const herosPart = parts[0] || ''
  const mow = parts[1]?.trim() || null
  const heroes = herosPart
    .split(', ')
    .map((h) => h.trim())
    .filter(Boolean)
    .sort()
  return { heroes, mow }
}

const normalizeHeroName = normalizeIdentifier

/** Stripped so "Black Abaddon" matches "Abaddon". */
const HERO_PREFIXES_TO_STRIP = ['black', 'shadowkeeper', 'tzeentchian']

function getBaseHeroName(name: string): string {
  const normalized = normalizeHeroName(name)

  for (const prefix of HERO_PREFIXES_TO_STRIP) {
    if (normalized.startsWith(prefix) && normalized.length > prefix.length) {
      return normalized.slice(prefix.length)
    }
  }

  return normalized
}

/** Exact normalized name, or either side's prefix-stripped base name. */
function playerHasHero(
  metaHeroName: string,
  playerHeroesNormalized: Set<string>,
  playerBaseNames: Set<string>
): boolean {
  const metaNormalized = normalizeHeroName(metaHeroName)
  const metaBase = getBaseHeroName(metaHeroName)

  if (playerHeroesNormalized.has(metaNormalized)) {
    return true
  }

  if (playerHeroesNormalized.has(metaBase)) {
    return true
  }

  if (playerBaseNames.has(metaNormalized)) {
    return true
  }

  if (playerBaseNames.has(metaBase)) {
    return true
  }

  return false
}

function getTeamChanges(
  current: { heroes: string[]; mow: string | null },
  recommended: { heroes: string[]; mow: string | null }
): string[] {
  const changes: string[] = []

  const currentSet = new Set(current.heroes)
  const recommendedSet = new Set(recommended.heroes)

  const removed = current.heroes.filter((h) => !recommendedSet.has(h))
  const added = recommended.heroes.filter((h) => !currentSet.has(h))

  removed.forEach((h) => changes.push(`-${h}`))
  added.forEach((h) => changes.push(`+${h}`))

  if (current.mow !== recommended.mow) {
    if (current.mow) changes.push(`-${current.mow} (MOW)`)
    if (recommended.mow) changes.push(`+${recommended.mow} (MOW)`)
  }

  return changes
}

function calculatePercentile(
  playerDmg: number,
  avg: number,
  p75: number,
  p90: number
): number {
  if (playerDmg >= p90)
    return 90 + 10 * Math.min((playerDmg - p90) / (p90 - p75 || 1), 1)
  if (playerDmg >= p75) return 75 + (15 * (playerDmg - p75)) / (p90 - p75 || 1)
  if (playerDmg >= avg) return 50 + (25 * (playerDmg - avg)) / (p75 - avg || 1)
  return Math.max(0, 50 * (playerDmg / (avg || 1)))
}

export const GET = withErrorHandler(async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const playerName = searchParams.get('player_name')
  const guildCode = searchParams.get('guild_code')
  const season = searchParams.get('season')
  const raritySet = searchParams.get('rarity_set')

  if (!playerName || !guildCode) {
    throw Errors.fromResponse(400, {
      error: 'player_name and guild_code are required'
    })
  }

  try {
    const authSupabase = await db()
    const {
      data: { user }
    } = await authSupabase.auth.getUser()

    if (!user) {
      throw Errors.fromResponse(401, { error: 'Authentication required' })
    }
    await assertUnbannedAuthUser(user)

    const accessLevels = await getUserAccessLevels(user.id)
    if (accessLevels.guild_code !== guildCode && !accessLevels.is_app_admin) {
      throw Errors.fromResponse(403, {
        error: 'You can only view recommendations for your own guild'
      })
    }

    const access = await checkFeatureAccess(user.id, 'meta_atlas')
    if (!access.has_access) {
      throw Errors.fromResponse(403, {
        error: 'Meta Atlas feature access required',
        stage: access.stage,
        reason: access.reason
      })
    }

    const cacheKey = `meta_player_recs:v1:${guildCode}:${playerName}:${season ?? ''}:${raritySet ?? ''}`
    const cached = await appCache.get<Record<string, unknown>>(cacheKey)
    if (cached !== null && cached !== undefined) {
      return NextResponse.json(cached)
    }

    const supabase = serviceDb()
    let resolvedSeason = season

    if (!resolvedSeason) {
      const { data: currentSeason, error: seasonError } =
        await supabase.rpc('get_current_season')
      if (seasonError) {
        logger.warn(
          { error: seasonError },
          'Failed to resolve current season for player recommendations'
        )
      } else {
        resolvedSeason = currentSeason
      }
    }

    const { data: playerTeamsRaw, error: playerError } = await supabase.rpc(
      'get_player_team_usage',
      {
        p_player_name: playerName,
        p_guild_code: guildCode,
        p_season: resolvedSeason ?? undefined
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

    if (!playerTeamsRaw || playerTeamsRaw.length === 0) {
      const emptyResponse = {
        player_name: playerName,
        guild_code: guildCode,
        boss_comparisons: [],
        roster_gaps: [],
        summary: { bosses_analyzed: 0, optimal_teams: 0, can_improve: 0 },
        message: 'No battle data found for this player'
      }
      await appCache.set(cacheKey, emptyResponse, META_PLAYER_RECS_TTL_SECONDS)
      return NextResponse.json(emptyResponse)
    }

    interface RpcTeamRow {
      boss_name: string | null
      boss_type: string | null
      rarity: string | null
      encounter_index: number | null
      encounter_type: string | null
      team_hash: string | null
      team_composition: string | null
      attack_count: number
      avg_damage: number
      meta_team: string | null
    }

    const playerTeams: PlayerTeamUsage[] = (playerTeamsRaw as RpcTeamRow[])
      .filter((row) => row.team_hash && row.team_composition)
      .map((row) => ({
        boss_type: row.boss_type || row.boss_name || 'Unknown',
        rarity: row.rarity || 'Unknown',
        encounter_index: row.encounter_index,
        encounter_type: row.encounter_type,
        team_hash: row.team_hash!,
        team_composition: row.team_composition!,
        attack_count: Number(row.attack_count),
        avg_damage: Number(row.avg_damage),
        meta_team: row.meta_team
      }))
      .sort((a, b) => b.attack_count - a.attack_count)

    if (playerTeams.length === 0) {
      const emptyAfterFilterResponse = {
        player_name: playerName,
        guild_code: guildCode,
        boss_comparisons: [],
        roster_gaps: [],
        summary: { bosses_analyzed: 0, optimal_teams: 0, can_improve: 0 },
        message: 'No battle data found for this player'
      }
      await appCache.set(
        cacheKey,
        emptyAfterFilterResponse,
        META_PLAYER_RECS_TTL_SECONDS
      )
      return NextResponse.json(emptyAfterFilterResponse)
    }

    const bossMap = new Map<string, PlayerTeamUsage>()
    for (const team of playerTeams) {
      const key =
        team.encounter_index == null
          ? `${team.boss_type}::${team.rarity}`
          : `${team.boss_type}::${team.rarity}::${team.encounter_index}`
      if (!bossMap.has(key)) {
        bossMap.set(key, team)
      }
    }

    const bossComparisons: BossComparison[] = []
    let optimalTeams = 0
    let canImprove = 0

    const bossRarityPairs = Array.from(bossMap.values()).map((t) => ({
      boss_type: t.boss_type,
      rarity: t.rarity,
      encounter_index: t.encounter_index
    }))
    const uniqueBossTypes = [
      ...new Set(bossRarityPairs.map((p) => p.boss_type))
    ]
    const uniqueRarities = [...new Set(bossRarityPairs.map((p) => p.rarity))]
    const uniqueEncounterIndexes = [
      ...new Set(
        bossRarityPairs
          .map((p) => p.encounter_index)
          .filter((index): index is number => typeof index === 'number')
      )
    ]
    const hasMissingEncounter = bossRarityPairs.some(
      (p) => p.encounter_index == null
    )

    let metaQuery = supabase
      .from('meta_atlas_data')
      .select(
        'team_hash, team_composition, meta_team, damage_p75, damage_p90, damage_avg, attack_count, boss_type, rarity, encounter_index, encounter_type'
      )
      .in('boss_type', uniqueBossTypes)
      .in('rarity', uniqueRarities)
      .gte('attack_count', 20)
      .order('damage_p90', { ascending: false })

    if (raritySet) {
      metaQuery = metaQuery.eq('rarity_set', raritySet)
    }

    if (!hasMissingEncounter && uniqueEncounterIndexes.length > 0) {
      metaQuery = metaQuery.in('encounter_index', uniqueEncounterIndexes)
    }

    const { data: allMetaTeams } = await metaQuery

    interface MetaTeamWithContext extends MetaTeamData {
      boss_type: string
      rarity: string
      encounter_index: number
      encounter_type: string | null
    }

    const metaByBossEncounter = new Map<string, MetaTeamWithContext[]>()
    const metaByBossRarity = new Map<string, MetaTeamWithContext[]>()
    for (const team of (allMetaTeams || []) as MetaTeamWithContext[]) {
      const encounterKey = `${team.boss_type}::${team.rarity}::${team.encounter_index}`
      if (!metaByBossEncounter.has(encounterKey)) {
        metaByBossEncounter.set(encounterKey, [])
      }
      const encounterArr = metaByBossEncounter.get(encounterKey)!
      if (encounterArr.length < 10) {
        encounterArr.push(team)
      }

      const baseKey = `${team.boss_type}::${team.rarity}`
      if (!metaByBossRarity.has(baseKey)) {
        metaByBossRarity.set(baseKey, [])
      }
      const baseArr = metaByBossRarity.get(baseKey)!
      if (baseArr.length < 10) {
        baseArr.push(team)
      }
    }

    for (const [, playerTeam] of bossMap) {
      const encounterKey =
        playerTeam.encounter_index == null
          ? null
          : `${playerTeam.boss_type}::${playerTeam.rarity}::${playerTeam.encounter_index}`
      const baseKey = `${playerTeam.boss_type}::${playerTeam.rarity}`
      const metaTeams = encounterKey
        ? metaByBossEncounter.get(encounterKey) || []
        : metaByBossRarity.get(baseKey) || []

      if (metaTeams.length === 0) {
        bossComparisons.push({
          boss_type: playerTeam.boss_type,
          rarity: playerTeam.rarity,
          encounter_index: playerTeam.encounter_index,
          encounter_type: playerTeam.encounter_type,
          your_team: {
            composition: playerTeam.team_composition,
            avg_damage: Math.round(playerTeam.avg_damage),
            attack_count: playerTeam.attack_count,
            meta_team: playerTeam.meta_team
          },
          best_alternative: null,
          comparison: {
            damage_difference: 0,
            damage_difference_pct: 0,
            is_optimal: true,
            your_percentile: 50
          }
        })
        optimalTeams++
        continue
      }

      const topMetaTeam = metaTeams[0]
      if (!topMetaTeam) {
        bossComparisons.push({
          boss_type: playerTeam.boss_type,
          rarity: playerTeam.rarity,
          encounter_index: playerTeam.encounter_index,
          encounter_type: playerTeam.encounter_type,
          your_team: {
            composition: playerTeam.team_composition,
            avg_damage: Math.round(playerTeam.avg_damage),
            attack_count: playerTeam.attack_count,
            meta_team: playerTeam.meta_team
          },
          best_alternative: null,
          comparison: {
            damage_difference: 0,
            damage_difference_pct: 0,
            is_optimal: true,
            your_percentile: 50
          }
        })
        optimalTeams++
        continue
      }
      const playerPercentile = calculatePercentile(
        playerTeam.avg_damage,
        topMetaTeam.damage_avg,
        topMetaTeam.damage_p75,
        topMetaTeam.damage_p90
      )

      const isUsingTopTeam = playerTeam.team_hash === topMetaTeam.team_hash
      const damageDiff = topMetaTeam.damage_avg - playerTeam.avg_damage
      const isOptimal =
        isUsingTopTeam || damageDiff <= 0 || playerPercentile >= 75

      let bestAlt: BossComparison['best_alternative'] = null

      if (!isUsingTopTeam) {
        const currentParsed = parseHeroesFromComposition(
          playerTeam.team_composition
        )
        const altParsed = parseHeroesFromComposition(
          topMetaTeam.team_composition
        )
        const changes = getTeamChanges(currentParsed, altParsed)

        bestAlt = {
          composition: topMetaTeam.team_composition,
          damage_avg: Math.round(topMetaTeam.damage_avg),
          damage_p90: Math.round(topMetaTeam.damage_p90),
          attack_count: topMetaTeam.attack_count,
          meta_team: topMetaTeam.meta_team,
          changes
        }
      }

      bossComparisons.push({
        boss_type: playerTeam.boss_type,
        rarity: playerTeam.rarity,
        encounter_index: playerTeam.encounter_index,
        encounter_type: playerTeam.encounter_type,
        your_team: {
          composition: playerTeam.team_composition,
          avg_damage: Math.round(playerTeam.avg_damage),
          attack_count: playerTeam.attack_count,
          meta_team: playerTeam.meta_team
        },
        best_alternative: bestAlt,
        comparison: {
          damage_difference: Math.round(damageDiff),
          damage_difference_pct:
            playerTeam.avg_damage > 0
              ? Math.round((damageDiff / playerTeam.avg_damage) * 100)
              : 0,
          is_optimal: isOptimal,
          your_percentile: Math.round(playerPercentile)
        }
      })

      if (isOptimal) {
        optimalTeams++
      } else {
        canImprove++
      }
    }

    bossComparisons.sort((a, b) => {
      if (a.comparison.is_optimal !== b.comparison.is_optimal) {
        return a.comparison.is_optimal ? 1 : -1
      }
      return b.comparison.damage_difference - a.comparison.damage_difference
    })

    const playerHeroes = new Set<string>()
    for (const team of playerTeams as PlayerTeamUsage[]) {
      const parsed = parseHeroesFromComposition(team.team_composition)
      parsed.heroes.forEach((h) => playerHeroes.add(h))
      if (parsed.mow) playerHeroes.add(parsed.mow)
    }

    // The browser catalog singleton is not request-appropriate on the server.
    const { data: heroMappings } = await supabase
      .from('hero_mappings')
      .select(HERO_MAPPINGS_SELECT)
    const heroCatalog = buildHeroCatalog(heroMappings)

    try {
      const authSupabase = await db()
      const {
        data: { user }
      } = await authSupabase.auth.getUser()

      if (user) {
        await assertUnbannedAuthUser(user)
        const { data: profile } = await supabase
          .from('player_mapping')
          .select('tacticus_api_key_encrypted')
          .eq('user_id', user.id)
          .eq('is_current', true)
          .single()

        if (profile?.tacticus_api_key_encrypted) {
          const apiKey = await getPlayerApiKey(profile)
          if (apiKey) {
            const playerData = await tacticusAPI.getPlayer(apiKey)
            if (playerData?.units) {
              for (const unit of playerData.units) {
                const displayName = heroCatalog.getById(unit.id)?.displayName
                if (displayName) {
                  playerHeroes.add(displayName)
                }
                playerHeroes.add(unit.name)
              }
            }
          }
        }
      }
    } catch (rosterError) {
      logger.warn(
        { error: rosterError },
        'Could not fetch player roster for recommendations'
      )
    }

    const playerHeroesNormalized = new Set<string>()
    const playerBaseNames = new Set<string>()
    for (const heroName of playerHeroes) {
      playerHeroesNormalized.add(normalizeHeroName(heroName))
      playerBaseNames.add(getBaseHeroName(heroName))
    }

    const bossesFought = [
      ...new Set((playerTeams as PlayerTeamUsage[]).map((t) => t.boss_type))
    ]
    const heroMetaUsage = new Map<
      string,
      { count: number; bosses: Set<string>; totalDamageBoost: number }
    >()

    const { data: topMetaTeamsForRoster } = await supabase
      .from('meta_atlas_data')
      .select('team_composition, damage_avg, damage_p90, boss_type')
      .in('boss_type', bossesFought)
      .gte('attack_count', 50)
      .order('damage_p90', { ascending: false })

    interface RosterMetaTeam {
      team_composition: string
      damage_avg: number
      damage_p90: number
      boss_type: string
    }

    const topTeamsByBoss = new Map<string, RosterMetaTeam[]>()
    for (const team of (topMetaTeamsForRoster || []) as RosterMetaTeam[]) {
      if (!topTeamsByBoss.has(team.boss_type)) {
        topTeamsByBoss.set(team.boss_type, [])
      }
      const arr = topTeamsByBoss.get(team.boss_type)!
      if (arr.length < 10) {
        arr.push(team)
      }
    }

    for (const boss of bossesFought) {
      const topMetaTeams = topTeamsByBoss.get(boss) || []

      for (const metaTeam of topMetaTeams) {
        const parsed = parseHeroesFromComposition(metaTeam.team_composition)
        const allUnits = [...parsed.heroes, parsed.mow].filter(
          Boolean
        ) as string[]

        for (const unit of allUnits) {
          if (playerHasHero(unit, playerHeroesNormalized, playerBaseNames))
            continue

          if (!heroMetaUsage.has(unit)) {
            heroMetaUsage.set(unit, {
              count: 0,
              bosses: new Set(),
              totalDamageBoost: 0
            })
          }
          const data = heroMetaUsage.get(unit)!
          data.count++
          data.bosses.add(boss)
          data.totalDamageBoost += metaTeam.damage_p90
        }
      }
    }

    const rosterGaps: RosterGap[] = Array.from(heroMetaUsage.entries())
      .map(([hero, data]) => ({
        hero_name: hero,
        appears_in_meta_teams: data.count,
        damage_boost_potential: Math.round(data.totalDamageBoost / data.count),
        boss_types: Array.from(data.bosses)
      }))
      .sort((a, b) => b.appears_in_meta_teams - a.appears_in_meta_teams)
      .slice(0, 10)

    const fullResponse = {
      player_name: playerName,
      guild_code: guildCode,
      season: resolvedSeason || 'current',
      boss_comparisons: bossComparisons,
      roster_gaps: rosterGaps,
      summary: {
        bosses_analyzed: bossComparisons.length,
        optimal_teams: optimalTeams,
        can_improve: canImprove
      }
    }
    await appCache.set(cacheKey, fullResponse, META_PLAYER_RECS_TTL_SECONDS)
    return NextResponse.json(fullResponse)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { playerName, guildCode, error },
      'Player recommendations error'
    )
    throw Errors.fromResponse(500, {
      error: 'Failed to generate recommendations'
    })
  }
})
