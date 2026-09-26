// One projection RPC per guild, pure decision per user, capped sequential DMs, batched baseline upsert.

import { serviceDb } from '@/app/lib/db'
import { softDeadlineFor } from '@/app/lib/jobs/deadline'
import { MAX_TOKENS } from '@/app/lib/calculations/token-calculation'
import {
  decideAlerts,
  minutesUntilLocalHour,
  secondsToNextBurn,
  type AlertType,
  type BombReadingInput
} from '@/app/lib/token-alerts/decision-core'
import {
  sendDiscordDirectMessage,
  type SendDiscordDirectMessageResult
} from '@/app/lib/discord/dm-service'
import { createComponentLogger } from '@/app/lib/logging'
import type {
  ObservedTokenState,
  UserTokenAlertPrefs,
  UserTokenAlertScanSummary,
  UserTokenAlertState
} from '@/app/lib/token-alerts/types'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'

const logger = createComponentLogger('lib.token-alerts.scan')

export const MAX_DMS_PER_RUN = 100

// Stays under the stuck-job reaper so a second scan cannot double-DM unpersisted users.
export const SCAN_SOFT_TIMEOUT_MS = 120_000

export const DM_BLOCK_THRESHOLD = 3

interface PlayerMappingRow {
  id: number
  user_id: string | null
  player_id: string
  guild_code: string | null
  discord_user_id: string | null
  display_name: string | null
  next_bomb_seconds: number | null
  last_sync_bombs: number | null
  last_sync_at: string | null
}

interface TokenStateRpcRow {
  player_id: string | null
  tokens_available: number | null
  token_next_in_seconds: number | null
  data_source: string | null
  bombs_available: number | null
  bomb_next_in_seconds: number | null
}

/** Required: PostgREST batch upserts send NULL for a missing key, so freezing means re-writing the old value. */
interface ScanBaselineColumns {
  last_tokens: number | null
  last_time_to_full_seconds: number | null
  last_bombs: number | null
  last_time_to_bomb_seconds: number | null
  quiet_hours_deferred_since: string | null
  /** Written unconditionally: deriveCappedSince is sticky, so freezing it is a bug. */
  capped_since: string | null
  last_scan_at: string
}

type UserTokenAlertStateUpsert = {
  user_id: string
  updated_at: string
} & Partial<Omit<UserTokenAlertState, 'user_id'>>

// `.in()` lists go in the query string; large cohorts would hit 414. Chunk.
const USER_ID_CHUNK_SIZE = 200

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tacticusanalytics.com'
  ).replace(/\/+$/, '')
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

// Glyphs declared once: the emoji ratchet counts occurrences in app source.
const TOKEN_LEAD = '🪙'
const BOMB_LEAD = '💣'

