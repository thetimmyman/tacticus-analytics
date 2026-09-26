import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { serviceDb } from '@/app/lib/db'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-war.import')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  WAR_IMPORT_LIMITS,
  warImportPayloadSchema
} from '@/app/lib/war/import-schema'
import type { WarImportData, ZoneImportData } from '@/app/lib/war/import-schema'
import type { Json } from '@tacticus/app-core/database.generated'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  convertRawWarPayload,
  isRecord,
  normalizePlayerId,
  type GuildPlayerIndex,
  type GuildWarStatusMember,
  type GuildWarStatusResponse,
  type LokiGuildWarResponse,
  type LokiWarData
} from '@/app/lib/war/guild-war-parser'
import {
  ingestGuildWar,
  extractStatusMembers,
  sanitizeIngestError,
  type WarIngestResult
} from '@/app/lib/war/guild-war-ingestor'

function generateDeterministicId(input: string): string {
  const hashHex = createHash('sha256').update(input).digest('hex')
  return `${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { profile } = await requireRoleForApi('officer')

  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (
      Number.isFinite(contentLength) &&
      contentLength > WAR_IMPORT_LIMITS.maxBytes
    ) {
      throw Errors.fromResponse(413, { error: 'Import payload is too large' })
    }

    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > WAR_IMPORT_LIMITS.maxBytes) {
      throw Errors.fromResponse(413, { error: 'Import payload is too large' })
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      throw Errors.fromResponse(400, { error: 'Invalid JSON payload' })
    }
    const { guild_code } = body

    if (!guild_code) {
      throw Errors.fromResponse(400, { error: 'guild_code is required' })
    }

    if (profile.guild_code !== guild_code) {
      throw Errors.fromResponse(403, {
        error: 'You can only import data for your own guild'
      })
    }

    if (isRawLokiImport(body.data)) {
      const result = await handleRawLokiImport(
        serviceDb(),
        profile.guild_code as string,
        body.data,
        parseSeasonOverrides(body.overrides)
      )
      const { status, ...resultBody } = result
      return NextResponse.json(resultBody, { status: status ?? 200 })
    }

    const parsed = warImportPayloadSchema.safeParse(body.data)
    if (!parsed.success) {
      throw Errors.fromResponse(400, {
        error: 'Invalid import data',
        details: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`
        )
      })
    }

    const { wars } = parsed.data
    const guildCode = profile.guild_code as string // validated above via guild_code match
    const supabase = serviceDb()
    const now = new Date().toISOString()

    const counts = { wars: 0, zones: 0, attempts: 0, participation: 0 }
    // Fail loudly when nothing persisted so the UI never clears the paste on failure.
    const errors: string[] = []

    for (const war of wars) {
      const matchError = await upsertMatch(supabase, war, guildCode, now)
      if (matchError) {
        logger.error(
          { error: matchError },
          `Error upserting war ${war.war_id}:`
        )
        errors.push(`war ${war.war_id}: ${matchError.message}`)
        continue
      }
      counts.wars++

      for (const zone of war.zones) {
        const zoneResult = await upsertZone(
          supabase,
          war.war_id,
          zone,
          guildCode,
          now
        )
        if ('error' in zoneResult) {
          errors.push(
            `zone ${zone.zone_number} (war ${war.war_id}): ${zoneResult.error}`
          )
          continue
        }
        counts.zones++

        for (const attempt of zone.attempts) {
          // Prefer the payload's event_id so re-imports hit the same row.
          const attemptId =
            attempt.event_id ??
            generateDeterministicId(
              `${war.war_id}-${zone.zone_number}-${attempt.player_id}-${attempt.attempt_number}`
            )
          const { error: attemptError } = await supabase
            .from('guild_war_player_attempts')
            .upsert(
              {
                // The PK keeps its default and is never rewritten.
                event_id: attemptId,
                war_id: war.war_id,
                zone_id: zoneResult.id,
                guild_code: guildCode,
                player_id: attempt.player_id,
                player_name: attempt.player_name,
                attempt_number: attempt.attempt_number,
                attempt_status: attempt.attempt_status,
                attempt_result: attempt.attempt_result ?? null,
                damage_dealt: attempt.damage_dealt ?? null,
                score_earned: attempt.score_earned ?? null,
                attacker_units_json: (attempt.units_used ??
                  null) as Json | null,
                attempt_start_time: attempt.attempt_start_time ?? null,
                attempt_end_time: attempt.attempt_end_time ?? null,
                updated_at: now
              },
              {
                onConflict: 'war_id,guild_code,event_id'
              }
            )

          if (attemptError) {
            logger.error(
              { error: attemptError },
              `Error upserting attempt for war ${war.war_id}, zone ${zone.zone_number}:`
            )
            errors.push(
              `attempt (war ${war.war_id}, zone ${zone.zone_number}, player ${attempt.player_id}): ${attemptError.message}`
            )
            continue
          }
          counts.attempts++
        }
      }

      const snapshotAt = now
      for (const part of war.participation) {
        const { error: partError } = await supabase
          .from('guild_war_participation')
          .upsert(
            {
              guild_code: guildCode,
              war_id: war.war_id,
              user_id: part.user_id,
              display_name: part.display_name ?? null,
              role: part.role ?? null,
              opted_in: part.opted_in ?? null,
              attempts_used: part.attempts_used ?? null,
              attempts_remaining: part.attempts_remaining ?? null,
              score: part.score ?? null,
              exhausted_units: part.exhausted_units ?? null,
              snapshot_at: snapshotAt,
              updated_at: now
            },
            {
              onConflict: 'guild_code,war_id,user_id,snapshot_at'
            }
          )

        if (partError) {
          logger.error(
            { err: partError, warId: war.war_id, userId: part.user_id },
            'Error upserting war participation'
          )
          errors.push(
            `participation ${part.user_id} (war ${war.war_id}): ${partError.message}`
          )
          continue
        }
        counts.participation++
      }
    }

    logger.info(
      { guildCode, counts, errors: errors.length },
      'War data import completed'
    )

    let message = `Imported ${counts.wars} war(s), ${counts.zones} zone(s), ${counts.attempts} attempt(s), ${counts.participation} participation record(s)`
    if (errors.length > 0) {
      message += ` ${errors.length} row(s) failed and were not imported; anything that depends on a failed row (a war's zones, attempts, participation) was skipped and is not counted above. Fix the source before retrying.`
      logger.error({ errors }, 'Guild war import had row-level errors')
    }

    // 422, not 5xx: Cloudflare replaces origin 5xx bodies with HTML.
    const persisted =
      counts.wars + counts.zones + counts.attempts + counts.participation
    if (persisted === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Import failed — ${errors.length} row(s) could not be saved and nothing was imported. Please retry; if it keeps failing, contact support.`,
          counts,
          errors: errors.length
        },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: errors.length === 0,
      message,
      counts
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Guild war import error')
    throw Errors.fromResponse(500, { error: 'Failed to import war data' })
  }
})

async function upsertMatch(
  supabase: TypedSupabaseClient,
  war: WarImportData,
  guildCode: string,
  now: string
): Promise<{ message: string } | null> {
  // A thrown driver error is a row failure, not an abort.
  try {
    const { error } = await supabase.from('guild_war_matches').upsert(
      {
        war_id: war.war_id,
        guild_code: guildCode,
        opponent_guild_code: war.opponent_guild_code ?? null,
        opponent_guild_name: war.opponent_guild_name,
        war_status: war.war_status,
        war_result: war.war_result ?? null,
        guild_score: war.guild_score ?? null,
        opponent_score: war.opponent_score ?? null,
        war_start_date: war.war_start_date ?? null,
        war_end_date: war.war_end_date ?? null,
        war_season: war.war_season ?? null,
        battlefield_level: war.battlefield_level ?? null,
        updated_at: now
      },
      {
        onConflict: 'war_id,guild_code'
      }
    )
    return error ? { message: error.message } : null
  } catch (thrown) {
    return {
      message: thrown instanceof Error ? thrown.message : String(thrown)
    }
  }
}

async function upsertZone(
  supabase: TypedSupabaseClient,
  warId: string,
  zone: ZoneImportData,
  guildCode: string,
  now: string
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('guild_war_zones')
    .upsert(
      {
        war_id: warId,
        guild_code: guildCode,
        zone_number: zone.zone_number,
        zone_name: zone.zone_name ?? null,
        zone_type: zone.zone_type,
        zone_status: zone.zone_status,
        assigned_players: zone.assigned_players ?? null,
        updated_at: now
      },
      {
        onConflict: 'war_id,guild_code,zone_number'
      }
    )
    .select('id')
    .single()

  if (error) {
    logger.error(
      { error },
      `Error upserting zone ${zone.zone_number} for war ${warId}:`
    )
    return { error: error.message }
  }
  return { id: data.id }
}

function isRawLokiImport(data: unknown): boolean {
  if (Array.isArray(data)) return true
  if (!isRecord(data)) return false
  return !Array.isArray((data as Record<string, unknown>).wars)
}

async function loadGuildContextForImport(
  supabase: TypedSupabaseClient,
  guildCode: string
): Promise<{ guildName: string; guildId: string | null }> {
  const { data } = await supabase
    .from('guild_config')
    .select('display_name, guild_id')
    .eq('guild_code', guildCode)
    .maybeSingle()
  return {
    guildName: data?.display_name ?? guildCode,
    guildId: data?.guild_id ?? null
  }
}

async function loadGuildPlayerIndexForImport(
  supabase: TypedSupabaseClient,
  guildCode: string
): Promise<GuildPlayerIndex> {
  const ourPlayerIds = new Set<string>()
  const playerNameMap = new Map<string, string>()
  const { data } = await guildRosterQuery(
    supabase,
    guildCode,
    'player_id, display_name'
  )
  for (const row of data ?? []) {
    if (!row.player_id || !row.display_name) continue
    const normalizedId = normalizePlayerId(row.player_id)
    ourPlayerIds.add(normalizedId)
    playerNameMap.set(normalizedId, row.display_name.trim())
  }
  return { ourPlayerIds, playerNameMap }
}

interface SeasonOverrides {
  season?: number
  warNumber?: number
}

/** Manual Season/War overrides for cases start-date derivation cannot cover. */
function parseSeasonOverrides(raw: unknown): SeasonOverrides {
  if (!isRecord(raw)) return {}
  const overrides: SeasonOverrides = {}
  const season = raw.war_season
  if (
    typeof season === 'number' &&
    Number.isInteger(season) &&
    season >= 1 &&
    season <= 500
  ) {
    overrides.season = season
  }
  const warNumber = raw.war_number
  if (
    typeof warNumber === 'number' &&
    Number.isInteger(warNumber) &&
    warNumber >= 1 &&
    warNumber <= 6
  ) {
    overrides.warNumber = warNumber
  }
  return overrides
}

async function handleRawLokiImport(
  supabase: TypedSupabaseClient,
  guildCode: string,
  data: unknown,
  overrides: SeasonOverrides = {}
): Promise<{
  success: boolean
  message: string
  counts: WarIngestResult
  missing: string[]
  status?: number
  errors?: number
}> {
  const payloads = (Array.isArray(data) ? data : [data]).filter(isRecord)

  logger.info(
    { rawImport: true, guildCode, payloads: payloads.length },
    'Raw war import started'
  )

  if (payloads.length === 0) {
    logger.warn(
      { rawImport: true, guildCode },
      'Raw war import rejected — payload carried no readable JSON objects'
    )
    throw Errors.fromResponse(400, {
      error:
        'Could not read that JSON. Paste the raw in-game GET_GUILD_WAR_ACTIVITY_LOGS and/or GET_GUILD_WAR_STATUS response.'
    })
  }

  const [{ guildName, guildId }, playerIndex] = await Promise.all([
    loadGuildContextForImport(supabase, guildCode),
    loadGuildPlayerIndexForImport(supabase, guildCode)
  ])

  const parserLogger = {
    info: (msg: unknown) =>
      logger.info({ rawImport: true, guildCode }, String(msg))
  }

  const warsById = new Map<string, LokiWarData>()
  const members: GuildWarStatusMember[] = []

  for (const payload of payloads) {
    members.push(
      ...extractStatusMembers(payload as unknown as GuildWarStatusResponse)
    )
    const converted = await convertRawWarPayload(
      payload as unknown as LokiGuildWarResponse,
      {
        guildCode,
        guildName,
        guildId,
        previousWar: false,
        playerIndex,
        logger: parserLogger
      }
    )
    for (const war of converted) warsById.set(war.warId, war)
  }

  const wars = Array.from(warsById.values())

  const hasOverride =
    overrides.season !== undefined || overrides.warNumber !== undefined
  if (hasOverride && wars.length > 1) {
    // One override cannot describe several wars.
    throw Errors.fromResponse(400, {
      error: `That paste contains ${wars.length} different wars, so a single Season/War override can't apply to all of them. Import them one at a time, or clear the override to auto-detect.`
    })
  }
  for (const war of wars) {
    if (overrides.season !== undefined) war.season = overrides.season
    if (overrides.warNumber !== undefined) war.warNumber = overrides.warNumber
  }

  if (wars.length === 0 && members.length === 0) {
    const sawPreBattleLogs = payloads.some((payload) =>
      (payload as unknown as LokiGuildWarResponse).eventResults?.some(
        (eventResult) => {
          const logs = eventResult?.eventResponseData?.activityLogs
          return (
            Array.isArray(logs) &&
            logs.length > 0 &&
            !logs.some((log) => log?.type === 'battleFinished')
          )
        }
      )
    )
    logger.warn(
      {
        rawImport: true,
        guildCode,
        payloads: payloads.length,
        sawPreBattleLogs
      },
      'Raw war import rejected — payload parsed but yielded no wars and no roster members'
    )
    throw Errors.fromResponse(400, {
      error: sawPreBattleLogs
        ? 'Those activity logs contain no finished battles yet, so there is no war data to import. Re-export GET_GUILD_WAR_ACTIVITY_LOGS after at least one battle has been fought.'
        : 'No guild-war data found in that JSON. Make sure you pasted the raw GET_GUILD_WAR_ACTIVITY_LOGS (battles) and/or GET_GUILD_WAR_STATUS (roster) response from the game.'
    })
  }

  const result = await ingestGuildWar(supabase, wars, members, {
    guildCode,
    guildName
  })

  logger.info(
    {
      rawImport: true,
      guildCode,
      counts: result,
      errors: result.errors.length
    },
    'Raw war import completed'
  )

  const parts: string[] = []
  if (result.wars > 0) {
    parts.push(`${result.wars} war${result.wars === 1 ? '' : 's'}`)
    parts.push(`${result.zones} zone${result.zones === 1 ? '' : 's'}`)
    parts.push(`${result.attempts} attempt${result.attempts === 1 ? '' : 's'}`)
    parts.push(`${result.battles} battle${result.battles === 1 ? '' : 's'}`)
  }
  if (result.participation > 0) {
    parts.push(
      `${result.participation} participant${result.participation === 1 ? '' : 's'}`
    )
  }

  const missing: string[] = []
  if (wars.length > 0 && members.length === 0) {
    missing.push(
      'No roster/opt-in data — also paste the GET_GUILD_WAR_STATUS response to capture attempts left and opt-ins.'
    )
  }
  if (members.length > 0 && wars.length === 0) {
    missing.push(
      'No battle data — also paste the GET_GUILD_WAR_ACTIVITY_LOGS response to capture zones and attacks.'
    )
  }

  let message =
    parts.length > 0 ? `Imported ${parts.join(', ')}.` : 'Nothing to import.'
  if (result.errors.length > 0) {
    message += ` ${result.errors.length} row(s) failed and were not imported; anything that depends on a failed row (a war's zones, attempts, battles, lineups) was skipped and is not counted above. Fix the source before retrying; note that re-importing roster data records a new participation snapshot rather than replacing the previous one.`
    logger.error(
      { errors: result.errors },
      'Raw war import had row-level errors'
    )
  }
  if (missing.length > 0) {
    message += ` ${missing.join(' ')}`
  }

  const persisted =
    result.wars +
    result.zones +
    result.attempts +
    result.battles +
    result.participation

  // Roster-only uploads attach to the current match.
  if (persisted === 0 && result.noWarToAttachMembers) {
    throw Errors.fromResponse(400, {
      error:
        'That upload only contains the war roster (GET_GUILD_WAR_STATUS), and this guild has no war on record yet to attach it to, so nothing was written. Import the GET_GUILD_WAR_ACTIVITY_LOGS response first — or put both responses in a single JSON array (opening [, a comma between the two response objects, then closing ]) and upload that.'
    })
  }

  if (persisted === 0 && result.errors.length > 0) {
    // Row errors are raw DB text, so only their count; fields are listed so new ones cannot leak.
    return {
      success: false,
      message: `Import failed — ${result.errors.length} row(s) could not be saved and nothing was imported. Please retry; if it keeps failing, contact support.`,
      counts: {
        wars: result.wars,
        zones: result.zones,
        attempts: result.attempts,
        battles: result.battles,
        lineups: result.lineups,
        participation: result.participation,
        errors: [],
        noWarToAttachMembers: false
      },
      missing,
      status: 422,
      errors: result.errors.length
    }
  }

  // Row errors are raw DB text; sanitize each.
  return {
    success: result.errors.length === 0,
    message,
    counts: {
      wars: result.wars,
      zones: result.zones,
      attempts: result.attempts,
      battles: result.battles,
      lineups: result.lineups,
      participation: result.participation,
      errors: result.errors.map(sanitizeIngestError),
      noWarToAttachMembers: result.noWarToAttachMembers
    },
    missing
  }
}
