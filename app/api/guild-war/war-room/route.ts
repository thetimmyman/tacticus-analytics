import { NextRequest, NextResponse } from 'next/server'
import type { Json } from '@tacticus/app-core/database.generated'
import { parseJsonBody } from '@/app/lib/api/parse-json-body'
import {
  requireActiveMembershipForApi,
  requireRoleForApi
} from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { createComponentLogger } from '@/app/lib/logging'
import { apiSecurityMiddleware } from '@/app/lib/middleware/api-security-middleware'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import type { TablesUpdate } from '@tacticus/app-core/database.generated'

const logger = createComponentLogger('api.guild-war.war-room')

const HERO_ROLES = new Set(['core', 'flex', 'mow'])
const MAX_HEROES = 15
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEAM_COLUMNS =
  'id, guild_code, name, side, priority, notes, heroes, created_at, updated_at'

type HeroRole = 'core' | 'flex' | 'mow'
type WarSide = 'offense' | 'defense'

interface HeroInput {
  unitId: string
  role: HeroRole
}

interface ValidatedTeamBody {
  id?: string
  name?: string
  side?: WarSide
  priority?: number | null
  notes?: string | null
  heroes?: HeroInput[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Only {unitId, role} with a trimmed id. */
function validateHeroes(value: unknown): HeroInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw Errors.validation('At least one hero is required', {
      field: 'heroes'
    })
  }
  if (value.length > MAX_HEROES) {
    throw Errors.validation(`Max ${MAX_HEROES} heroes (including MoW)`, {
      field: 'heroes'
    })
  }

  const seen = new Set<string>()
  const heroes: HeroInput[] = []
  for (const hero of value) {
    if (!isRecord(hero)) {
      throw Errors.validation('Every hero must be an object', {
        field: 'heroes'
      })
    }

    const unitId =
      typeof hero.unitId === 'string' ? hero.unitId.trim() : undefined
    const role = typeof hero.role === 'string' ? hero.role : undefined

    if (!unitId) {
      throw Errors.validation('Every hero needs a unitId', { field: 'heroes' })
    }
    if (!role || !HERO_ROLES.has(role)) {
      throw Errors.validation('Hero role must be core, flex or mow', {
        field: 'heroes',
        unitId
      })
    }
    if (seen.has(unitId)) {
      throw Errors.validation(`Duplicate hero ${unitId}`, {
        field: 'heroes',
        unitId
      })
    }

    seen.add(unitId)
    heroes.push({ unitId, role: role as HeroRole })
  }
  return heroes
}

function validateTeamBody(
  value: unknown,
  { requireName }: { requireName: boolean }
): ValidatedTeamBody {
  if (!isRecord(value)) {
    throw Errors.validation('Request body must be a JSON object')
  }

  const body: ValidatedTeamBody = {}
  let hasUpdate = false

  if (value.id !== undefined) {
    if (typeof value.id !== 'string') {
      throw Errors.validation('Team id must be a UUID', { field: 'id' })
    }
    const id = value.id.trim()
    if (!UUID_PATTERN.test(id)) {
      throw Errors.validation('Team id must be a UUID', { field: 'id' })
    }
    body.id = id
  }

  if (value.name !== undefined || requireName) {
    if (typeof value.name !== 'string') {
      throw Errors.validation('Team name is required', { field: 'name' })
    }
    const name = value.name.trim()
    if (!name || name.length > 80) {
      throw Errors.validation(
        'Team name is required and must be at most 80 characters',
        { field: 'name' }
      )
    }
    body.name = name
    hasUpdate = true
  }

  if (value.side !== undefined) {
    if (value.side !== 'offense' && value.side !== 'defense') {
      throw Errors.validation('Side must be offense or defense', {
        field: 'side'
      })
    }
    body.side = value.side
    hasUpdate = true
  }

  if (value.priority !== undefined) {
    const priority = value.priority
    if (
      priority !== null &&
      (typeof priority !== 'number' ||
        !Number.isInteger(priority) ||
        priority < 1 ||
        priority > 99)
    ) {
      throw Errors.validation('Priority must be an integer from 1 to 99', {
        field: 'priority'
      })
    }
    body.priority = priority
    hasUpdate = true
  }

  if (value.notes !== undefined) {
    if (value.notes !== null && typeof value.notes !== 'string') {
      throw Errors.validation('Notes must be text or null', { field: 'notes' })
    }
    body.notes = value.notes
    hasUpdate = true
  }

  if (value.heroes !== undefined) {
    body.heroes = validateHeroes(value.heroes)
    hasUpdate = true
  } else if (requireName) {
    throw Errors.validation('At least one hero is required', {
      field: 'heroes'
    })
  }

  if (!requireName && !hasUpdate) {
    throw Errors.validation('At least one team field is required')
  }

  return body
}

