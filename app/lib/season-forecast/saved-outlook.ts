import 'server-only'

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { db } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { AppError, Errors } from '@/app/lib/errors/AppError'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import {
  resolveSavedPlanningRotation,
  resolveSavedSeasonWindow
} from '@/app/lib/boss-assignments/season-planner/saved-season'
import { generateSeasonPlanForGuild } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import { reduceSeasonOutlookDetail } from './season-outlook-reduce'
import { scopeOutlookPlayers } from './outlook-player-scope'
import type { SavedSeasonOutlook } from './saved-outlook-types'

const SAVED_OUTLOOK_TIMEOUT_MS = 7000
const READ_TABLES = new Set([
  'current_user_player_mapping',
  'guild_config',
  'player_mapping',
  'EOT_GR_data',
  'raid_progression_config',
  'boss_target_tokens',
  'upcoming_season_bosses'
])

export function parseSavedOutlookQuery(params: URLSearchParams) {
  const allowed = new Set(['guildCode', 'season', 'asOf'])
  for (const key of params.keys())
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw Errors.validation('Unsupported saved outlook parameter')
  const guildCode = params.get('guildCode') ?? ''
  const season = params.get('season') ?? ''
  const rawAsOf = params.get('asOf') ?? ''
  if (
    !guildCode ||
    guildCode !== guildCode.trim() ||
    guildCode.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(guildCode) ||
    !/^[1-9]\d{0,5}$/.test(season) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(rawAsOf)
  )
    throw Errors.validation('guildCode, season and UTC asOf are required')
  const asOfMs = Date.parse(rawAsOf)
  if (!Number.isFinite(asOfMs))
    throw Errors.validation('Invalid saved outlook asOf')
  const asOf = new Date(asOfMs).toISOString()
  if (
    asOf !== (rawAsOf.length === 20 ? rawAsOf.replace('Z', '.000Z') : rawAsOf)
  )
    throw Errors.validation('Invalid saved outlook asOf')
  return { guildCode, season, asOf, asOfMs }
}

type ReadResult = { data: unknown; error: unknown }
type ReadQuery = PromiseLike<ReadResult> & {
  throwOnError(): ReadQuery
  abortSignal(signal: AbortSignal): ReadQuery
  retry(enabled: boolean): ReadQuery
}

/** Fresh builders retain their public filter methods and receiver. No client is
 * mutated. Remember failures because canonical optional reads may catch them. */
function strictReads(
  client: TypedSupabaseClient,
  signal: AbortSignal,
  assertRunning: () => void
) {
  let failed = false
  const guard = (query: ReadQuery) => {
    query.throwOnError().abortSignal(signal).retry(false)
    const execute = query.then.bind(query)
    query.then = (fulfilled, rejected) => {
      assertRunning()
      const result = Promise.resolve(
        execute((value) => {
          if (value.error)
            throw Errors.external('Saved outlook reads unavailable', 503)
          return value
        })
      ).catch(() => {
        failed = true
        throw Errors.external('Saved outlook reads unavailable', 503)
      })
      return result.then(fulfilled, rejected)
    }
    return query
  }
  const from = (table: string) => {
    if (!READ_TABLES.has(table)) {
      failed = true
      throw Errors.external('Saved outlook reads unavailable', 503)
    }
    return {
      select(columns: string) {
        try {
          return guard(
            client
              .from(table as 'guild_config')
              .select(columns) as unknown as ReadQuery
          )
        } catch {
          failed = true
          throw Errors.external('Saved outlook reads unavailable', 503)
        }
      }
    }
  }
  return {
    client: { from } as unknown as TypedSupabaseClient,
    guard,
    assertSucceeded() {
      if (failed) throw Errors.external('Saved outlook reads unavailable', 503)
    }
  }
}

