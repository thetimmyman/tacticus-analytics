import { NextRequest, NextResponse } from 'next/server'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { db, serviceDb } from '@/app/lib/db'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.user.token-alerts')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import {
  DEFAULT_PREFS,
  PREFS_COLUMNS,
  PREFS_COLUMNS_WITH_VERSION,
  isCompleteBody,
  mergeWithStored,
  validatePutBody,
  type PutBody,
  type TokenAlertPrefs
} from './preferences-model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `updated_at` doubles as the compare-and-set version. */
type StoredPrefsRow = TokenAlertPrefs & { updated_at: string }

interface TokenAlertsAvailableResponse {
  available: true
  linked: boolean
  dmBlocked: boolean
  /** Guild has an active Discord-server link: proxy for "bot can DM this user". */
  botInstalled: boolean
  canSetupBot: boolean
  prefs: TokenAlertPrefs
}

interface TokenAlertsUnavailableResponse {
  available: false
}

type PostgrestLikeError = { code?: string; message?: string } | null | undefined

/** Tables not created yet (pre-migration deploy): `42P01` or `PGRST205`. */
function isMissingRelationError(error: PostgrestLikeError): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /could not find the table/i.test(error.message ?? '')
  )
}

/** Missing column (`42703`/`PGRST204`); read paths only, as on a write it means a typo. */
function isMissingColumnError(error: PostgrestLikeError): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204'
}

function isReadDegradable(error: PostgrestLikeError): boolean {
  return isMissingRelationError(error) || isMissingColumnError(error)
}

/** A concurrent PUT inserted the row first; the primary key is the compare-and-set. */
function isUniqueViolation(error: PostgrestLikeError): boolean {
  return error?.code === '23505'
}

interface CurrentMappingRow {
  id: number
  user_id: string
  player_id: string | null
  guild_code: string | null
  discord_user_id: string | null
  role: string | null
}

type LoadedMapping =
  | { readonly ok: true; readonly mapping: CurrentMappingRow | null }
  | { readonly ok: false }

async function loadCurrentMapping(
  service: TypedSupabaseClient,
  userId: string
): Promise<LoadedMapping> {
  const { data, error } = await service
    .from('player_mapping')
    .select('id, user_id, player_id, guild_code, discord_user_id, role')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    logger.warn(
      { err: error, userId },
      '[token-alerts] Failed to resolve Discord link status'
    )
    return { ok: false }
  }
  return { ok: true, mapping: (data as CurrentMappingRow | null) ?? null }
}

async function mappingIsVerifiedLinked(
  service: TypedSupabaseClient,
  mapping: CurrentMappingRow | null
): Promise<boolean> {
  if (!mapping?.discord_user_id) return false
  const verified = await resolveVerifiedDiscordIdentities(service, [
    mapping.discord_user_id
  ])
  return Boolean(
    findVerifiedDiscordForMapping(verified, {
      mappingId: mapping.id,
      playerId: mapping.player_id,
      userId: mapping.user_id,
      guildCode: mapping.guild_code,
      discordUserId: mapping.discord_user_id
    })
  )
}

async function loadDiscordLinked(
  _supabase: TypedSupabaseClient,
  userId: string
): Promise<boolean> {
  const service = serviceDb()
  const loaded = await loadCurrentMapping(service, userId)
  if (!loaded.ok) return false
  return mappingIsVerifiedLinked(service, loaded.mapping)
}

/**
 * An active `discord_server_guilds` link proxies "bot installed". Fails open on no guild
 * or read error, so a transient failure does not swap the panel for a setup CTA.
 */
async function loadGuildBotInstalled(
  service: TypedSupabaseClient,
  guildCode: string | null
): Promise<boolean> {
  if (!guildCode) return true
  const { data, error } = await service
    .from('discord_server_guilds')
    .select('discord_guild_id')
    .eq('game_guild_code', guildCode)
    .eq('is_active', true)
    .limit(1)

  if (error) {
    logger.warn(
      { err: error, guildCode },
      '[token-alerts] Failed to load Discord bot install state'
    )
    return true
  }
  return (data?.length ?? 0) > 0
}

interface DiscordDeliveryStatus {
  linked: boolean
  botInstalled: boolean
  canSetupBot: boolean
}

async function loadDiscordDeliveryStatus(
  userId: string
): Promise<DiscordDeliveryStatus> {
  const service = serviceDb()
  const loaded = await loadCurrentMapping(service, userId)
  if (!loaded.ok) {
    // Fail open: "not linked" already shows; do not also claim the bot is missing.
    return { linked: false, botInstalled: true, canSetupBot: false }
  }

  const [linked, botInstalled] = await Promise.all([
    mappingIsVerifiedLinked(service, loaded.mapping),
    loadGuildBotInstalled(service, loaded.mapping?.guild_code ?? null)
  ])

  return {
    linked,
    botInstalled,
    canSetupBot: canManageHeraldRole(loaded.mapping?.role)
  }
}

async function loadDmBlocked(
  supabase: TypedSupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_token_alert_state')
    .select('dm_blocked_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error && !isMissingRelationError(error)) {
    logger.warn(
      { err: error, userId },
      '[token-alerts] Failed to load alert state'
    )
  }

  return Boolean(data?.dm_blocked_at)
}