async function applyRateLimit(request: NextRequest): Promise<Response | null> {
  return apiSecurityMiddleware(request)
}

export const dynamic = 'force-dynamic'

// UUIDs in production, short tags in fixtures.
const GUILD_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

interface WarRoomGuildOption {
  guildCode: string
  label: string
  teamCount: number
}

// PostgREST caps responses (10,000 rows), so page the guild scan.
const GUILD_SCAN_PAGE_SIZE = 1000

/** Guilds whose shared teams RLS lets the caller read, plus their own so the picker can return home. */
async function listGuildOptions(
  supabase: Awaited<ReturnType<typeof db>>,
  ownGuildCode: string | null
): Promise<WarRoomGuildOption[]> {
  const counts = new Map<string, number>()
  if (ownGuildCode) counts.set(ownGuildCode, 0)

  for (let offset = 0; ; offset += GUILD_SCAN_PAGE_SIZE) {
    const { data: teamRows, error: teamError } = await supabase
      .from('guild_war_meta_teams')
      .select('guild_code')
      .order('id', { ascending: true })
      .range(offset, offset + GUILD_SCAN_PAGE_SIZE - 1)
    if (teamError) {
      logger.error({ error: teamError }, 'War Room guild list read failed')
      throw Errors.internal('Failed to load War Room guilds')
    }
    for (const row of teamRows ?? []) {
      counts.set(row.guild_code, (counts.get(row.guild_code) ?? 0) + 1)
    }
    if ((teamRows?.length ?? 0) < GUILD_SCAN_PAGE_SIZE) break
  }
  if (counts.size === 0) return []

  const { data: guildRows, error: guildError } = await supabase
    .from('guild_config')
    .select('guild_code, display_name, guild_tag')
    .in('guild_code', [...counts.keys()])
  if (guildError) {
    logger.error({ error: guildError }, 'War Room guild names read failed')
    throw Errors.internal('Failed to load War Room guilds')
  }

  const guildsByCode = new Map(
    (guildRows ?? []).map((guild) => [guild.guild_code, guild])
  )
  return [...counts.entries()]
    .map(([guildCode, teamCount]) => ({
      guildCode,
      label: formatGuildDisplayLabel(guildsByCode.get(guildCode), guildCode),
      teamCount
    }))
    .sort((a, b) => {
      if (a.guildCode === ownGuildCode) return -1
      if (b.guildCode === ownGuildCode) return 1
      return a.label.localeCompare(b.label)
    })
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  // RLS decides which shared teams are visible; readiness and hero usage are own-guild only.
  const { profile } = await requireActiveMembershipForApi()

  const requestedGuild = request.nextUrl.searchParams.get('guild')?.trim()
  if (requestedGuild && !GUILD_CODE_PATTERN.test(requestedGuild)) {
    throw Errors.validation('Invalid guild code', { field: 'guild' })
  }

  const requestedMinRank = request.nextUrl.searchParams.get('min_rank_index')
  const parsedMinRank = requestedMinRank
    ? Number.parseInt(requestedMinRank, 10)
    : 9
  // 0 (Stone I) to 23 (Mythic III).
  const minRankIndex = Number.isInteger(parsedMinRank)
    ? Math.min(23, Math.max(0, parsedMinRank))
    : 9

  const ownGuildCode = profile.guild_code ?? null
  const callerPlayerId = profile.player_id ?? null

  const supabase = await db()
  const guilds = await listGuildOptions(supabase, ownGuildCode)
  const guildCode = requestedGuild || ownGuildCode || guilds[0]?.guildCode
  if (!guildCode) {
    return NextResponse.json({
      guildCode: null,
      ownGuildCode,
      isOwnGuild: false,
      guilds,
      minRankIndex,
      teams: [],
      readiness: [],
      usage: [],
      myUsage: []
    })
  }
  const isOwnGuild = ownGuildCode !== null && guildCode === ownGuildCode

  const [teamsResult, readinessResult, usageResult] = await Promise.all([
    supabase
      .from('guild_war_meta_teams')
      .select(TEAM_COLUMNS)
      .eq('guild_code', guildCode)
      .order('side', { ascending: true })
      .order('priority', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    isOwnGuild
      ? supabase.rpc('get_war_room_team_readiness', {
          p_guild_code: guildCode,
          p_min_rank_index: minRankIndex
        })
      : Promise.resolve({ data: [], error: null }),
    isOwnGuild
      ? supabase.rpc('get_guild_war_hero_usage', {
          p_guild_code: guildCode
        })
      : Promise.resolve({ data: [], error: null })
  ])

  if (teamsResult.error) {
    logger.error(
      { error: teamsResult.error, guildCode },
      'War Room shared-team read failed'
    )
    throw Errors.internal('Failed to load War Room teams')
  }
  if (readinessResult.error) {
    logger.error(
      { error: readinessResult.error, guildCode },
      'War Room readiness read failed'
    )
    throw Errors.internal('Failed to load War Room readiness')
  }
  if (usageResult.error) {
    logger.error(
      { error: usageResult.error, guildCode },
      'War Room hero-usage read failed'
    )
    throw Errors.internal('Failed to load War Room hero usage')
  }

  const usage = usageResult.data ?? []
  return NextResponse.json({
    guildCode,
    ownGuildCode,
    isOwnGuild,
    guilds,
    minRankIndex,
    teams: teamsResult.data ?? [],
    readiness: readinessResult.data ?? [],
    usage,
    myUsage: usage.filter((row) => row.player_id === callerPlayerId)
  })
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const { user, profile } = await requireRoleForApi('officer')
  const guildCode = profile.guild_code
  if (!guildCode) {
    throw Errors.forbidden('Current guild membership required')
  }

  const rawBody = await parseJsonBody<unknown>(request, () =>
    Errors.validation('Invalid JSON body')
  )
  const body = validateTeamBody(rawBody, { requireName: true })

  const supabase = await db()
  const { data, error } = await supabase
    .from('guild_war_meta_teams')
    .insert({
      guild_code: guildCode,
      name: body.name!,
      side: body.side ?? 'offense',
      priority: body.priority ?? null,
      notes: body.notes ?? null,
      heroes: body.heroes! as unknown as Json,
      created_by: user.id
    })
    .select(TEAM_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      throw Errors.validation('A team with that name already exists', {
        field: 'name'
      })
    }
    logger.error({ error, guildCode }, 'War Room shared-team create failed')
    throw Errors.internal('Failed to create team')
  }

  return NextResponse.json({ team: data }, { status: 201 })
})

