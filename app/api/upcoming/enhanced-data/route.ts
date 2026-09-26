import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { requireRoleForApi } from '@/app/lib/auth'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.upcoming.enhanced-data')
import { apiCache } from '@tacticus/app-core/unified-cache'
import { appCache } from '@tacticus/app-core/app-cache'
import {
  CACHE_BACKEND_GATES,
  enhancedDataKey
} from '@/app/lib/api/cached-responses'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { EOTGRData } from '@tacticus/app-core/types'

interface MetaTeamRecord {
  player_id: string | null
  display_name: string | null
  primary_team: string | null
  secondary_team: string | null
  tertiary_team: string | null
}

type BattleRow = Pick<
  EOTGRData,
  'userId' | 'displayName' | 'damageDealt' | 'encounterId'
>

// Bounds response size and aggregation cost (~2MB); fits 30 players × 5 seasons × 130 encounters.
const RELIABILITY_ROW_LIMIT = 20000

// Shared Redis appCache, so post-sync invalidation reaches every replica.
const ENHANCED_DATA_TTL_MS = 10 * 60 * 1000
// appCache.set takes seconds.
const ENHANCED_DATA_TTL_SECONDS = 10 * 60

interface EnhancedDataPayload {
  reliability: Record<string, number>
  metaTeams: Record<
    string,
    { primary?: string; secondary?: string; tertiary?: string }
  >
  teamCompositions: Record<string, unknown>[]
  success: true
}

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async () => {
  try {
    const authData = await requireRoleForApi('officer')
    const profile = authData.profile

    if (!canManageHeraldRole(profile?.role)) {
      throw Errors.forbidden('Access denied')
    }

    if (!profile.guild_code) {
      throw Errors.forbidden('No guild code available')
    }

    const guildCode = profile.guild_code
    // Shared with the cross-pod evictor so keys cannot drift.
    const cacheKey = enhancedDataKey(guildCode)

    let payload: EnhancedDataPayload
    if (CACHE_BACKEND_GATES.enhancedData === 'apiCache') {
      // Rollback path; caching degraded payloads is harmless in a per-pod cache.
      payload = (await apiCache.getOrFetch(
        cacheKey,
        () => buildEnhancedDataPayload(guildCode).then((r) => r.payload),
        {
          ttl: ENHANCED_DATA_TTL_MS,
          priority: 'high',
          tags: ['enhanced_data', guildCode]
        }
      )) as EnhancedDataPayload
    } else {
      // appCache returns null on a Redis outage, so it is never a hard dependency.
      const cached = await appCache.get<EnhancedDataPayload>(cacheKey)
      if (cached !== null && cached !== undefined) {
        payload = cached
      } else {
        const { payload: built, degraded } =
          await buildEnhancedDataPayload(guildCode)
        payload = built
        // Never cache a degraded payload: the shared cache would pin it everywhere for the TTL.
        if (!degraded) {
          await appCache.set(cacheKey, built, ENHANCED_DATA_TTL_SECONDS)
        }
      }
    }

    return NextResponse.json(payload)
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in enhanced-data route:')
    throw Errors.internal('Internal server error')
  }
})

