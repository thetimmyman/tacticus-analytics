/** Own guild, officer+, behind `officer_command_center`. POST re-derives the verdict via analyzeMember. */

import { serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { createHash } from 'node:crypto'
import { analyzeMember } from '@/app/lib/officer-briefing/analyze-member'
import { computeFollowUp } from '@/app/lib/officer-briefing/follow-up'
import { createComponentLogger } from '@/app/lib/logging'
import { raritySetToColumns } from '@/app/lib/catalogs/rarity-set'
import { requireActiveOfficerCommandAccess } from '../_shared/access'
import type { CoachingTask } from '@/app/lib/officer-briefing/types'
import {
  COACHING_TASK_LIST_SELECT,
  coachingTaskExpectsTeamSwap,
  type CoachingTaskRow
} from './_guards'
import type { EOTGRData } from '@tacticus/app-core/types'

const logger = createComponentLogger('api.officer.coaching-tasks')

const ACTIONABLE_CLASSIFICATIONS = new Set([
  'needs_support_wrong_team',
  'needs_support_correct_team'
])

type PostAssignmentAttackRow = Pick<
  EOTGRData,
  'heroDetails' | 'machineOfWarDetails' | 'damageDealt'
>

interface PostAssignmentUsage {
  usedHash: string
  actualAvg: number
  battleCount: number
}

type JsonValue =
  null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue }

interface UnitPayload {
  unitId?: JsonValue
}

function parseJson(value: string | null): JsonValue {
  if (value == null || value === '' || value === 'null') return null
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return null
  }
}

function unitIdFrom(value: JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const unitId = (value as UnitPayload).unitId
  return typeof unitId === 'string' && unitId.trim() ? unitId : null
}

function generateTeamHash(
  heroDetails: string | null,
  machineOfWarDetails: string | null
): string | null {
  const heroes = parseJson(heroDetails)
  if (!Array.isArray(heroes) || heroes.length === 0) return null
  const heroIds = heroes
    .map(unitIdFrom)
    .filter((id): id is string => Boolean(id))
    .sort()
  if (heroIds.length === 0) return null

  const mow = parseJson(machineOfWarDetails)
  const mowId = unitIdFrom(mow) ?? 'none'
  return createHash('md5')
    .update(`${heroIds.join(',')}|${mowId}`)
    .digest('hex')
}

function dominantPostAssignmentUsage(
  rows: PostAssignmentAttackRow[]
): PostAssignmentUsage | null {
  const buckets = new Map<string, { damage: number; count: number }>()
  for (const row of rows) {
    if (row.damageDealt == null) continue
    const teamHash = generateTeamHash(row.heroDetails, row.machineOfWarDetails)
    if (!teamHash) continue
    const bucket = buckets.get(teamHash) ?? { damage: 0, count: 0 }
    bucket.damage += row.damageDealt
    bucket.count += 1
    buckets.set(teamHash, bucket)
  }

  let best: PostAssignmentUsage | null = null
  for (const [usedHash, bucket] of buckets) {
    if (!best || bucket.count > best.battleCount) {
      best = {
        usedHash,
        actualAvg: bucket.damage / bucket.count,
        battleCount: bucket.count
      }
    }
  }
  return best
}

async function loadPostAssignmentUsage(
  supabase: ReturnType<typeof serviceDb>,
  row: CoachingTaskRow
): Promise<PostAssignmentUsage | null> {
  let query = supabase
    .from('EOT_GR_data')
    .select('heroDetails, machineOfWarDetails, damageDealt')
    .eq('Guild', row.guild_code)
    .eq('Season', row.season)
    .eq('displayName', row.display_name)
    .eq('type', row.boss_type)
    .eq('encounterIndex', row.encounter_index)
    .in('damageType', ['Battle', 'Bomb'])
    .gt('damageDealt', 0)
    .gte('startedOn', row.created_at)
    .order('startedOn', { ascending: false })
    .limit(200)

  const rs = raritySetToColumns(row.rarity_set)
  if (rs) query = query.eq('rarity', rs.rarity).eq('set', rs.set)

  const { data, error } = await query
  if (error) {
    throw new Error(error.message ?? 'post-assignment usage query failed')
  }
  return dominantPostAssignmentUsage(data ?? [])
}

