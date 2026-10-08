/** Current members read; canonical officer/leader policies govern writes. */

import { NextRequest, NextResponse } from 'next/server'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import {
  requireGuildMember,
  requireGuildOfficerOrClusterLeader
} from '@/app/lib/auth/guild-permissions'
import {
  LEGACY_SEASON,
  parseSeasonParam,
  selectSeasonScoped
} from '@/app/lib/boss-assignments/target-token-season'
const logger = createComponentLogger('api.boss-assignments.target-tokens')

export const dynamic = 'force-dynamic'

const ENDPOINT = '/api/boss-assignments/target-tokens'

const requireTargetTokenWriter = async (
  supabase: Awaited<ReturnType<typeof db>>,
  userId: string,
  guildCode: string,
  isAppAdmin: boolean,
  allowAdminAdmission = true
) => {
  if (isAppAdmin && allowAdminAdmission) return
  await requireGuildOfficerOrClusterLeader(
    supabase,
    userId,
    guildCode,
    ENDPOINT
  )
}

// App-admins pass the route but not the RLS policy; report that as 403, not 500.
const isRlsDenial = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === '42501') return true
  return (
    typeof message === 'string' &&
    message.toLowerCase().includes('row-level security')
  )
}

const rlsDenialMessage = (guildCode: string): string =>
  `Not authorized to write target tokens for guild ${guildCode}. The database ` +
  `policy on boss_target_tokens requires a CURRENT officer or leader ` +
  `membership in that guild, or leadership of its cluster — app-admin access ` +
  `does not satisfy it. Ask an officer or the leader of ${guildCode} to make ` +
  `this change.`

function numericInput(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim()))
    return Number.NaN
  return Number(value)
}

