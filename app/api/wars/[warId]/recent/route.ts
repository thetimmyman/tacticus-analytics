import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireWarAccess } from '../_shared'
import { logger } from '@/app/lib/war/logger'
import type { RecentAttempt, Unit } from '@/app/(dashboard)/wars/_types'
import { isFailedBattleRow } from '@/app/(dashboard)/wars/[warId]/board/board-utils'
import type { RawUnitsJson } from '@/app/(dashboard)/wars/[warId]/board/board-utils'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

const BATTLE_SELECT_FIELDS = `
  id,
  attacker_player_name,
  attacker_guild_name,
  defender_player_name,
  defender_guild_name,
  score_earned,
  attempt_debuff,
  attempt_end_time,
  attempt_result,
  attacker_units_json,
  defender_units_json,
  zone_id,
  kill_count,
  perfect_hit,
  is_guild_member
` as const

type BattleRow = {
  id: string
  attacker_player_name: string | null
  attacker_guild_name: string | null
  defender_player_name: string | null
  defender_guild_name: string | null
  score_earned: number | null
  attempt_debuff: number | null
  attempt_end_time: string | null
  attempt_result: string | null
  attacker_units_json: RawUnitsJson
  defender_units_json: RawUnitsJson
  zone_id: string | null
  kill_count: number | null
  perfect_hit: boolean | null
  is_guild_member: boolean | null
}

type ActivityFilter =
  | { kind: 'all' }
  | { kind: 'guild' }
  | { kind: 'opponent' }
  | { kind: 'failed' }
  | { kind: 'perfect' }

function parseActivityFilter(raw: string | null): ActivityFilter {
  switch (raw) {
    case 'guild':
      return { kind: 'guild' }
    case 'opponent':
      return { kind: 'opponent' }
    case 'failed':
      return { kind: 'failed' }
    case 'perfect':
      return { kind: 'perfect' }
    default:
      return { kind: 'all' }
  }
}

type ParsedInput = {
  warId: string
  cursor: string | null
  filter: ActivityFilter
  limit: number
}

function parseInput(warId: string, searchParams: URLSearchParams): ParsedInput {
  const limitParam = searchParams.get('limit')
  const limit = Math.min(
    Math.max(1, parseInt(limitParam || String(DEFAULT_LIMIT), 10)),
    MAX_LIMIT
  )
  return {
    warId,
    cursor: searchParams.get('cursor'),
    filter: parseActivityFilter(searchParams.get('filter')),
    limit
  }
}

function humanizeUnitId(unitId: string): string {
  return unitId
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
}

function unitShortCode(unitId: string): string {
  const uppers = unitId.replace(/[^A-Z]/g, '')
  if (uppers.length >= 2) return uppers.slice(0, 2)
  return unitId.slice(0, 2).toUpperCase()
}

/** remainingHp: positive = alive, null = dead (HP data present), undefined = no data. */
function parseUnits(json: unknown): Unit[] {
  if (!Array.isArray(json)) return []
  return json
    .filter(
      (u): u is Record<string, unknown> => u != null && typeof u === 'object'
    )
    .map((unit, index) => {
      const unitId = String(unit.unitId ?? unit.heroKey ?? `unit_${index}`)
      const hpAfter = unit.remainingHPAfter
      const hpBefore = unit.remainingHPBefore
      const startingHp = typeof hpBefore === 'number' ? hpBefore : undefined
      const remainingHp: number | null | undefined =
        typeof hpAfter === 'number'
          ? hpAfter
          : startingHp !== undefined
            ? null // had HP before but no HP after → died
            : undefined
      return {
        id: unitId,
        name: humanizeUnitId(unitId),
        shortCode: unitShortCode(unitId),
        portraitUrl: unitId.startsWith('unit_')
          ? undefined
          : `${SUPABASE_URL}/storage/v1/object/public/hero-icons/${unitId}.png`,
        remainingHp,
        startingHp
      }
    })
}

