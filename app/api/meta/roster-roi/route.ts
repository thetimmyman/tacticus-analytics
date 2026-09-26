import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { resolveDagProgression } from '@/app/lib/meta/dag-progression'
import {
  parseRosterPayload,
  type RosterInputEntry
} from '@/app/lib/meta/roster-input'
import {
  normalizeCurrentTeams,
  type CurrentTeamInput
} from '@/app/lib/meta/current-team-input'
import {
  buildRosterLookup,
  evaluateStrengthState,
  fetchStrengthThresholds,
  type StrengthState
} from '@/app/lib/meta/roster-strength'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.meta.roster-roi')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

/** 0 or negative limits still return a row. */
const MIN_RESOLVED_LIMIT = 1 as const

type RoiAggregate = {
  hero_name: string
  unlock_count: number
  total_damage_gain: number
  bosses: string[]
  investment_state: StrengthState | null
}

type RoiAccumulator = {
  heroName: string
  count: number
  totalDamage: number
  bosses: Set<string>
  worstState: StrengthState | null
}

const INVESTMENT_STATES = new Set<StrengthState>([
  'Locked',
  'Weak',
  'Suitable',
  'Strong'
])

const STATE_PRIORITY: Record<StrengthState, number> = {
  Locked: 0,
  Weak: 1,
  Suitable: 2,
  Strong: 3,
  Optimal: 4,
  Invalid: 5
}

const pickWorstState = (
  current: StrengthState | null,
  incoming: StrengthState
): StrengthState => {
  if (!current) return incoming
  return STATE_PRIORITY[incoming] < STATE_PRIORITY[current] ? incoming : current
}

const parseTeamUnits = (composition: string | null | undefined): string[] => {
  if (!composition) return []
  const parts = composition.split(' + ')
  const heroPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null
  const units = heroPart
    .split(',')
    .map((unit) => unit.trim())
    .filter(Boolean)
  if (mowPart) {
    units.push(mowPart)
  }
  return units
}