export const PATCH = withErrorHandler(async (request: NextRequest) => {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const { profile } = await requireRoleForApi('officer')
  const guildCode = profile.guild_code
  if (!guildCode) {
    throw Errors.forbidden('Current guild membership required')
  }

  const rawBody = await parseJsonBody<unknown>(request, () =>
    Errors.validation('Invalid JSON body')
  )
  const body = validateTeamBody(rawBody, { requireName: false })
  if (!body.id) {
    throw Errors.validation('Team id is required', { field: 'id' })
  }

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.side !== undefined) patch.side = body.side
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.heroes !== undefined) patch.heroes = body.heroes

  const supabase = await db()
  const { data, error } = await supabase
    .from('guild_war_meta_teams')
    .update(patch as TablesUpdate<'guild_war_meta_teams'>)
    .eq('id', body.id)
    .eq('guild_code', guildCode)
    .select(TEAM_COLUMNS)
    .single()

  if (error) {
    if (error.code === '23505') {
      throw Errors.validation('A team with that name already exists', {
        field: 'name'
      })
    }
    if (error.code === 'PGRST116') {
      throw Errors.notFound('Team')
    }
    logger.error(
      { error, guildCode, teamId: body.id },
      'War Room shared-team update failed'
    )
    throw Errors.internal('Failed to update team')
  }

  return NextResponse.json({ team: data })
})

export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const { profile } = await requireRoleForApi('officer')
  const guildCode = profile.guild_code
  if (!guildCode) {
    throw Errors.forbidden('Current guild membership required')
  }

  const id = request.nextUrl.searchParams.get('id')?.trim()
  if (!id || !UUID_PATTERN.test(id)) {
    throw Errors.validation('A valid Team id is required', { field: 'id' })
  }

  const supabase = await db()
  const { data, error } = await supabase
    .from('guild_war_meta_teams')
    .delete()
    .eq('id', id)
    .eq('guild_code', guildCode)
    .select('id')
    .maybeSingle()

  if (error) {
    logger.error(
      { error, guildCode, teamId: id },
      'War Room shared-team delete failed'
    )
    throw Errors.internal('Failed to delete team')
  }
  if (!data) {
    throw Errors.notFound('Team')
  }

  return NextResponse.json({ ok: true })
})