function validateBody(body: unknown): {
  boss_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
  target_tokens: number
  // Undefined = omitted, leave the stored value.
  notes: string | null | undefined
  skip: boolean | undefined
  season_number: string
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Errors.fromStatus(400, 'A target object is required', {
      code: 'VALIDATION_ERROR'
    })
  }
  const b = body as Record<string, unknown>
  const boss_name = typeof b.boss_name === 'string' ? b.boss_name.trim() : ''
  const rarity =
    b.rarity === 'Mythic'
      ? 'Mythic'
      : b.rarity === 'Legendary'
        ? 'Legendary'
        : null
  const set = numericInput(b.set)
  const rawEncounterId = b.encounter_id
  const encounter_id =
    typeof rawEncounterId === 'number'
      ? rawEncounterId
      : rawEncounterId === undefined
        ? 0
        : numericInput(rawEncounterId)
  const target_tokens = numericInput(b.target_tokens)
  // Omitted preserves the note; null or an empty string clears it.
  const rawNotes = b.notes
  let notes: string | null | undefined
  if (rawNotes === undefined) {
    notes = undefined
  } else if (typeof rawNotes === 'string') {
    const sliced = rawNotes.slice(0, 500)
    notes = sliced.length > 0 ? sliced : null
  } else if (rawNotes === null) {
    notes = null
  } else {
    throw Errors.fromStatus(400, 'notes must be text or null', {
      code: 'VALIDATION_ERROR'
    })
  }
  if (b.skip !== undefined && typeof b.skip !== 'boolean') {
    throw Errors.fromStatus(400, 'skip must be a boolean', {
      code: 'VALIDATION_ERROR'
    })
  }
  const skip = b.skip === undefined ? undefined : b.skip === true
  // Positive integer string, or LEGACY_SEASON ('') for season-less callers.
  const rawSeason = b.season_number
  let season_number: string = LEGACY_SEASON
  if (rawSeason !== undefined && rawSeason !== null && rawSeason !== '') {
    const parsedSeason =
      typeof rawSeason === 'string' || typeof rawSeason === 'number'
        ? parseSeasonParam(rawSeason)
        : null
    if (parsedSeason === null) {
      throw Errors.fromStatus(
        400,
        'season_number must be a positive integer string',
        { code: 'VALIDATION_ERROR' }
      )
    }
    season_number = parsedSeason
  }
  if (
    !boss_name ||
    !rarity ||
    !Number.isInteger(set) ||
    set < 1 ||
    set > 5 ||
    !Number.isInteger(encounter_id) ||
    encounter_id < 0 ||
    encounter_id > 2 ||
    !Number.isFinite(target_tokens) ||
    target_tokens <= 0
  ) {
    throw Errors.fromStatus(
      400,
      'boss_name, rarity (Legendary|Mythic), set (1-5), encounter_id (0-2), and target_tokens (>0) are required',
      { code: 'VALIDATION_ERROR' }
    )
  }
  if (encounter_id === 0 && skip) {
    throw Errors.fromStatus(400, 'Main boss targets cannot be skipped', {
      code: 'VALIDATION_ERROR'
    })
  }
  return {
    boss_name,
    rarity,
    set,
    encounter_id,
    target_tokens,
    notes,
    skip,
    season_number
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const profile = authData.profile
    const searchParams = request.nextUrl.searchParams
    const requestedGuild = searchParams.get('guild_code')
    const guildCode = requestedGuild ?? profile.guild_code
    if (!guildCode) {
      throw Errors.fromStatus(400, 'guild_code required', {
        code: 'VALIDATION_ERROR'
      })
    }
    const supabase = await db()
    // The session profile may be stale.
    await requireGuildMember(supabase, authData.user.id, guildCode, ENDPOINT)
    // With `season`, the season row per encounter else the '' legacy row; without it, all rows.
    const requestedSeasonRaw = searchParams.get('season')
    const scopedSeason = parseSeasonParam(requestedSeasonRaw)
    if (
      requestedSeasonRaw !== null &&
      requestedSeasonRaw !== '' &&
      requestedSeasonRaw !== LEGACY_SEASON &&
      scopedSeason === null
    ) {
      throw Errors.fromStatus(400, 'season must be a positive integer string', {
        code: 'VALIDATION_ERROR'
      })
    }

    // season_number is not in generated types.
    /* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-syntax */
    const targetsTable = supabase.from('boss_target_tokens' as never) as any
    /* eslint-enable @typescript-eslint/no-explicit-any, no-restricted-syntax */
    let query = targetsTable
      .select(
        'boss_name, rarity, set, encounter_id, target_tokens, source, seeded_from_seasons, notes, updated_by, updated_at, skip, season_number'
      )
      .eq('guild_code', guildCode)
    if (scopedSeason !== null) {
      query = query.in('season_number', [scopedSeason, LEGACY_SEASON])
    }
    const { data, error } = await query
      .order('rarity', { ascending: true })
      .order('set', { ascending: true })
      .order('encounter_id', { ascending: true })
      .order('boss_name', { ascending: true })
    if (error) {
      logger.error({ guildCode, error }, 'boss_target_tokens GET query failed')
      throw Errors.fromStatus(500, 'Failed to load target tokens', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }

    type TargetRow = {
      boss_name: string
      rarity: string
      set: number
      encounter_id: number
      season_number: string | null
    }
    const rows = (data ?? []) as unknown as TargetRow[]
    if (scopedSeason !== null) {
      const resolved = selectSeasonScoped(
        rows,
        scopedSeason,
        (row) =>
          `${row.boss_name}__${row.rarity}__${row.set}__${row.encounter_id}`
      )
      return NextResponse.json({ rows: Array.from(resolved.values()) })
    }
    return NextResponse.json({ rows })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in boss-target-tokens GET:')
    throw Errors.fromStatus(500, 'Internal error', { code: 'INTERNAL_ERROR' })
  }
})