export const POST = withErrorHandler(async (request: Request) => {
  try {
    let body: unknown = null
    try {
      body = await request.json()
    } catch {
      throw Errors.validation('Invalid request body', {
        endpoint: '/api/meta/roster-roi'
      })
    }
    const {
      roster,
      season,
      min_attacks = 20,
      limit = 6,
      current_teams
    } = (body || {}) as {
      roster?: RosterInputEntry[]
      season?: string
      min_attacks?: number
      limit?: number
      current_teams?: unknown
    }

    const resolvedMinAttacks =
      typeof min_attacks === 'number'
        ? min_attacks
        : parseInt(String(min_attacks), 10) || 20
    const resolvedLimit =
      typeof limit === 'number' ? limit : parseInt(String(limit), 10) || 6

    const { roster: rosterList, error: rosterError } =
      parseRosterPayload(roster)
    if (rosterError) {
      throw Errors.validation(rosterError)
    }
    const rosterEntries = rosterList ?? []
    if (rosterEntries.length === 0) {
      return NextResponse.json({
        season: season || 'current',
        results: [],
        message: 'Roster is required to compute ROI'
      })
    }

    const rosterLookup = buildRosterLookup(rosterEntries)
    if (!rosterLookup.hasStrengthData) {
      return NextResponse.json({
        season: season || 'current',
        results: [],
        message:
          'Roster strength data is missing. Re-sync your API key to include rank and ability levels.'
      })
    }

    const authSupabase = await db()
    const {
      data: { user }
    } = await authSupabase.auth.getUser()

    if (!user) {
      throw Errors.unauthorized('Authentication required')
    }
    await assertUnbannedAuthUser(user)

    const access = await checkFeatureAccess(user.id, 'meta_atlas')
    if (!access.has_access) {
      throw Errors.forbidden('Meta Atlas feature access required', {
        stage: access.stage,
        reason: access.reason
      })
    }

    const { data: profile } = await authSupabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('display_name, guild_code')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (!profile?.display_name || !profile?.guild_code) {
      throw Errors.validation(
        'Player profile not found. Complete your profile to enable ROI.'
      )
    }

    const supabase = serviceDb()
    let resolvedSeason = season

    if (!resolvedSeason) {
      const { data: currentSeason, error: seasonError } =
        await supabase.rpc('get_current_season')
      if (seasonError) {
        logger.warn(
          { error: seasonError },
          'Failed to resolve current season for roster ROI'
        )
      } else {
        resolvedSeason = currentSeason
      }
    }

    let currentTeamsLookup = normalizeCurrentTeams(current_teams)

    if (currentTeamsLookup.size === 0) {
      const { data: playerTeams, error: playerError } = await supabase.rpc(
        'get_player_team_usage',
        {
          p_player_name: profile.display_name,
          p_guild_code: profile.guild_code,
          p_season: resolvedSeason || ''
        }
      )

      if (playerError) {
        logger.error({ error: playerError }, 'Player teams error')
        throw Errors.internal('Failed to fetch player team usage', {
          details: playerError.message
        })
      }

      const bossMap = new Map<
        string,
        CurrentTeamInput & { attack_count: number; avg_damage: number }
      >()
      for (const team of (playerTeams || []) as Array<{
        boss_type: string | null
        team_composition: string | null
        team_hash: string | null
        encounter_index: number | null
        rarity_set: string | null
        attack_count: number | null
        avg_damage: number | null
      }>) {
        if (
          !team.boss_type ||
          !team.team_hash ||
          team.attack_count === null ||
          team.avg_damage === null
        )
          continue

        const existing = bossMap.get(team.boss_type)
        const shouldReplace =
          !existing ||
          team.attack_count > existing.attack_count ||
          (team.attack_count === existing.attack_count &&
            team.avg_damage > existing.avg_damage)

        if (shouldReplace) {
          bossMap.set(team.boss_type, {
            boss_type: team.boss_type,
            current_team: team.team_composition,
            current_team_hash: team.team_hash,
            encounter_index:
              typeof team.encounter_index === 'number'
                ? team.encounter_index
                : null,
            rarity_set:
              typeof team.rarity_set === 'string' ? team.rarity_set : null,
            season: resolvedSeason || null,
            attack_count: team.attack_count,
            avg_damage: team.avg_damage
          })
        }
      }

      currentTeamsLookup = new Map(
        Array.from(bossMap.entries()).map(([bossType, entry]) => [
          bossType,
          {
            boss_type: entry.boss_type,
            current_team: entry.current_team,
            current_team_hash: entry.current_team_hash,
            encounter_index: entry.encounter_index ?? null,
            rarity_set: entry.rarity_set ?? null,
            season: entry.season ?? null
          }
        ])
      )
    }

    if (currentTeamsLookup.size === 0) {
      return NextResponse.json({
        season: resolvedSeason || 'current',
        results: [],
        message: 'No current teams available for ROI'
      })
    }

    const roiMap = new Map<string, RoiAccumulator>()
    let hasInvalidStrength = false

    const progressionResults = await Promise.all(
      Array.from(currentTeamsLookup.values()).map(async (currentTeam) => {
        if (!currentTeam.current_team && !currentTeam.current_team_hash)
          return null
        const progression = await resolveDagProgression(
          supabase,
          {
            bossType: currentTeam.boss_type,
            encounterIndex: currentTeam.encounter_index ?? null,
            raritySet: currentTeam.rarity_set ?? null,
            season: currentTeam.season ?? resolvedSeason ?? null,
            currentTeam: currentTeam.current_team ?? null,
            currentTeamHash: currentTeam.current_team_hash ?? null,
            roster: rosterEntries,
            minAttacks: resolvedMinAttacks
          },
          { requireCurrentTeam: true }
        )

        if ('error' in progression) {
          return null
        }

        return progression
      })
    )

    const normalizeUnitKey = normalizeIdentifier

    for (const progression of progressionResults) {
      if (!progression) continue
      const bossKey = progression.boss_type || 'Unknown'
      const totalIncrease =
        typeof progression.total_damage_increase === 'number'
          ? progression.total_damage_increase
          : (progression.upgrade_path || []).reduce(
              (sum, step) =>
                sum + Number(step.damage_gain ?? step.damage_increase ?? 0),
              0
            )
      const resolvedIncrease =
        Number.isFinite(totalIncrease) && totalIncrease > 0 ? totalIncrease : 0
      const filters = progression.filters
      const strengthThresholds = await fetchStrengthThresholds({
        bossName: null,
        bossType: progression.boss_type ?? null,
        raritySet: filters?.rarity_set ?? null,
        encounterIndex: filters?.encounter_index ?? null,
        season: filters?.season ?? null
      })

      const compositions = new Set<string>()
      if (progression.current_team) {
        compositions.add(progression.current_team)
      }
      for (const step of progression.upgrade_path || []) {
        if (step.to_team) {
          compositions.add(step.to_team)
        }
      }
      if (progression.target_team) {
        compositions.add(progression.target_team)
      }

      for (const composition of compositions) {
        const units = parseTeamUnits(composition)
        for (const unit of units) {
          const key = normalizeUnitKey(unit)
          if (!key) continue
          const rosterEntry = rosterLookup.find(unit)
          let resolvedState: StrengthState | null = null
          if (!rosterEntry) {
            resolvedState = 'Locked'
          } else {
            resolvedState =
              evaluateStrengthState(rosterEntry.raw, strengthThresholds) ??
              'Invalid'
          }

          if (resolvedState === 'Invalid') {
            hasInvalidStrength = true
            continue
          }
          if (!resolvedState || !INVESTMENT_STATES.has(resolvedState)) continue

          if (!roiMap.has(key)) {
            const resolvedName = rosterEntry?.raw?.name
              ? String(rosterEntry.raw.name)
              : unit
            roiMap.set(key, {
              heroName: resolvedName,
              count: 0,
              totalDamage: 0,
              bosses: new Set(),
              worstState: null
            })
          }

          const entry = roiMap.get(key)!
          entry.worstState = pickWorstState(entry.worstState, resolvedState)
          if (!entry.bosses.has(bossKey)) {
            entry.bosses.add(bossKey)
            entry.totalDamage += resolvedIncrease
            entry.count = entry.bosses.size
          }
        }
      }
    }

    const results: RoiAggregate[] = Array.from(roiMap.entries()).map(
      ([, data]) => ({
        hero_name: data.heroName,
        unlock_count: data.count,
        total_damage_gain: Math.round(data.totalDamage),
        bosses: Array.from(data.bosses),
        investment_state: data.worstState
      })
    )

    results.sort((a, b) => {
      if (b.unlock_count !== a.unlock_count)
        return b.unlock_count - a.unlock_count
      return b.total_damage_gain - a.total_damage_gain
    })

    const responseMessage = hasInvalidStrength
      ? 'Roster strength data is missing for some units. Re-sync your API key to include rank and ability levels.'
      : undefined

    return NextResponse.json({
      season: resolvedSeason || 'current',
      results: results.slice(0, Math.max(MIN_RESOLVED_LIMIT, resolvedLimit)),
      total_heroes: results.length,
      ...(responseMessage ? { message: responseMessage } : {})
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Roster ROI error')
    throw Errors.internal('Failed to compute roster ROI')
  }
})
