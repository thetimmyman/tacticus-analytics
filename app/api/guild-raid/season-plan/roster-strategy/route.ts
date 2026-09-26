import { NextRequest, NextResponse } from 'next/server'
import { parseJsonBody } from '@/app/lib/api/parse-json-body'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  generateRosterStrategy,
  type RosterStrategyPayload,
  type RosterStrategyProjection,
  type RosterStrategyPublicMember
} from '@/app/lib/boss-assignments/season-planner/roster-strategy'
import {
  clampInt,
  requireSeasonPlanOfficerContext,
  toPositiveInt
} from '../_shared'

const logger = createComponentLogger(
  'api.guild-raid.season-plan.roster-strategy'
)

export const dynamic = 'force-dynamic'

type ParsedSwapRequest = {
  outgoingPlayerId: string | null
  incomingPlayerId: string | null
}

type JsonObject = { [key: string]: JsonValue | undefined }

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

const parseOptionalInt = (
  value: JsonValue | undefined,
  fallback: number,
  min: number,
  max: number,
  fieldName: string
): number => {
  if (value == null || value === '') return fallback
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw Errors.fromResponse(400, { error: `Invalid ${fieldName}` })
    }
    return value > 0 ? clampInt(value, min, max) : fallback
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    if (!/^\d+$/.test(trimmed)) {
      throw Errors.fromResponse(400, { error: `Invalid ${fieldName}` })
    }
    return clampInt(toPositiveInt(trimmed, fallback), min, max)
  }
  throw Errors.fromResponse(400, { error: `Invalid ${fieldName}` })
}

const isRecord = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseSnapshotAt = (value: JsonValue | undefined): string | null => {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw Errors.fromResponse(400, { error: 'Invalid snapshot_at' })
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  const ms = new Date(trimmed).getTime()
  if (!Number.isFinite(ms)) {
    throw Errors.fromResponse(400, { error: 'Invalid snapshot_at' })
  }
  return new Date(ms).toISOString()
}

const parseOptionalString = (
  value: JsonValue | undefined,
  fieldName: string
): string | null => {
  if (value == null) return null
  if (typeof value !== 'string') {
    throw Errors.fromResponse(400, { error: `Invalid ${fieldName}` })
  }
  const trimmed = value.trim()
  return trimmed || null
}

const parseOptionalBoolean = (
  value: JsonValue | undefined,
  fallback: boolean,
  fieldName: string
): boolean => {
  if (value == null) return fallback
  if (typeof value !== 'boolean') {
    throw Errors.fromResponse(400, { error: `Invalid ${fieldName}` })
  }
  return value
}

const parseSwap = (value: JsonValue | undefined): ParsedSwapRequest | null => {
  if (value == null) return null
  if (!isRecord(value)) {
    throw Errors.fromResponse(400, { error: 'Invalid swap' })
  }
  return {
    outgoingPlayerId: parseOptionalString(value.outgoing_player_id, 'swap'),
    incomingPlayerId: parseOptionalString(value.incoming_player_id, 'swap')
  }
}

const sanitizeMember = (
  member: RosterStrategyPublicMember
): RosterStrategyPublicMember => ({
  playerId: member.playerId,
  displayName: member.displayName,
  guildCode: member.guildCode,
  role: member.role ?? null
})

const sanitizeProjection = (
  projection: RosterStrategyProjection,
  includeContributions: boolean
): RosterStrategyProjection => ({
  ...projection,
  contributions: includeContributions ? (projection.contributions ?? []) : []
})

const sanitizePayload = (
  payload: RosterStrategyPayload
): RosterStrategyPayload => ({
  ...payload,
  members: payload.members.map(sanitizeMember),
  baseline: sanitizeProjection(payload.baseline, true),
  swap: payload.swap
    ? {
        ...payload.swap,
        outgoing: sanitizeMember(payload.swap.outgoing),
        incoming: sanitizeMember(payload.swap.incoming),
        targetGuildBefore: sanitizeProjection(
          payload.swap.targetGuildBefore,
          true
        ),
        targetGuildAfter: sanitizeProjection(
          payload.swap.targetGuildAfter,
          true
        ),
        partnerGuildBefore: sanitizeProjection(
          payload.swap.partnerGuildBefore,
          false
        ),
        partnerGuildAfter: sanitizeProjection(
          payload.swap.partnerGuildAfter,
          false
        )
      }
    : null
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const { profile } = await requireSeasonPlanOfficerContext({
      requireFeatureAccess: true
    })

    const parsed = await parseJsonBody<JsonValue>(request, () =>
      Errors.fromResponse(400, { error: 'Invalid request body' })
    )
    if (!isRecord(parsed)) {
      throw Errors.fromResponse(400, { error: 'Invalid request body' })
    }
    const body: JsonObject = parsed

    const season = parseOptionalString(body.season, 'season number')
    if (season && (!/^\d{1,6}$/.test(season) || Number(season) <= 0)) {
      throw Errors.fromResponse(400, { error: 'Invalid season number' })
    }

    const result = await generateRosterStrategy({
      targetGuildCode: profile.guild_code,
      season,
      snapshotAt: parseSnapshotAt(body.snapshot_at),
      lookbackDays: parseOptionalInt(
        body.lookback_days,
        30,
        1,
        180,
        'lookback_days'
      ),
      sessionsPerDay: parseOptionalInt(
        body.sessions_per_day,
        1,
        1,
        3,
        'sessions_per_day'
      ),
      timeZone: parseOptionalString(body.time_zone, 'time_zone'),
      configId: parseOptionalString(body.config_id, 'config_id'),
      seasonCount: parseOptionalInt(body.season_count, 1, 1, 5, 'season_count'),
      swap: parseSwap(body.swap),
      includeOptimizer: parseOptionalBoolean(
        body.include_optimizer,
        true,
        'include_optimizer'
      ),
      includeInvestments: parseOptionalBoolean(
        body.include_investments,
        true,
        'include_investments'
      ),
      optimizerLimit: parseOptionalInt(
        body.optimizer_limit,
        5,
        1,
        12,
        'optimizer_limit'
      ),
      investmentLimitPerMember: parseOptionalInt(
        body.investment_limit_per_member,
        3,
        1,
        8,
        'investment_limit_per_member'
      )
    })

    return NextResponse.json(sanitizePayload(result))
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error generating roster strategy:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error'
    })
  }
})