/** Caller client only, no shared detail/negative cache and no persistence. */
export async function computeSavedSeasonOutlook(args: {
  guildCode: string
  season: string
  asOf: string
  signal: AbortSignal
}): Promise<SavedSeasonOutlook> {
  if (getRuntimeProfile() !== 'desktop')
    throw Errors.external(
      'Saved outlook is available in local workspaces only',
      503
    )
  const query = parseSavedOutlookQuery(
    new URLSearchParams({
      guildCode: args.guildCode,
      season: args.season,
      asOf: args.asOf
    })
  )
  const guild = normalizeGuildIdentifier(query.guildCode)
  const { season, asOf } = query
  const controller = new AbortController()
  const deadline = performance.now() + SAVED_OUTLOOK_TIMEOUT_MS
  let interruption: AppError | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      interruption ??= Errors.timeout('Saved outlook calculation canceled')
      reject(interruption)
      controller.abort()
    }
    if (args.signal.aborted) onAbort()
    else args.signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      interruption ??= Errors.external(
        'Saved outlook calculation timed out',
        503
      )
      reject(interruption)
      controller.abort()
    }, SAVED_OUTLOOK_TIMEOUT_MS)
  })
  const assertRunning = () => {
    if (interruption) throw interruption
    if (performance.now() >= deadline) {
      interruption = Errors.external('Saved outlook calculation timed out', 503)
      controller.abort()
      throw interruption
    }
  }
  const calculate = async (): Promise<SavedSeasonOutlook> => {
    assertRunning()
    const client = await Promise.race([db(), interrupted])
    assertRunning()
    const identity = await Promise.race([
      client.auth.getUser(),
      interrupted
    ]).catch((error: unknown) => {
      if (error === interruption) throw error
      throw Errors.external('Saved outlook authentication unavailable', 503)
    })
    assertRunning()
    // Canonical session and ban checks consume the actual verified Auth result.
    // The wrapper prevents a late Auth completion from starting further reads.
    const user = await requireSessionUser(
      {
        auth: { getUser: async () => identity }
      } as Pick<TypedSupabaseClient, 'auth'>,
      undefined,
      controller.signal
    )
    assertRunning()
    const reads = strictReads(client, controller.signal, assertRunning)
    const currentMembership = async () => {
      assertRunning()
      const { data: membership } = await reads.client
        .from(CURRENT_USER_PLAYER_MAPPING)
        .select('player_id, guild_code, role')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .eq('is_active', true)
        .maybeSingle()
      if (
        !membership ||
        !membership.player_id ||
        normalizeGuildIdentifier(membership.guild_code) !== guild
      )
        throw Errors.forbidden('Current guild membership required')
      return membership
    }
    await currentMembership()
    const { data: seasons } = await reads.guard(
      client.rpc('get_distinct_seasons_for_guild', {
        p_guild: guild
      }) as unknown as ReadQuery
    )
    if (!Array.isArray(seasons))
      throw Errors.external('Saved seasons unavailable', 503)
    if (!seasons.includes(season))
      throw Errors.unprocessable(
        'Import raid data for the selected saved season'
      )
    const rotation = resolveSavedPlanningRotation(season, asOf)
    const { seasonStartMs, seasonEndMs } = resolveSavedSeasonWindow(season)
    const asOfMs = Date.parse(asOf)
    if (
      !Number.isFinite(asOfMs) ||
      asOfMs < seasonStartMs ||
      asOfMs >= seasonEndMs
    )
      throw Errors.unprocessable(
        'asOf must be within the selected saved season'
      )
    const { data: config } = await reads.client
      .from('guild_config')
      .select('guild_code, timezone')
      .eq('guild_code', guild)
      .maybeSingle()
    if (!config)
      throw Errors.external('Saved guild configuration unavailable', 503)
    const timeZone = config.timezone ?? 'UTC'
    try {
      if (!timeZone || timeZone.length > 128) throw new Error()
      new Intl.DateTimeFormat('en', { timeZone })
    } catch {
      throw Errors.unprocessable('Saved guild timezone is invalid')
    }
    const payload = await generateSeasonPlanForGuild({
      guildCode: guild,
      season,
      snapshotAt: asOf,
      lookbackDays: 30,
      sessionsPerDay: 2,
      timeZone,
      configId: rotation.currentConfigId,
      signedClient: reads.client
    })
    reads.assertSucceeded()
    assertRunning()
    const membership = await currentMembership()
    reads.assertSucceeded()
    const detail = reduceSeasonOutlookDetail(payload, {
      guildCode: guild,
      seasonNumber: Number(season),
      nowMs: asOfMs
    })
    const result: SavedSeasonOutlook = {
      projection: detail.projection,
      model: {
        appliedDamage: payload.plan.sessions.reduce(
          (total, session) =>
            total +
            session.actions.reduce(
              (sum, action) => sum + action.appliedDamage,
              0
            ),
          0
        )
      },
      players: scopeOutlookPlayers({
        players: detail.players,
        role: membership.role,
        selfPlayerId: membership.player_id
      }),
      saved: {
        status: 'ready',
        source: 'saved-season',
        season,
        configId: rotation.currentConfigId!,
        asOf,
        timeZone
      }
    }
    assertRunning()
    return result
  }
  try {
    return await Promise.race([calculate(), interrupted])
  } catch (error) {
    if (error instanceof AppError)
      throw Errors.fromStatus(error.statusCode, error.message)
    throw Errors.external('Saved outlook calculation unavailable', 503)
  } finally {
    clearTimeout(timer)
    if (onAbort) args.signal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}
