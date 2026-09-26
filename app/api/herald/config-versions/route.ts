import { NextRequest, NextResponse } from 'next/server'

import {
  requireGuildMember,
  requireGuildOfficerOrClusterLeader
} from '@/app/lib/auth/guild-permissions'
import { db } from '@/app/lib/db'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  assembleLiveSnapshot,
  listHeraldConfigVersions,
  loadHeraldConfigVersionSnapshot,
  parseHeraldSeasonParam,
  parseHeraldSnapshotSelector,
  validateSnapshot,
  type HeraldConfigSnapshot
} from '@/app/lib/herald/config-snapshot'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

const logger = createComponentLogger('config-versions')
const ENDPOINT = '/api/herald/config-versions'

const MIN_SEASON = 1
const MAX_SEASON = 9999

export const GET = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: ENDPOINT
    })
  )

  const url = new URL(req.url)
  const guildCode = url.searchParams.get('guild_code')
  if (!guildCode) {
    throw Errors.validation('guild_code is required', { endpoint: ENDPOINT })
  }

  await requireGuildMember(supabase, user.id, guildCode, ENDPOINT)

  if (url.searchParams.get('list') === '1') {
    // get_latest_season is SECURITY INVOKER and seq-scans under caller RLS; the result is global.
    const [versions, latestSeason] = await Promise.all([
      listHeraldConfigVersions(supabase, guildCode, ENDPOINT),
      getLatestSeason()
    ])
    return NextResponse.json({
      success: true,
      versions,
      latest_season: latestSeason ? String(latestSeason) : null
    })
  }

  const selector = parseHeraldSnapshotSelector(url, ENDPOINT)
  if (!selector) {
    throw Errors.validation('Either ?season=<int> or ?default=1 is required', {
      endpoint: ENDPOINT
    })
  }

  const data = await loadHeraldConfigVersionSnapshot(
    supabase,
    guildCode,
    selector,
    ENDPOINT
  )

  return NextResponse.json({ success: true, snapshot: data ?? null })
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: ENDPOINT
    })
  )

  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw Errors.validation('Request body must be valid JSON', {
      endpoint: ENDPOINT
    })
  }

  if (!body || typeof body !== 'object') {
    throw Errors.validation('Request body must be an object', {
      endpoint: ENDPOINT
    })
  }

  const obj = body as Record<string, unknown>
  const guildCode =
    typeof obj.guild_code === 'string' ? obj.guild_code.trim() : ''
  if (!guildCode) {
    throw Errors.validation('guild_code is required', { endpoint: ENDPOINT })
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    guildCode,
    ENDPOINT
  )

  const isDefault = obj.is_default === true
  let season: number | null = null
  if (!isDefault) {
    if (typeof obj.season !== 'number' || !Number.isInteger(obj.season)) {
      throw Errors.validation(
        'season (integer) is required when is_default is not true',
        { endpoint: ENDPOINT }
      )
    }
    if (obj.season < MIN_SEASON || obj.season > MAX_SEASON) {
      throw Errors.validation(
        `season must be between ${MIN_SEASON} and ${MAX_SEASON}`,
        { endpoint: ENDPOINT }
      )
    }
    season = parseHeraldSeasonParam(String(obj.season))
  }

  let snapshot: HeraldConfigSnapshot
  if (obj.snapshot === undefined || obj.snapshot === null) {
    snapshot = await assembleLiveSnapshot(supabase, guildCode, ENDPOINT)
  } else {
    const validated = validateSnapshot(obj.snapshot)
    if (!validated) {
      throw Errors.validation(
        'snapshot must match the documented shape (guild_config + herald_meta_role_mapping[] + herald_boss_config[])',
        { endpoint: ENDPOINT }
      )
    }
    snapshot = validated
  }

  // A closed shape does not assign to the recursive `Json` type.
  const payload = {
    guild_code: guildCode,
    season,
    is_default: isDefault,
    config_snapshot: snapshot as unknown as never,
    created_by: user.id
  }

  let data: unknown
  let error: { message?: string } | null

  if (isDefault) {
    // Upsert cannot target the partial unique index on the default row.
    const existing = await supabase
      .from('herald_config_versions')
      .select('id')
      .eq('guild_code', guildCode)
      .eq('is_default', true)
      .maybeSingle()

    if (existing.error) {
      logger.error(
        { err: existing.error },
        'Failed to look up default herald_config_versions row'
      )
      throw Errors.fetchFailed('Failed to save Herald config snapshot', {
        endpoint: ENDPOINT,
        details: existing.error.message
      })
    }

    const write = existing.data
      ? supabase
          .from('herald_config_versions')
          .update(payload)
          .eq('id', (existing.data as { id: number }).id)
      : supabase.from('herald_config_versions').insert(payload)

    const result = await write
      .select('id, guild_code, season, is_default, created_at')
      .single()
    data = result.data
    error = result.error
  } else {
    const result = await supabase
      .from('herald_config_versions')
      .upsert(payload, { onConflict: 'guild_code,season' })
      .select('id, guild_code, season, is_default, created_at')
      .single()
    data = result.data
    error = result.error
  }

  if (error) {
    logger.error({ err: error }, 'Failed to upsert herald_config_versions row')
    throw Errors.fetchFailed('Failed to save Herald config snapshot', {
      endpoint: ENDPOINT,
      details: error.message
    })
  }

  return NextResponse.json({ success: true, version: data })
})