function toPrefsShape(
  row: TokenAlertPrefs | null | undefined
): TokenAlertPrefs {
  if (!row) return { ...DEFAULT_PREFS }
  return {
    alert_on_full: row.alert_on_full,
    alert_on_full_repeat_hours: row.alert_on_full_repeat_hours,
    alert_before_full: row.alert_before_full,
    alert_before_full_minutes: row.alert_before_full_minutes,
    alert_on_token_gained: row.alert_on_token_gained,
    alert_on_bomb_ready: row.alert_on_bomb_ready,
    alert_before_bomb_ready: row.alert_before_bomb_ready,
    alert_before_bomb_ready_minutes: row.alert_before_bomb_ready_minutes,
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    quiet_hours_timezone: row.quiet_hours_timezone,
    alert_before_quiet_hours: row.alert_before_quiet_hours,
    alert_before_quiet_hours_minutes: row.alert_before_quiet_hours_minutes,
    alert_before_burn: row.alert_before_burn,
    alert_before_burn_minutes: row.alert_before_burn_minutes
  }
}

export const GET = withErrorHandler(async () => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  // Export storage does not establish the hosted Discord delivery authority.
  // Local notification delivery remains a separate desktop capability.
  if (getRuntimeProfile() === 'desktop')
    return NextResponse.json({
      available: false,
      reason: 'Local token-alert delivery is not configured'
    })

  const { data: prefsRow, error: prefsError } = await supabase
    .from('user_token_alert_prefs')
    .select(PREFS_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle()

  if (prefsError && isReadDegradable(prefsError)) {
    logger.info(
      { userId: user.id },
      '[token-alerts] prefs unreadable - pre-migration deploy window'
    )
    const response: TokenAlertsUnavailableResponse = { available: false }
    return NextResponse.json(response)
  }

  if (prefsError) {
    logger.error(
      { err: prefsError, userId: user.id },
      '[token-alerts] Failed to load prefs'
    )
    throw Errors.database('Failed to load token alert preferences')
  }

  const [discordStatus, dmBlocked] = await Promise.all([
    loadDiscordDeliveryStatus(user.id),
    loadDmBlocked(supabase, user.id)
  ])

  const response: TokenAlertsAvailableResponse = {
    available: true,
    ...discordStatus,
    dmBlocked,
    // Forward-schema cast: generated types lag additive columns by a rollout.
    prefs: toPrefsShape(prefsRow as unknown as TokenAlertPrefs | null)
  }

  return NextResponse.json(response)
})

/**
 * A missing-column write error is ambiguous (rollback vs typo'd key); reading the
 * independent PREFS_COLUMNS literal tells them apart so a typo still 500s.
 */