/** Priority: stored kill_count, then true-win inference, then partial-kill HP inference. */
function inferKills(row: BattleRow, failed: boolean): number {
  if (row.kill_count != null && row.kill_count > 0) return row.kill_count

  const defenders = Array.isArray(row.defender_units_json)
    ? (row.defender_units_json as Record<string, unknown>[])
    : []
  if (defenders.length === 0) return row.kill_count ?? 0

  if (!failed) {
    // Game rule: a win eliminates all defenders.
    return defenders.length
  }

  const anyHasHpAfter = defenders.some(
    (u) =>
      typeof u.remainingHPAfter === 'number' &&
      (u.remainingHPAfter as number) > 0
  )
  if (anyHasHpAfter) {
    return defenders.filter(
      (u) =>
        !(
          typeof u.remainingHPAfter === 'number' &&
          (u.remainingHPAfter as number) > 0
        )
    ).length
  }

  return 0
}

function buildBattleQuery(
  supabase: SupabaseClient,
  warId: string,
  guildCode: string,
  { filter, cursor, limit }: Pick<ParsedInput, 'filter' | 'cursor' | 'limit'>
) {
  let query = supabase
    .from('guild_war_battles')
    .select(BATTLE_SELECT_FIELDS)
    .eq('war_id', warId)
    .eq('guild_code', guildCode)
    .order('attempt_end_time', { ascending: false, nullsFirst: false })

  switch (filter.kind) {
    case 'failed':
      // Unpaged (~300 attacks per war max); true failures are filtered in code.
      query = query.eq('is_guild_member', true)
      break
    case 'perfect':
      // Unpaged (~80 per war); rows where defenders survived are dropped in code.
      query = query.eq('is_guild_member', true).eq('perfect_hit', true)
      break
    default:
      query = query.limit(limit + 1)
      if (filter.kind === 'guild') {
        query = query.eq('is_guild_member', true)
      } else if (filter.kind === 'opponent') {
        query = query.eq('is_guild_member', false)
      }
      if (cursor) {
        query = query.lt('attempt_end_time', cursor)
      }
      break
  }

  return query
}

function applyDomainFilter(
  battleRows: BattleRow[],
  filter: ActivityFilter,
  limit: number
): { responseRows: BattleRow[]; hasMore: boolean } {
  switch (filter.kind) {
    case 'failed':
      return {
        responseRows: battleRows.filter(isFailedBattleRow),
        hasMore: false
      }
    case 'perfect':
      return {
        responseRows: battleRows.filter((row) => !isFailedBattleRow(row)),
        hasMore: false
      }
    default: {
      const hasMore = battleRows.length > limit
      return {
        responseRows: hasMore ? battleRows.slice(0, limit) : battleRows,
        hasMore
      }
    }
  }
}

/** zone_id -> RAW zone_type; only the render site formats it (zoneDisplayName is not idempotent). */
async function loadZoneTypesById(
  supabase: SupabaseClient,
  responseRows: BattleRow[]
): Promise<Map<string, string>> {
  const zoneIds = [
    ...new Set(responseRows.map((r) => r.zone_id).filter(Boolean))
  ] as string[]
  const zoneTypeById = new Map<string, string>()

  if (zoneIds.length > 0) {
    const { data: zones } = await supabase
      .from('guild_war_zones')
      .select('id, zone_type')
      .in('id', zoneIds)

    for (const zone of zones ?? []) {
      zoneTypeById.set(zone.id, zone.zone_type ?? 'unknown')
    }
  }

  return zoneTypeById
}

