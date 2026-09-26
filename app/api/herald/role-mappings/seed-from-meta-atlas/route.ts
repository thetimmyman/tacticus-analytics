import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { fetchHeraldSeedFromMetaAtlas } from '@/app/lib/herald/meta-atlas'

const logger = createComponentLogger('herald-seed')

// `?preview=1` returns the seed without writing; otherwise unmapped slugs are inserted disabled.

interface SeedPayload {
  guild_code: string
  preview?: boolean
  top_n?: number
  auto_update?: boolean
}

const parseBody = (body: unknown): SeedPayload | null => {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>
  const guildCode =
    typeof obj.guild_code === 'string' ? obj.guild_code.trim() : ''
  if (!guildCode) return null
  const topN =
    typeof obj.top_n === 'number' && obj.top_n >= 1 && obj.top_n <= 10
      ? obj.top_n
      : 2
  return {
    guild_code: guildCode,
    preview: Boolean(obj.preview),
    top_n: topN,
    auto_update: obj.auto_update === undefined ? true : Boolean(obj.auto_update)
  }
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: '/api/herald/role-mappings/seed-from-meta-atlas'
    })
  )

  const body = await req.json().catch(() => null)
  const payload = parseBody(body)
  if (!payload) {
    throw Errors.validation('guild_code is required', {
      endpoint: '/api/herald/role-mappings/seed-from-meta-atlas'
    })
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    payload.guild_code,
    '/api/herald/role-mappings/seed-from-meta-atlas'
  )

  const adminDb = serviceDb()

  const seed = await fetchHeraldSeedFromMetaAtlas(adminDb, {
    topN: payload.top_n
  })

  if (seed.teams.length === 0) {
    const cascadeMsg =
      seed.seasonsTried.length === 0
        ? 'No season data in Meta Atlas yet.'
        : seed.seasonsTried.length === 1
          ? `Meta Atlas returned no ranked teams for season ${seed.seasonsTried[0]}.`
          : `Meta Atlas returned no ranked teams across the last ${seed.seasonsTried.length} seasons (cascade: ${seed.seasonsTried.join(', ')}).`
    return NextResponse.json({
      success: true,
      preview: true,
      created: 0,
      skipped_existing: 0,
      teams: [],
      unmapped_bosses: seed.unmappedBosses,
      season: seed.season,
      seasons_tried: seed.seasonsTried,
      message: cascadeMsg
    })
  }

  // Existing mappings are skipped so role IDs are never clobbered.
  const { data: existingRows, error: existingError } = await adminDb
    .from('herald_meta_role_mapping')
    .select('meta_team_slug')
    .eq('guild_code', payload.guild_code)
  if (existingError) {
    logger.error(
      { error: existingError.message },
      'herald.seed.existing_fetch_error'
    )
    throw Errors.fetchFailed('Failed to read existing Herald mappings', {
      endpoint: '/api/herald/role-mappings/seed-from-meta-atlas',
      details: existingError.message
    })
  }
  const existingSlugs = new Set<string>(
    (existingRows ?? []).map((r) => r.meta_team_slug)
  )

  const toCreate = seed.teams.filter((t) => !existingSlugs.has(t.meta_team))
  const skipped = seed.teams.length - toCreate.length

  if (payload.preview) {
    return NextResponse.json({
      success: true,
      preview: true,
      created: 0,
      would_create: toCreate.length,
      skipped_existing: skipped,
      teams: toCreate.map((t) => ({
        meta_team: t.meta_team,
        boss_ids: t.boss_ids,
        boss_count: t.boss_ids.length
      })),
      unmapped_bosses: seed.unmappedBosses,
      season: seed.season,
      seasons_tried: seed.seasonsTried
    })
  }

  if (toCreate.length === 0) {
    return NextResponse.json({
      success: true,
      created: 0,
      skipped_existing: skipped,
      teams: [],
      unmapped_bosses: seed.unmappedBosses,
      season: seed.season,
      message: 'All top teams already have a mapping — nothing new to seed.'
    })
  }

  const rows = toCreate.map((t) => ({
    guild_code: payload.guild_code,
    meta_team_slug: t.meta_team,
    discord_role_id: null,
    display_label: null,
    enabled: false, // disabled until officer fills in a role ID
    active_boss_ids: t.boss_ids,
    auto_update: payload.auto_update ?? true,
    updated_by: user.id,
    updated_at: new Date().toISOString()
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (adminDb as any)
    .from('herald_meta_role_mapping')
    .insert(rows)
  if (insertError) {
    logger.error({ error: insertError.message }, 'herald.seed.insert_error')
    throw Errors.updateFailed('Failed to seed Herald mappings', {
      endpoint: '/api/herald/role-mappings/seed-from-meta-atlas',
      details: insertError.message
    })
  }

  logger.info(
    {
      guild_code: payload.guild_code,
      created: rows.length,
      skipped_existing: skipped,
      season: seed.season,
      seasons_tried: seed.seasonsTried
    },
    'herald.seed.committed'
  )

  return NextResponse.json({
    success: true,
    created: rows.length,
    skipped_existing: skipped,
    teams: toCreate.map((t) => ({
      meta_team: t.meta_team,
      boss_ids: t.boss_ids,
      boss_count: t.boss_ids.length
    })),
    unmapped_bosses: seed.unmappedBosses,
    season: seed.season,
    seasons_tried: seed.seasonsTried
  })
})