async function prefsColumnsMissing(
  supabase: TypedSupabaseClient,
  userId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('user_token_alert_prefs')
    .select(PREFS_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  return isReadDegradable(error)
}

type LoadedPrefs =
  | { readonly kind: 'ok'; readonly row: StoredPrefsRow | null }
  | { readonly kind: 'degrade' }

async function loadStoredPrefs(
  supabase: TypedSupabaseClient,
  userId: string
): Promise<LoadedPrefs> {
  const { data, error } = await supabase
    .from('user_token_alert_prefs')
    .select(PREFS_COLUMNS_WITH_VERSION)
    .eq('user_id', userId)
    .maybeSingle()

  if (error && isReadDegradable(error)) {
    logger.info(
      { userId },
      '[token-alerts] prefs unreadable on PUT - pre-migration deploy window'
    )
    return { kind: 'degrade' }
  }
  if (error) {
    logger.error(
      { err: error, userId },
      '[token-alerts] Failed to load prefs before save'
    )
    throw Errors.database('Failed to load token alert preferences')
  }
  return { kind: 'ok', row: (data as StoredPrefsRow | null) ?? null }
}

/** Every toggle here delivers a DM; quiet-hours fields only suppress, so are excluded. */
async function requireDiscordLinkIfEnabling(
  supabase: TypedSupabaseClient,
  userId: string,
  prefs: TokenAlertPrefs
): Promise<void> {
  const enablingAny =
    prefs.alert_on_full ||
    prefs.alert_before_full ||
    prefs.alert_on_token_gained ||
    prefs.alert_on_bomb_ready ||
    prefs.alert_before_bomb_ready ||
    // Must match the cron opt-in guard, or alerts silently never fire.
    prefs.alert_before_quiet_hours ||
    prefs.alert_before_burn
  if (!enablingAny) return

  const linked = await loadDiscordLinked(supabase, userId)
  if (!linked) {
    throw Errors.fromResponse(409, {
      error: 'DISCORD_NOT_LINKED',
      code: 'DISCORD_NOT_LINKED'
    })
  }
}

/** `null` means "degrade to {available:false}". */
type SaveResult = TokenAlertPrefs | null

/** Complete body: unconditional upsert; overlapping PUTs are last-writer-wins. */
async function savePrefsWhole(
  supabase: TypedSupabaseClient,
  userId: string,
  body: PutBody
): Promise<SaveResult> {
  const prefs = validatePutBody(body)
  await requireDiscordLinkIfEnabling(supabase, userId, prefs)

  const { error } = await supabase.from('user_token_alert_prefs').upsert(
    {
      user_id: userId,
      ...prefs,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  )

  if (!error) return prefs

  if (isMissingRelationError(error)) {
    logger.info(
      { userId },
      '[token-alerts] prefs table missing on PUT - pre-migration deploy window'
    )
    return null
  }
  // Not isReadDegradable: a missing column degrades only once prefsColumnsMissing confirms it.
  if (
    isMissingColumnError(error) &&
    (await prefsColumnsMissing(supabase, userId))
  ) {
    logger.info(
      { userId },
      '[token-alerts] prefs columns missing on PUT - rollback window'
    )
    return null
  }

  logger.error({ err: error, userId }, '[token-alerts] Failed to upsert prefs')
  throw Errors.database('Failed to save token alert preferences')
}

/** Read-modify-write attempts before a lost race is reported as a 409. */
const MERGE_WRITE_ATTEMPTS = 2

/**
 * Partial body (older clients): read-merge-write with a compare-and-set on
 * `updated_at`, so a lost race retries once then 409s rather than overwriting.
 */
async function savePrefsMerged(
  supabase: TypedSupabaseClient,
  userId: string,
  body: PutBody
): Promise<SaveResult> {
  for (let attempt = 1; attempt <= MERGE_WRITE_ATTEMPTS; attempt++) {
    const loaded = await loadStoredPrefs(supabase, userId)
    if (loaded.kind === 'degrade') return null

    const stored = loaded.row
    const prefs = validatePutBody(mergeWithStored(body, stored))
    await requireDiscordLinkIfEnabling(supabase, userId, prefs)
    const row = { ...prefs, updated_at: new Date().toISOString() }

    if (stored == null) {
      // No version yet, so the primary key is the compare-and-set (23505 on a race).
      const { error } = await supabase
        .from('user_token_alert_prefs')
        .insert({ user_id: userId, ...row })

      if (!error) return prefs
      if (isUniqueViolation(error)) continue
      if (isMissingRelationError(error)) {
        logger.info(
          { userId },
          '[token-alerts] prefs table missing on PUT - pre-migration deploy window'
        )
        return null
      }
      logger.error(
        { err: error, userId },
        '[token-alerts] Failed to insert prefs'
      )
      throw Errors.database('Failed to save token alert preferences')
    }

    const { data, error } = await supabase
      .from('user_token_alert_prefs')
      .update(row)
      .eq('user_id', userId)
      // Compare-and-set: a row changed since the read matches zero rows.
      .eq('updated_at', stored.updated_at)
      .select('user_id')

    if (error) {
      if (isMissingRelationError(error)) {
        logger.info(
          { userId },
          '[token-alerts] prefs table missing on PUT - pre-migration deploy window'
        )
        return null
      }
      logger.error(
        { err: error, userId },
        '[token-alerts] Failed to update prefs'
      )
      throw Errors.database('Failed to save token alert preferences')
    }

    if (data != null && data.length > 0) return prefs
    // Zero rows matched: another write landed; loop to re-read and merge.
  }

  logger.warn(
    { userId },
    '[token-alerts] prefs save lost a concurrent write race twice'
  )
  throw Errors.conflict(
    'Token alert preferences changed while saving; please retry'
  )
}

export const PUT = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  if (getRuntimeProfile() === 'desktop')
    throw Errors.conflict('Local token-alert delivery is not configured')

  let body: PutBody
  try {
    body = await request.json()
  } catch (error) {
    rethrowIfAppError(error)
    throw Errors.validation('Invalid JSON body')
  }

  // `null`, arrays and scalars parse as JSON but cannot carry fields.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw Errors.validation('Body must be a JSON object')
  }

  const prefs = isCompleteBody(body)
    ? await savePrefsWhole(supabase, user.id, body)
    : await savePrefsMerged(supabase, user.id, body)

  if (prefs == null) {
    const response: TokenAlertsUnavailableResponse = { available: false }
    return NextResponse.json(response)
  }

  // Service role only because RLS on user_token_alert_state is owner-SELECT-only;
  // the update is hard-scoped to the authenticated caller's user_id.
  try {
    const service = serviceDb()
    const { error: stateError } = await service
      .from('user_token_alert_state')
      .update({ dm_blocked_at: null, consecutive_dm_failures: 0 })
      .eq('user_id', user.id)

    if (stateError && !isMissingRelationError(stateError)) {
      logger.warn(
        { err: stateError, userId: user.id },
        '[token-alerts] Failed to clear dm block'
      )
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.warn(
      { err: error, userId: user.id },
      '[token-alerts] Failed to clear dm block'
    )
  }

  const [discordStatus, dmBlocked] = await Promise.all([
    loadDiscordDeliveryStatus(user.id),
    loadDmBlocked(supabase, user.id)
  ])

  const response: TokenAlertsAvailableResponse = {
    available: true,
    ...discordStatus,
    dmBlocked,
    prefs
  }

  return NextResponse.json(response)
})