function mapToAttempts(
  responseRows: BattleRow[],
  zoneTypeById: Map<string, string>,
  viewerGuildName: string,
  opponentGuildName: string
): RecentAttempt[] {
  return responseRows.map((row) => {
    const zoneType = zoneTypeById.get(row.zone_id ?? '')
    const failed = isFailedBattleRow(row)
    return {
      id: row.id,
      attacker: {
        name: row.attacker_player_name ?? 'Unknown',
        guildTag: row.attacker_guild_name ?? viewerGuildName
      },
      defender: {
        name: row.defender_player_name ?? 'Unknown',
        guildTag: row.defender_guild_name ?? opponentGuildName
      },
      attackerUnits: parseUnits(row.attacker_units_json),
      defenderUnits: parseUnits(row.defender_units_json),
      // RAW zone_type; 'unknown' is a real canonical key, so it still renders.
      zoneType: zoneType ?? 'unknown',
      score: row.score_earned ?? 0,
      kills: inferKills(row, failed),
      buffLevel: row.attempt_debuff ?? 0,
      time: row.attempt_end_time ?? '',
      isGuildMember: row.is_guild_member ?? false,
      isPerfect: row.perfect_hit ?? null,
      isFailed: failed
    }
  })
}

export const GET = withErrorHandler(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ warId: string }> }
  ) => {
    try {
      const { warId: rawWarId } = await params
      const { searchParams } = new URL(request.url)
      const input = parseInput(rawWarId, searchParams)

      if (!input.warId) {
        throw Errors.invalidRequest('warId is required', {
          endpoint: '/api/wars/[warId]/recent'
        })
      }

      const supabase = await db()

      // The wider war query below stays local: it needs opponent/score/result.
      await requireWarAccess(supabase, input.warId, {
        shape: 'war-first',
        endpoint: '/api/wars/[warId]/recent'
      })

      const { data: warMatch, error: warError } = await supabase
        .from('guild_war_matches')
        .select(
          'war_id, guild_code, opponent_guild_name, guild_score, opponent_score, war_result'
        )
        .eq('war_id', input.warId)
        .limit(1)
        .maybeSingle()

      if (warError) {
        logger.error('Failed to fetch war match', {
          error: warError,
          warId: input.warId
        })
        throw Errors.database('Failed to fetch war data', {
          endpoint: '/api/wars/[warId]/recent'
        })
      }

      if (!warMatch) {
        throw Errors.notFound('War', 'War not found')
      }

      const guildConfig = await GuildConfigService.getBasic(
        supabase,
        warMatch.guild_code
      )
      const viewerGuildName = guildConfig?.display_name ?? warMatch.guild_code
      const opponentGuildName =
        warMatch.opponent_guild_name ?? 'Unknown Opponent'

      const query = buildBattleQuery(
        supabase,
        input.warId,
        warMatch.guild_code,
        input
      )
      const { data: battles, error: battlesError } = await query

      if (battlesError) {
        logger.error('Failed to fetch battles', {
          error: battlesError,
          warId: input.warId
        })
        throw Errors.database('Failed to fetch activity data', {
          endpoint: '/api/wars/[warId]/recent'
        })
      }

      const battleRows = (battles ?? []) as unknown as BattleRow[]
      const { responseRows, hasMore } = applyDomainFilter(
        battleRows,
        input.filter,
        input.limit
      )
      const nextCursor = hasMore
        ? (responseRows[responseRows.length - 1]?.attempt_end_time ?? undefined)
        : undefined

      const zoneTypeById = await loadZoneTypesById(supabase, responseRows)
      const attempts = mapToAttempts(
        responseRows,
        zoneTypeById,
        viewerGuildName,
        opponentGuildName
      )

      return NextResponse.json({
        attempts,
        nextCursor,
        warTitle: `${viewerGuildName} v ${opponentGuildName}`,
        viewerGuildName,
        opponentGuildName,
        warResult: warMatch.war_result
      })
    } catch (error) {
      rethrowIfAppError(error)
      logger.error('Error in war recent activity endpoint', { error })
      throw Errors.fromResponse(500, {
        error: error instanceof Error ? error.message : 'Internal server error'
      })
    }
  }
)