/** Every message ends with the settings link (the off switch). */
export function buildAlertMessage(
  alert: AlertType,
  observed: ObservedTokenState,
  opts: {
    tokenNextInSeconds: number | null
    delta: number
    bombNextInSeconds?: number | null
    burnInSeconds?: number | null
    quietStartsInMinutes?: number | null
  }
): string {
  let body: string
  if (alert === 'full') {
    body = `${TOKEN_LEAD} Your Tacticus raid tokens are FULL (${MAX_TOKENS}/${MAX_TOKENS}) — regen is paused until you spend one.`
  } else if (alert === 'prewarn') {
    body = `${TOKEN_LEAD} Your raid tokens will be full in about ${formatDuration(
      observed.timeToFullSeconds ?? 0
    )} (${observed.tokens}/${MAX_TOKENS}).`
  } else if (alert === 'burn_prewarn') {
    body = `${TOKEN_LEAD} You'll BURN a raid token in about ${formatDuration(
      opts.burnInSeconds ?? 0
    )} — you're at ${MAX_TOKENS}/${MAX_TOKENS}, so spend one to keep it.`
  } else if (alert === 'pre_quiet') {
    const lead = formatDuration((opts.quietStartsInMinutes ?? 0) * 60)
    body =
      observed.tokens >= MAX_TOKENS
        ? `${TOKEN_LEAD} Quiet hours start in about ${lead} and your raid tokens are FULL (${MAX_TOKENS}/${MAX_TOKENS}) — spend one now or you'll burn overnight.`
        : `${TOKEN_LEAD} Quiet hours start in about ${lead} and your raid tokens (${observed.tokens}/${MAX_TOKENS}) will cap during it — spend one now to avoid burning overnight.`
  } else if (alert === 'bomb_ready') {
    body = `${BOMB_LEAD} Your Tacticus raid bomb is ready to use.`
  } else if (alert === 'bomb_prewarn') {
    body = `${BOMB_LEAD} Your raid bomb will be ready in about ${formatDuration(
      opts.bombNextInSeconds ?? 0
    )}.`
  } else {
    const gainedLead =
      opts.delta > 1
        ? `${TOKEN_LEAD} Raid tokens gained (+${opts.delta})`
        : `${TOKEN_LEAD} Raid token gained`
    const nextPart =
      observed.tokens < MAX_TOKENS && opts.tokenNextInSeconds != null
        ? ` Next in ${formatDuration(opts.tokenNextInSeconds)}.`
        : ''
    body = `${gainedLead} — you're at ${observed.tokens}/${MAX_TOKENS}.${nextPart}`
  }
  return `${body}\nManage these alerts: ${baseUrl()}/profile`
}

/** Own column per kind so kinds cannot re-arm or suppress each other. */
const ALERT_TIMESTAMP_COLUMN: Record<
  AlertType,
  | 'last_full_alert_at'
  | 'last_prewarn_alert_at'
  | 'last_gain_alert_at'
  | 'last_bomb_ready_alert_at'
  | 'last_bomb_prewarn_alert_at'
  | 'last_pre_quiet_alert_at'
  | 'last_burn_prewarn_alert_at'
> = {
  full: 'last_full_alert_at',
  prewarn: 'last_prewarn_alert_at',
  gained: 'last_gain_alert_at',
  bomb_ready: 'last_bomb_ready_alert_at',
  bomb_prewarn: 'last_bomb_prewarn_alert_at',
  pre_quiet: 'last_pre_quiet_alert_at',
  burn_prewarn: 'last_burn_prewarn_alert_at'
}

export interface RunUserTokenAlertScanOptions {
  softDeadlineAt?: number
}