export const PUT = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const profile = authData.profile
    const searchParams = request.nextUrl.searchParams
    const requestedGuild = searchParams.get('guild_code')
    const guildCode = requestedGuild ?? profile.guild_code
    if (!guildCode) {
      throw Errors.fromStatus(400, 'guild_code required', {
        code: 'VALIDATION_ERROR'
      })
    }
    const supabase = await db()
    await requireTargetTokenWriter(
      supabase,
      authData.user.id,
      guildCode,
      Boolean(profile.is_app_admin)
    )
    const body = await request.json().catch(() => null)
    if (!body) {
      throw Errors.fromStatus(400, 'Invalid JSON body', {
        code: 'VALIDATION_ERROR'
      })
    }
    const input = validateBody(body)

    // boss_name must be a boss_mapping.boss_type slug to match reads.
    const { data: mappingExact } = await supabase
      .from('boss_mapping')
      .select('boss_type')
      .eq('boss_type', input.boss_name)
      .eq('encounter_index', input.encounter_id)
      .limit(1)
    if (!mappingExact || mappingExact.length === 0) {
      const { data: mappingByDisplay } = await supabase
        .from('boss_mapping')
        .select('boss_type, boss_name')
        .eq('boss_name', input.boss_name)
        .eq('encounter_index', input.encounter_id)
        .limit(2)
      const suggestion =
        mappingByDisplay && mappingByDisplay.length === 1
          ? (mappingByDisplay[0] as { boss_type: string }).boss_type
          : null
      logger.warn(
        { guildCode, boss_name: input.boss_name, suggestion },
        'boss_target_tokens PUT rejected: unknown boss_name'
      )
      throw Errors.fromStatus(
        400,
        suggestion
          ? `Unknown boss_name "${input.boss_name}". Use the bossType slug "${suggestion}" instead.`
          : `Unknown boss_name "${input.boss_name}". Must match a boss_mapping.boss_type.`,
        { code: 'VALIDATION_ERROR' }
      )
    }

    const targetsTable = supabase.from('boss_target_tokens')
    const { data, error } = await targetsTable
      .upsert(
        {
          guild_code: guildCode,
          boss_name: input.boss_name,
          rarity: input.rarity,
          set: input.set,
          encounter_id: input.encounter_id,
          // In onConflict so per-season rows never collapse onto the '' legacy row.
          season_number: input.season_number,
          target_tokens: input.target_tokens,
          source: 'officer_manual',
          // Omitted when not sent so DO UPDATE keeps the note; do not change this to `notes ?? null`.
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.skip !== undefined ? { skip: input.skip } : {}),
          updated_by: authData.user.id
        },
        {
          onConflict:
            'guild_code,boss_name,rarity,set,encounter_id,season_number'
        }
      )
      .select()
      .single()
    if (error) {
      if (isRlsDenial(error)) {
        // Not a server fault.
        logger.warn(
          { guildCode, boss_name: input.boss_name, error },
          'boss_target_tokens PUT refused by row-level security'
        )
        throw Errors.fromStatus(403, rlsDenialMessage(guildCode), {
          code: 'FORBIDDEN'
        })
      }
      logger.error(
        { guildCode, input, error },
        'boss_target_tokens PUT upsert failed'
      )
      throw Errors.fromStatus(500, 'Failed to save target', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }
    return NextResponse.json({ row: data })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in boss-target-tokens PUT:')
    throw Errors.fromStatus(500, 'Internal error', { code: 'INTERNAL_ERROR' })
  }
})