export const GET = withErrorHandler(async (request: Request) => {
  const { guildCode } = await requireActiveOfficerCommandAccess()
  const { searchParams } = new URL(request.url)
  const season = searchParams.get('season')?.trim()
  if (!season) {
    throw Errors.fromResponse(400, { error: 'season is required' })
  }
  const supabase = serviceDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any

  const { data, error } = await sbAny
    .from('coaching_tasks')
    .select(COACHING_TASK_LIST_SELECT)
    .eq('guild_code', guildCode)
    .eq('season', season)
    .in('status', ['open', 'acknowledged'])
    .order('created_at', { ascending: false })

  if (error) {
    logger.error({ guildCode, error }, 'failed to load coaching tasks')
    throw Errors.fromResponse(500, { error: 'Failed to load coaching tasks' })
  }

  const rows = (data as CoachingTaskRow[] | null) ?? []

  const toWireTask = (row: CoachingTaskRow): CoachingTask => ({
    id: row.id,
    displayName: row.display_name,
    season: row.season,
    bossType: row.boss_type,
    encounterIndex: row.encounter_index,
    raritySet: row.rarity_set,
    classification: row.classification as CoachingTask['classification'],
    confidence: row.confidence as CoachingTask['confidence'],
    readyNowUpside: row.ready_now_upside,
    recommendedSwaps:
      (row.recommended_swaps as CoachingTask['recommendedSwaps']) ?? [],
    sourceBattleCount: row.source_battle_count,
    status: row.status,
    resolution: row.resolution as CoachingTask['resolution'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at
  })

  const results = await Promise.all(
    rows.map(async (row) => {
      const task = toWireTask(row)
      if (row.status !== 'acknowledged') {
        return { task, followUp: null }
      }
      try {
        const postAssignment = await loadPostAssignmentUsage(supabase, row)
        const followUp = computeFollowUp({
          expectedTeamSwap: coachingTaskExpectsTeamSwap(row),
          recommendedTeamHash: row.recommended_team_hash,
          originalActualAvg: row.original_actual_avg,
          currentDominantTeamHash: postAssignment?.usedHash ?? null,
          currentActualAvg: postAssignment?.actualAvg ?? null,
          currentBattleCount: postAssignment?.battleCount ?? 0
        })
        return { task, followUp }
      } catch (err) {
        logger.warn(
          {
            displayName: row.display_name,
            error: err instanceof Error ? err.message : String(err)
          },
          'follow-up computation failed'
        )
        return { task, followUp: null }
      }
    })
  )

  return Response.json({ tasks: results })
})

export const POST = withErrorHandler(async (request: Request) => {
  const { user, guildCode } = await requireActiveOfficerCommandAccess()

  const body = (await request.json().catch(() => ({}))) as {
    displayName?: string
    bossType?: string
    encounterIndex?: number
    raritySet?: string | null
    season?: string
  }
  const { displayName, bossType, season } = body
  const encounterIndex = body.encounterIndex
  const raritySet = body.raritySet ?? null
  if (!displayName || !bossType || encounterIndex == null || !season) {
    throw Errors.fromResponse(400, {
      error: 'displayName, bossType, encounterIndex, season are required'
    })
  }

  const supabase = serviceDb()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any

  // Idempotent: return the already-open task for this member+boss slice.
  let existingQuery = sbAny
    .from('coaching_tasks')
    .select('id, status')
    .eq('guild_code', guildCode)
    .eq('season', season)
    .eq('display_name', displayName)
    .eq('boss_type', bossType)
    .eq('encounter_index', encounterIndex)
    .in('status', ['open', 'acknowledged'])
  existingQuery =
    raritySet == null
      ? existingQuery.is('rarity_set', null)
      : existingQuery.eq('rarity_set', raritySet)
  const existingRes = await existingQuery.maybeSingle()
  if (existingRes.data) {
    return Response.json({
      id: existingRes.data.id,
      status: existingRes.data.status,
      alreadyOpen: true
    })
  }

  // Never trust client-supplied classification/confidence/swaps/team hashes.
  const detail = await analyzeMember({
    supabase,
    guildCode,
    displayName,
    season,
    nowMs: Date.now()
  })
  const verdict = detail.verdicts.find(
    (v) =>
      v.bossType === bossType &&
      v.encounterId === encounterIndex &&
      (v.rarity ?? null) === raritySet
  )
  if (!verdict) {
    throw Errors.fromResponse(404, {
      error: 'No current verdict for this member/boss slice'
    })
  }
  if (!ACTIONABLE_CLASSIFICATIONS.has(verdict.classification)) {
    throw Errors.fromResponse(422, {
      error: 'Verdict is not actionable for a coaching task',
      classification: verdict.classification
    })
  }

  const { data: inserted, error: insertError } = await sbAny
    .from('coaching_tasks')
    .insert({
      guild_code: guildCode,
      display_name: displayName,
      season,
      boss_type: bossType,
      encounter_index: encounterIndex,
      rarity_set: raritySet,
      classification: verdict.classification,
      confidence: verdict.confidence,
      ready_now_upside: verdict.readyNowUpside,
      used_team_hash: verdict.usedTeamHash,
      // No swap: recommend the same team; the follow-up checks whether its average improved.
      recommended_team_hash:
        verdict.recommendedTeamHash ?? verdict.usedTeamHash,
      recommended_swaps:
        verdict.classification === 'needs_support_wrong_team'
          ? verdict.swaps
          : [],
      original_actual_avg: verdict.actualAvg,
      source_battle_count: verdict.battleCount,
      created_by: user.id
    })
    .select('id, status')
    .single()

  if (insertError) {
    // 23505: a concurrent request won the partial unique index.
    if (insertError.code === '23505') {
      const raceBase = sbAny
        .from('coaching_tasks')
        .select('id, status')
        .eq('guild_code', guildCode)
        .eq('season', season)
        .eq('display_name', displayName)
        .eq('boss_type', bossType)
        .eq('encounter_index', encounterIndex)
        .in('status', ['open', 'acknowledged'])
      const raceRes = await (raritySet == null
        ? raceBase.is('rarity_set', null).maybeSingle()
        : raceBase.eq('rarity_set', raritySet).maybeSingle())
      if (raceRes.data) {
        return Response.json({
          id: raceRes.data.id,
          status: raceRes.data.status,
          alreadyOpen: true
        })
      }
    }
    logger.error(
      { guildCode, displayName, error: insertError },
      'failed to create coaching task'
    )
    throw Errors.fromResponse(500, { error: 'Failed to create coaching task' })
  }

  return Response.json({
    id: inserted.id,
    status: inserted.status,
    alreadyOpen: false
  })
})