async function buildEnhancedDataPayload(
  guildCode: string
): Promise<{ payload: EnhancedDataPayload; degraded: boolean }> {
  const supabase = serviceDb()

  // Computed inline: player_reliability_scores has a different shape.
  const [reliabilityResult, metaTeamResult, teamCompositionResult] =
    await Promise.all([
      supabase
        .from('EOT_GR_data')
        .select('userId, displayName, damageDealt, encounterId')
        .eq('Guild', guildCode)
        .eq('damageType', 'Battle')
        .order('startedOn', { ascending: false })
        .limit(RELIABILITY_ROW_LIMIT),
      guildRosterQuery(
        supabase,
        guildCode,
        'player_id, display_name, primary_team, secondary_team, tertiary_team'
      ),
      supabase.rpc('get_player_team_compositions', {
        p_guild_code: guildCode,
        p_season_limit: 10
      })
    ])

  const battleRows: BattleRow[] | null = reliabilityResult.data ?? null
  const reliabilityError = reliabilityResult.error
  if (reliabilityError) {
    logger.error(
      { err: reliabilityError },
      'Error fetching reliability scores:'
    )
  }

  const metaTeamData = (metaTeamResult.data ?? null) as MetaTeamRecord[] | null
  const metaTeamError = metaTeamResult.error
  if (metaTeamError) {
    logger.error({ err: metaTeamError }, 'Error fetching meta team data:')
  }

  const teamCompositionData = (teamCompositionResult.data ?? null) as
    Record<string, unknown>[] | null
  const teamError = teamCompositionResult.error
  if (teamError) {
    logger.error({ err: teamError }, 'Error fetching team compositions:')
  }

  const metaTeamRows: MetaTeamRecord[] = metaTeamData ?? []

  // numeric columns can arrive as strings.
  const parseDamage = (value: string | number | null): number => {
    if (value === null || value === undefined) return 0
    const n = typeof value === 'string' ? Number(value) : value
    return Number.isFinite(n) ? n : 0
  }

  type EncounterKey = string | number
  const encountersByUserId = new Map<
    string,
    { encounters: Map<EncounterKey, boolean>; displayName: string | null }
  >()
  const encountersByDisplayName = new Map<string, Map<EncounterKey, boolean>>()
  // Rows without an encounterId count as their own encounter.
  let syntheticEncounterCounter = 0

  for (const row of battleRows ?? []) {
    const isNonZero = parseDamage(row.damageDealt) > 0
    const encounterKey: EncounterKey =
      row.encounterId ?? `__row_${syntheticEncounterCounter++}`

    if (row.userId) {
      const agg = encountersByUserId.get(row.userId) ?? {
        encounters: new Map<EncounterKey, boolean>(),
        displayName: row.displayName
      }
      agg.encounters.set(
        encounterKey,
        (agg.encounters.get(encounterKey) ?? false) || isNonZero
      )
      if (!agg.displayName && row.displayName) agg.displayName = row.displayName
      encountersByUserId.set(row.userId, agg)
    } else if (row.displayName) {
      const encs =
        encountersByDisplayName.get(row.displayName) ??
        new Map<EncounterKey, boolean>()
      encs.set(encounterKey, (encs.get(encounterKey) ?? false) || isNonZero)
      encountersByDisplayName.set(row.displayName, encs)
    }
  }

  const scoreFromEncounters = (
    encs: Map<EncounterKey, boolean>
  ): number | null => {
    if (encs.size === 0) return null
    let nonZero = 0
    for (const ok of encs.values()) if (ok) nonZero++
    return (nonZero / encs.size) * 100
  }

  const userIdToCurrentDisplayName = new Map<string, string>()
  for (const item of metaTeamRows) {
    if (item.player_id && item.display_name) {
      userIdToCurrentDisplayName.set(item.player_id, item.display_name)
    }
  }

  const reliabilityMap: Record<string, number> = {}
  for (const [userId, agg] of encountersByUserId) {
    const score = scoreFromEncounters(agg.encounters)
    if (score === null) continue
    const currentName =
      userIdToCurrentDisplayName.get(userId) ?? agg.displayName
    if (currentName) {
      reliabilityMap[currentName] = score
    }
  }
  for (const [displayName, encs] of encountersByDisplayName) {
    if (reliabilityMap[displayName] !== undefined) continue
    const score = scoreFromEncounters(encs)
    if (score === null) continue
    reliabilityMap[displayName] = score
  }

  const metaTeamMap: Record<
    string,
    { primary?: string; secondary?: string; tertiary?: string }
  > = {}
  metaTeamRows.forEach((item) => {
    if (item.display_name) {
      metaTeamMap[item.display_name] = {
        primary: item.primary_team ?? undefined,
        secondary: item.secondary_team ?? undefined,
        tertiary: item.tertiary_team ?? undefined
      }
    }
  })

  const teamCompositions = teamCompositionData ?? []

  // A sub-query failed: the payload is partial despite success: true, so it is not cached.

  const degraded = Boolean(reliabilityError || metaTeamError || teamError)

  return {
    payload: {
      reliability: reliabilityMap,
      metaTeams: metaTeamMap,
      teamCompositions,
      success: true
    },
    degraded
  }
}