export async function runUserTokenAlertScan(
  options: RunUserTokenAlertScanOptions = {}
): Promise<UserTokenAlertScanSummary> {
  const db = serviceDb()
  const deadlineAt = softDeadlineFor(Date.now(), SCAN_SOFT_TIMEOUT_MS, {
    softDeadlineAt: options.softDeadlineAt
  })

  const summary: UserTokenAlertScanSummary = {
    scannedUsers: 0,
    alertsSent: 0,
    byType: {
      full: 0,
      prewarn: 0,
      gained: 0,
      bomb_ready: 0,
      bomb_prewarn: 0,
      pre_quiet: 0,
      burn_prewarn: 0
    },
    dmBlocked: 0,
    rateLimited: 0,
    errors: 0,
    quietHoursDeferred: 0,
    quietHoursDropped: 0,
    quietHoursMaxDeferOverrides: 0,
    quietHoursConfigErrors: 0,
    bombReadingsUntrusted: 0
  }

  // Any delivery toggle true. Must mirror the enqueue guard exactly.
  const { data: prefRows, error: prefsError } = await db
    .from('user_token_alert_prefs')
    .select(
      'user_id, alert_on_full, alert_on_full_repeat_hours, alert_before_full, alert_before_full_minutes, alert_on_token_gained, alert_on_bomb_ready, alert_before_bomb_ready, alert_before_bomb_ready_minutes, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, alert_before_quiet_hours, alert_before_quiet_hours_minutes, alert_before_burn, alert_before_burn_minutes'
    )
    .or(
      'alert_on_full.eq.true,alert_before_full.eq.true,alert_on_token_gained.eq.true,alert_on_bomb_ready.eq.true,alert_before_bomb_ready.eq.true,alert_before_quiet_hours.eq.true,alert_before_burn.eq.true'
    )
    // Deterministic order keeps the send cap and abort point stable.
    .order('user_id', { ascending: true })

  if (prefsError) {
    throw new Error(`Failed to load token alert prefs: ${prefsError.message}`)
  }

  const prefs = (prefRows ?? []) as unknown as UserTokenAlertPrefs[]
  if (prefs.length === 0) return summary

  const userIds = prefs.map((p) => p.user_id)

  const mappingRows: PlayerMappingRow[] = []
  for (const idBatch of chunk(userIds, USER_ID_CHUNK_SIZE)) {
    const { data: batchRows, error: mappingError } = await db
      .from('player_mapping')
      // Bomb trust columns ride on this select to avoid an N+1 / 414.
      .select(
        'id, user_id, player_id, guild_code, discord_user_id, display_name, next_bomb_seconds, last_sync_bombs, last_sync_at'
      )
      .in('user_id', idBatch)
      .eq('is_current', true)
      // A user can hold current mappings in two guilds; stable pick.
      .order('guild_code', { ascending: true })

    if (mappingError) {
      throw new Error(`Failed to load player mappings: ${mappingError.message}`)
    }
    if (batchRows) mappingRows.push(...(batchRows as PlayerMappingRow[]))
  }

  const verifiedDiscord = await resolveVerifiedDiscordIdentities(
    db,
    mappingRows
      .map((row) => row.discord_user_id)
      .filter((id): id is string => Boolean(id))
  )
  const mappingByUser = new Map<string, PlayerMappingRow>()
  for (const candidate of (mappingRows ?? []) as PlayerMappingRow[]) {
    const row = {
      ...candidate,
      discord_user_id:
        findVerifiedDiscordForMapping(verifiedDiscord, {
          mappingId: candidate.id,
          playerId: candidate.player_id,
          userId: candidate.user_id,
          guildCode: candidate.guild_code,
          discordUserId: candidate.discord_user_id
        })?.discordUserId ?? null
    }
    if (row.user_id && !mappingByUser.has(row.user_id)) {
      mappingByUser.set(row.user_id, row)
    }
  }

  const stateRows: UserTokenAlertState[] = []
  for (const idBatch of chunk(userIds, USER_ID_CHUNK_SIZE)) {
    const { data: batchRows, error: stateError } = await db
      .from('user_token_alert_state')
      .select(
        // Every column is load-bearing; an omitted one reads as "no baseline".
        'user_id, last_tokens, last_time_to_full_seconds, last_scan_at, last_full_alert_at, last_prewarn_alert_at, last_gain_alert_at, consecutive_dm_failures, dm_blocked_at, dm_channel_id, dm_channel_recipient_id, last_bombs, last_time_to_bomb_seconds, last_bomb_ready_alert_at, last_bomb_prewarn_alert_at, quiet_hours_deferred_since, capped_since, last_pre_quiet_alert_at, last_burn_prewarn_alert_at'
      )
      .in('user_id', idBatch)

    if (stateError) {
      throw new Error(`Failed to load token alert state: ${stateError.message}`)
    }
    if (batchRows) {
      stateRows.push(...(batchRows as unknown as UserTokenAlertState[]))
    }
  }

  const stateByUser = new Map<string, UserTokenAlertState>()
  for (const row of (stateRows ?? []) as UserTokenAlertState[]) {
    stateByUser.set(row.user_id, row)
  }

  // A failed guild degrades to "no projection row": no alerts, state untouched.
  const guildCodes = new Set<string>()
  for (const mapping of mappingByUser.values()) {
    if (mapping.guild_code) guildCodes.add(mapping.guild_code)
  }

  const tokenStateByGuild = new Map<string, Map<string, TokenStateRpcRow>>()
  for (const guildCode of guildCodes) {
    const { data, error } = await db.rpc('get_player_token_state', {
      p_guild_code: guildCode
    })
    if (error) {
      summary.errors++
      logger.warn(
        { guildCode, error: error.message },
        'get_player_token_state failed for guild; skipping its users'
      )
      continue
    }
    const byPlayer = new Map<string, TokenStateRpcRow>()
    for (const row of (data ?? []) as TokenStateRpcRow[]) {
      if (typeof row.player_id === 'string') byPlayer.set(row.player_id, row)
    }
    tokenStateByGuild.set(guildCode, byPlayer)
  }

  const now = new Date()
  const nowIso = now.toISOString()
  let sendAttempts = 0
  let stopSending = false
  const observedUpserts: UserTokenAlertStateUpsert[] = []

  const upsertState = async (row: UserTokenAlertStateUpsert) => {
    const { error } = await db
      .from('user_token_alert_state')
      .upsert(row, { onConflict: 'user_id' })
    if (error) {
      summary.errors++
      logger.error(
        { userId: row.user_id, error: error.message },
        'user_token_alert_state upsert failed — user may be re-alerted next scan'
      )
    }
  }

  for (const pref of prefs) {
    const mapping = mappingByUser.get(pref.user_id)
    if (!mapping?.guild_code) continue

    const rpcRow = tokenStateByGuild
      .get(mapping.guild_code)
      ?.get(mapping.player_id)
    if (!rpcRow || typeof rpcRow.tokens_available !== 'number') continue

    summary.scannedUsers++

    const state = stateByUser.get(pref.user_id) ?? null
    const tokenNextInSeconds =
      typeof rpcRow.token_next_in_seconds === 'number'
        ? rpcRow.token_next_in_seconds
        : null
    const bombNextInSeconds =
      typeof rpcRow.bomb_next_in_seconds === 'number'
        ? rpcRow.bomb_next_in_seconds
        : null

    const bomb: BombReadingInput | null =
      typeof rpcRow.bombs_available === 'number'
        ? {
            bombsAvailable: rpcRow.bombs_available,
            bombNextInSeconds,
            dataSource: rpcRow.data_source ?? null,
            mappingNextBombSeconds:
              typeof mapping.next_bomb_seconds === 'number'
                ? mapping.next_bomb_seconds
                : null,
            mappingLastSyncBombs:
              typeof mapping.last_sync_bombs === 'number'
                ? mapping.last_sync_bombs
                : null,
            mappingLastSyncAt: mapping.last_sync_at ?? null
          }
        : null

    const {
      alerts,
      observed,
      stateWrites,
      quietHours,
      bombTrusted,
      cappedSince
    } = decideAlerts({
      now,
      prefs: pref,
      state,
      tokens: rpcRow.tokens_available,
      tokenNextInSeconds,
      bomb
    })
    const alert = alerts[0]

    const wantsBombAlert =
      pref.alert_on_bomb_ready || pref.alert_before_bomb_ready
    if (wantsBombAlert && !bombTrusted) summary.bombReadingsUntrusted++

    if (quietHours.action === 'defer') summary.quietHoursDeferred++
    if (quietHours.action === 'drop') summary.quietHoursDropped++
    if (quietHours.maxDeferOverride) summary.quietHoursMaxDeferOverrides++
    if (quietHours.configError) {
      summary.quietHoursConfigErrors++
      logger.warn(
        { userId: pref.user_id, configError: quietHours.configError },
        'Quiet hours configured but unusable; delivering anyway (failing open)'
      )
    }

    const baseline: ScanBaselineColumns = {
      last_tokens: stateWrites.token.advance
        ? stateWrites.token.observed.amount
        : (state?.last_tokens ?? null),
      last_time_to_full_seconds: stateWrites.token.advance
        ? stateWrites.token.observed.timeToFullSeconds
        : (state?.last_time_to_full_seconds ?? null),
      last_bombs: stateWrites.bomb.advance
        ? stateWrites.bomb.observed.amount
        : (state?.last_bombs ?? null),
      last_time_to_bomb_seconds: stateWrites.bomb.advance
        ? stateWrites.bomb.observed.timeToFullSeconds
        : (state?.last_time_to_bomb_seconds ?? null),
      quiet_hours_deferred_since: quietHours.deferredSince,
      capped_since: cappedSince,
      last_scan_at: nowIso
    }

    const observedOnlyRow: UserTokenAlertStateUpsert = {
      user_id: pref.user_id,
      ...baseline,
      updated_at: nowIso
    }

    // Blocked/unlinked users get no sends, but observations still advance.
    if (!alert || state?.dm_blocked_at != null || !mapping.discord_user_id) {
      observedUpserts.push(observedOnlyRow)
      continue
    }

    // Undeliverable this run: leave state untouched so it re-fires.
    if (stopSending || sendAttempts >= MAX_DMS_PER_RUN) continue
    if (Date.now() >= deadlineAt) {
      summary.deadlineStopped = true
      stopSending = true
      continue
    }

    const delta =
      state?.last_tokens != null ? observed.tokens - state.last_tokens : 0
    const content = buildAlertMessage(alert, observed, {
      tokenNextInSeconds,
      delta,
      bombNextInSeconds,
      burnInSeconds: secondsToNextBurn(now, cappedSince),
      quietStartsInMinutes:
        pref.quiet_hours_timezone != null && pref.quiet_hours_start != null
          ? minutesUntilLocalHour(
              now,
              pref.quiet_hours_timezone,
              pref.quiet_hours_start
            )
          : null
    })

    sendAttempts++
    let result: SendDiscordDirectMessageResult
    try {
      result = await sendDiscordDirectMessage({
        discordUserId: mapping.discord_user_id,
        content,
        // Cached channel only for this Discord account; a stale id would DM the old one.
        cachedChannelId:
          state?.dm_channel_recipient_id === mapping.discord_user_id
            ? (state?.dm_channel_id ?? null)
            : null
      })
    } catch (err) {
      summary.errors++
      logger.warn(
        {
          userId: pref.user_id,
          alert,
          error: err instanceof Error ? err.message : String(err)
        },
        'DM send threw; state left unsent for retry'
      )
      continue
    }

    if (result.ok) {
      summary.alertsSent++
      summary.byType[alert]++
      // At-least-once: persist before the next user's send.
      await upsertState({
        ...observedOnlyRow,
        [ALERT_TIMESTAMP_COLUMN[alert]]: nowIso,
        consecutive_dm_failures: 0,
        dm_blocked_at: null,
        dm_channel_id: result.channelId,
        dm_channel_recipient_id: mapping.discord_user_id
      })
      continue
    }

    if (result.reason === 'rate_limited') {
      summary.rateLimited++
      stopSending = true
      logger.warn(
        { userId: pref.user_id, retryAfterMs: result.retryAfterMs },
        'Discord rate limit hit; aborting sends for this run'
      )
      continue
    }

    if (result.reason === 'no_bot_token') {
      summary.errors++
      stopSending = true
      continue
    }

    if (result.reason === 'dm_blocked') {
      summary.dmBlocked++
      const failures = (state?.consecutive_dm_failures ?? 0) + 1
      // Baselines omitted so the alert re-decides until the block threshold.
      // Safe only because this is a single-row upsert.
      await upsertState({
        user_id: pref.user_id,
        consecutive_dm_failures: failures,
        dm_blocked_at: failures >= DM_BLOCK_THRESHOLD ? nowIso : null,
        updated_at: nowIso
      })
      continue
    }

    summary.errors++
  }

  if (observedUpserts.length > 0) {
    const { error } = await db
      .from('user_token_alert_state')
      .upsert(observedUpserts, { onConflict: 'user_id' })
    if (error) {
      summary.errors++
      logger.warn(
        { count: observedUpserts.length, error: error.message },
        'Batched observed-state upsert failed'
      )
    }
  }

  logger.info({ ...summary }, 'User token alert scan complete')
  return summary
}