/** Notes annotate an existing target; they do not make its seeded value an override. */
export const PATCH = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const guildCode =
      request.nextUrl.searchParams.get('guild_code') ??
      authData.profile.guild_code
    if (!guildCode) {
      throw Errors.fromStatus(400, 'guild_code required', {
        code: 'VALIDATION_ERROR'
      })
    }
    const supabase = await db()
    await requireTargetTokenWriter(
      supabase,
      authData.user.id,
      guildCode,
      Boolean(authData.profile.is_app_admin),
      // A filtered UPDATE must not look like a successful note save.
      false
    )
    const body: unknown = await request.json().catch(() => null)
    const allowed = new Set([
      'boss_name',
      'rarity',
      'set',
      'encounter_id',
      'season_number',
      'notes'
    ])
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      Array.from(allowed).some((key) => !Object.hasOwn(body, key)) ||
      typeof (body as Record<string, unknown>).season_number !== 'string'
    ) {
      throw Errors.fromStatus(
        400,
        'An existing target identity, explicit season_number and notes are required',
        { code: 'VALIDATION_ERROR' }
      )
    }
    // Reuse the target identity/note validation; token values are never accepted or written.
    const input = validateBody({ ...body, target_tokens: 1 })
    const { data, error } = await supabase
      .from('boss_target_tokens')
      .update({ notes: input.notes, updated_by: authData.user.id })
      .eq('guild_code', guildCode)
      .eq('boss_name', input.boss_name)
      .eq('rarity', input.rarity)
      .eq('set', input.set)
      .eq('encounter_id', input.encounter_id)
      .eq('season_number', input.season_number)
      .select()
      .maybeSingle()
    if (error) {
      if (isRlsDenial(error)) {
        throw Errors.fromStatus(403, rlsDenialMessage(guildCode), {
          code: 'FORBIDDEN'
        })
      }
      logger.error({ guildCode, error }, 'boss_target_tokens PATCH failed')
      throw Errors.fromStatus(500, 'Failed to save target note', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }
    if (!data) {
      throw Errors.fromStatus(404, 'Target not found', { code: 'NOT_FOUND' })
    }
    return NextResponse.json({ row: data })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in boss-target-tokens PATCH:')
    throw Errors.fromStatus(500, 'Internal error', { code: 'INTERNAL_ERROR' })
  }
})

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const profile = authData.profile
    const searchParams = request.nextUrl.searchParams
    const requestedGuild = searchParams.get('guild_code')
    const guildCode = requestedGuild ?? profile.guild_code
    if (!guildCode) {
      throw Errors.fromStatus(400, 'guild_code required', {
        code: 'VALIDATION_ERROR'
      })
    }
    const supabase = await db()
    await requireTargetTokenWriter(
      supabase,
      authData.user.id,
      guildCode,
      Boolean(profile.is_app_admin),
      // RLS filters an unauthorized DELETE to zero rows without raising 42501.
      // Verify current write authority so that cannot be reported as success.
      false
    )
    const boss_name = searchParams.get('boss_name')
    const rarity = searchParams.get('rarity')
    const setStr = searchParams.get('set')
    const set = numericInput(setStr)
    const encStr = searchParams.get('encounter_id')
    const encounter_id = encStr === null ? 0 : numericInput(encStr)
    if (
      !boss_name ||
      (rarity !== 'Legendary' && rarity !== 'Mythic') ||
      !Number.isInteger(set) ||
      set < 1 ||
      set > 5 ||
      !Number.isInteger(encounter_id) ||
      encounter_id < 0 ||
      encounter_id > 2
    ) {
      throw Errors.fromStatus(
        400,
        'boss_name, rarity, set, encounter_id required',
        { code: 'VALIDATION_ERROR' }
      )
    }
    const seasonRaw = searchParams.get('season')
    const scopedSeason = parseSeasonParam(seasonRaw)
    if (seasonRaw !== null && seasonRaw !== '' && seasonRaw !== LEGACY_SEASON) {
      if (scopedSeason === null) {
        throw Errors.fromStatus(
          400,
          'season must be a positive integer string',
          { code: 'VALIDATION_ERROR' }
        )
      }
    }
    const targetsTable = supabase.from('boss_target_tokens')
    let deleteQuery = targetsTable
      .delete()
      .eq('guild_code', guildCode)
      .eq('boss_name', boss_name)
      .eq('rarity', rarity)
      .eq('set', set)
      .eq('encounter_id', encounter_id)
    if (seasonRaw !== null) {
      deleteQuery = deleteQuery.eq(
        'season_number',
        scopedSeason ?? LEGACY_SEASON
      )
    }
    const { error } = await deleteQuery
    if (error) {
      if (isRlsDenial(error)) {
        logger.warn(
          { guildCode, boss_name, error },
          'boss_target_tokens DELETE refused by row-level security'
        )
        throw Errors.fromStatus(403, rlsDenialMessage(guildCode), {
          code: 'FORBIDDEN'
        })
      }
      logger.error({ guildCode, error }, 'boss_target_tokens DELETE failed')
      throw Errors.fromStatus(500, 'Failed to delete target', {
        code: 'HISTORICAL_DATA_FAILED'
      })
    }
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in boss-target-tokens DELETE:')
    throw Errors.fromStatus(500, 'Internal error', { code: 'INTERNAL_ERROR' })
  }
})
