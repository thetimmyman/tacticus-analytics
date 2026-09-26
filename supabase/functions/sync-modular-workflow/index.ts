import { readGuildSeasons } from '../_shared/guild-seasons.ts'
import { isCompleteRaidWrite } from '../_shared/sync-completeness.ts'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

import { EdgeFunctionTimeouts, timeoutFetch } from '../_shared/timeout-utils.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import { jsonResponse } from '../_shared/response-helpers.ts'
import { createLogger } from '../_shared/logger.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { decryptApiKey } from '../_shared/sync-modules/decryption.ts'
import { acquireLock, releaseLock } from '../_shared/sync-modules/db-locking.ts'
import {
  callTacticusApi,
  fetchGuildMembersViaTacticus
} from '../_shared/sync-modules/tacticus-api.ts'
import { fetchGuildMembersViaLoki } from '../_shared/sync-modules/loki-api.ts'
import {
  updateBombTracking,
  upsertDataBatches
} from '../_shared/sync-modules/db-writer.ts'
import {
  fetchBossMappings,
  savePlayerMappings
} from '../_shared/sync-modules/db-mappings.ts'
import {
  processRaidEntry,
  validateDataTypes,
  type RaidEntry,
  type PlayerMappings
} from '../_shared/sync-modules/transforms.ts'
import { loadErasureTombstones } from '../_shared/sync-modules/erasure-tombstones.ts'
import {
  PLAYER_NAME_ROW_COLUMNS,
  seedErasureNames,
  seedSyncPlayerMappings,
  type PlayerNameRow
} from '../_shared/player-name-resolution-core.ts'
import { refreshLokiSession } from '../_shared/sync-modules/loki-session.ts'
import {
  toNumberValue,
  getErrorMessage
} from '../_shared/sync-modules/helpers.ts'
import {
  buildGuildConfigMetadataUpdate,
  extractGuildApiMetadata,
  type GuildConfigMetadataUpdate
} from '../_shared/sync-modules/guild-metadata.ts'
import { requireServiceRole } from '../_shared/auth-guard.ts'
import { fetchGuildRankings } from '../_shared/sync-modules/rankings.ts'
import { getLokiSeasonTimingConstants } from '../_shared/loki-build-version.ts'
import {
  isHistoricalSeason,
  normalizeRaidPayload,
  parseLiveRaidSeason,
  parseSyncRequestContext
} from './request-context.ts'
import {
  assessSeasonRetention,
  buildSyncCompletion,
  computeSeasonWindow,
  disambiguateDuplicateDisplayNames,
  type LokiMember
} from './workflow-helpers.ts'

interface ValidationResult {
  isValid: boolean
  canAccessGuild: boolean
  canAccessRaidData: boolean
  guildInfo?: { guildId?: string; guildName?: string }
  error?: string
  statusCode?: number
}

const CONFIG = {
  api: {
    baseUrl: 'https://api.tacticusgame.com/api/v1',
    lokiUrl: 'https://api-live.loki.snowprintstudios.com',
    maxRetries: 2
  },
  tables: {
    guildConfig: 'guild_config',
    data: 'EOT_GR_data',
    playerMapping: 'player_mapping',
    bossMapping: 'boss_mapping',
    bombTracking: 'bomb_tracking',
    seasonCalendar: 'season_calendar',
    locks: 'execution_locks'
  },
  batchSize: 100,
  lockTimeoutMs: 300000
}

type BossMappings = Record<string, Record<number, string>>
let cachedBossMappings: BossMappings | null = null
let bossMappingsCacheTime = 0
const BOSS_CACHE_TTL_MS = 5 * 60 * 1000
const MIN_REQUIRED_SEASONS = 5
const HISTORY_LOOKBACK_SEASONS = 20
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  // Decrypts keys and acts for ANY guild with VERIFY_JWT=false, so require the
  // service role before reading the body or touching the database.
  const authError = requireServiceRole(req)
  if (authError) return authError

  const timeouts = new EdgeFunctionTimeouts('sync-modular-workflow')
  const startedAt = Date.now()
  let correlationId = ''
  let guildCode = ''
  let lockAcquireStarted = 0
  let lockAcquiredAt = 0
  // DR mode: skip Discord notifications and backfill triggers.
  let skipNotifications = false

  try {
    const context = parseSyncRequestContext(await req.json())
    guildCode = context.guildCode
    correlationId = context.correlationId
    const { requestedSeason, freshSessionId, preserveSyncSettings } = context
    skipNotifications = context.skipNotifications

    // Declare `logger` before the decrypt block: a TDZ error there is swallowed
    // by the catch and silently disables decryption.
    const logger = createLogger({
      module: 'sync-modular-workflow',
      guildCode,
      correlationId
    })

    let { explicitApiKey } = context
    if (explicitApiKey && explicitApiKey.includes(':')) {
      try {
        const decrypted = await decryptApiKey(explicitApiKey, logger)
        if (decrypted) explicitApiKey = decrypted
      } catch {
        // An invalid key fails later.
      }
    }

    if (!guildCode) {
      return jsonResponse(
        {
          success: false,
          error: 'guild_code is required',
          correlation_id: correlationId
        },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const { data: guildConfig, error: configError } = await supabase
      .from(CONFIG.tables.guildConfig)
      .select(
        'api_key_encrypted, cluster_code, cluster_id, guild_id, guild_tag, display_name, user_id, session_id, consecutive_sync_failures, consecutive_loki_failures, last_successful_sync, auto_sync_enabled'
      )
      .eq('guild_code', guildCode)
      .single()

    // An explicit key lets onboarding proceed without a guild config row.
    if ((configError || !guildConfig?.api_key_encrypted) && !explicitApiKey) {
      return jsonResponse(
        {
          success: false,
          path: 'modular',
          error: 'Guild config not found',
          correlation_id: correlationId
        },
        { status: 404 }
      )
    }

    const apiKey =
      explicitApiKey ||
      (await decryptApiKey(guildConfig!.api_key_encrypted, logger))
    if (!apiKey) {
      return jsonResponse(
        {
          success: false,
          path: 'modular',
          error: 'Failed to decrypt API key',
          correlation_id: correlationId
        },
        { status: 500 }
      )
    }

    // Stored MAX season lags at rollover: explicit-season requests use the live API, live syncs the feed.
    let currentSeasonNum: number | null = null
    if (requestedSeason !== null) {
      if (!Number.isSafeInteger(requestedSeason) || requestedSeason <= 0) {
        return jsonResponse(
          {
            success: false,
            error: 'Requested season cannot be safely resolved'
          },
          { status: 400 }
        )
      }
      const liveSeasonResult = await callTacticusApi(
        '/guildRaid',
        apiKey,
        guildCode,
        timeouts,
        { baseUrl: CONFIG.api.baseUrl, maxRetries: 1 },
        logger
      )
      if (!liveSeasonResult.success) {
        return jsonResponse(
          {
            success: false,
            error: 'Could not resolve the live season from the upstream API'
          },
          { status: 503 }
        )
      }
      currentSeasonNum = parseLiveRaidSeason(liveSeasonResult.data)
      if (currentSeasonNum === null || requestedSeason > currentSeasonNum) {
        return jsonResponse(
          {
            success: false,
            error: 'Requested season cannot be safely resolved'
          },
          { status: currentSeasonNum === null ? 503 : 400 }
        )
      }
    }
    const isHistorical = isHistoricalSeason(requestedSeason, currentSeasonNum)

    logger.info(
      `Starting modular sync${isHistorical ? ` for historical season ${requestedSeason}` : requestedSeason !== null ? ` for current season ${requestedSeason}` : ''}`
    )

    const validation: ValidationResult = {
      isValid: false,
      canAccessGuild: false,
      canAccessRaidData: false
    }

    lockAcquireStarted = Date.now()
    const lockId = await acquireLock(
      { supabase, logger },
      { table: CONFIG.tables.locks, lockTimeoutMs: CONFIG.lockTimeoutMs },
      guildCode,
      guildConfig?.cluster_code ?? null
    )

    lockAcquiredAt = Date.now()

    if (!lockId) {
      // Another sync for this guild is in flight (stale locks are stolen). 2xx, not 409, which surfaces
      // as a spurious 502 to manual triggers racing the scheduler; `skipped` marks it for monitoring.
      logger.info(
        `${guildCode} Sync already in progress (lock held) — skipping duplicate run`
      )
      return jsonResponse(
        {
          success: true,
          skipped: 'sync_in_progress',
          path: 'modular',
          correlation_id: correlationId
        },
        { status: 200 }
      )
    }

    try {
      const raidEndpoint = isHistorical
        ? `/guildRaid/${requestedSeason}`
        : '/guildRaid'

      const [guildResult, raidResult] = await Promise.all([
        callTacticusApi<{
          guild?: {
            guildId?: string
            name?: string
            guildName?: string
            guildTag?: string
            tag?: string
          }
          guildId?: string
          name?: string
          guildName?: string
          guildTag?: string
          tag?: string
        }>(
          '/guild',
          apiKey,
          guildCode,
          timeouts,
          { baseUrl: CONFIG.api.baseUrl, maxRetries: 1 },
          logger
        ),
        callTacticusApi(
          raidEndpoint,
          apiKey,
          guildCode,
          timeouts,
          { baseUrl: CONFIG.api.baseUrl, maxRetries: CONFIG.api.maxRetries },
          logger
        )
      ])

      let guildMetadataUpdate: GuildConfigMetadataUpdate = {}
      let guildMetadataFields: string[] = []
      if (guildResult.success && guildResult.data) {
        const guildMetadata = extractGuildApiMetadata(guildResult.data)
        const metadataUpdatedAt = new Date().toISOString()
        guildMetadataUpdate = buildGuildConfigMetadataUpdate(
          guildResult.data,
          {
            display_name: guildConfig?.display_name ?? null,
            guild_tag: guildConfig?.guild_tag ?? null
          },
          metadataUpdatedAt
        )
        guildMetadataFields = Object.keys(guildMetadataUpdate).filter(
          (field) => field !== 'updated_at'
        )
        validation.canAccessGuild = true
        validation.guildInfo = {
          guildId: guildResult.data.guild?.guildId || guildResult.data.guildId,
          guildName:
            guildMetadata.displayName ||
            guildResult.data.guild?.name ||
            guildResult.data.name
        }
      }

      // The API is key-owner-scoped: if the key holder leaves, /guild returns
      // another guild whose data would overwrite this one. A positive mismatch
      // fails closed; a missing id on either side stays fail-open.
      const payloadGuildId = (validation.guildInfo?.guildId ?? '').trim()
      const expectedGuildId = (guildConfig?.guild_id ?? '').trim()
      if (
        payloadGuildId &&
        expectedGuildId &&
        payloadGuildId !== expectedGuildId
      ) {
        const failures = (guildConfig?.consecutive_sync_failures || 0) + 1
        const disableAutoSync = failures >= 3
        const mismatchTimestamp = new Date().toISOString()
        await supabase
          .from(CONFIG.tables.guildConfig)
          .update({
            api_key_is_valid: false,
            api_key_last_validated: mismatchTimestamp,
            consecutive_sync_failures: failures,
            ...(preserveSyncSettings
              ? {}
              : { auto_sync_enabled: !disableAutoSync }),
            last_sync_attempt: mismatchTimestamp,
            updated_at: mismatchTimestamp
          })
          .eq('guild_code', guildCode)
        logger.error(
          `API key guild mismatch for ${guildCode}: /guild returned guild ${payloadGuildId} (${validation.guildInfo?.guildName ?? 'unknown name'}) but this config is linked to ${expectedGuildId} — the key's owner is no longer in this guild. Skipping all writes.${disableAutoSync ? ` Auto-sync DISABLED after ${failures} consecutive failures.` : ''}`
        )
        return jsonResponse(
          {
            success: false,
            path: 'modular',
            error: 'payload_guild_id_mismatch',
            detail:
              'The stored API key belongs to an account that is no longer in this guild — re-save a current member’s API key',
            correlation_id: correlationId,
            validation: {
              isValid: false,
              canAccessGuild: true,
              canAccessRaidData: false,
              guildInfo: validation.guildInfo
            }
          },
          { status: 409 }
        )
      }

      if (!raidResult.success || !raidResult.data) {
        validation.error = raidResult.error || 'Failed to fetch raid data'
        validation.statusCode = raidResult.isApiKeyError ? 401 : 502

        const isLockoutPeriod =
          validation.canAccessGuild && !raidResult.isApiKeyError
        // Only an explicit 401/403 is an API key error; treating 5xx/timeout as
        // auth caused mass key invalidation during upstream outages.
        const isApiKeyError =
          raidResult.isApiKeyError || guildResult.isApiKeyError === true

        if (isLockoutPeriod) {
          logger.info(
            'No raid data available (likely lockout period between seasons) - API key still valid'
          )
          await supabase
            .from(CONFIG.tables.guildConfig)
            .update({
              last_sync_attempt: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('guild_code', guildCode)
        } else if (isApiKeyError) {
          const failures = (guildConfig.consecutive_sync_failures || 0) + 1
          // The gateway also returns 401/403 when throttling, so flag the key only after 3 consecutive failures;
          // guild-batch-sync re-probes flagged keys daily.
          const confirmedInvalid = failures >= 3

          if (confirmedInvalid) {
            await supabase
              .from(CONFIG.tables.guildConfig)
              .update({
                api_key_is_valid: false,
                api_key_last_validated: new Date().toISOString(),
                consecutive_sync_failures: failures,
                ...(preserveSyncSettings ? {} : { auto_sync_enabled: false }),
                last_sync_attempt: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('guild_code', guildCode)
            logger.warn(
              `API key marked invalid and auto-sync DISABLED after ${failures} consecutive auth failures`
            )
          } else {
            await supabase
              .from(CONFIG.tables.guildConfig)
              .update({
                consecutive_sync_failures: failures,
                last_sync_attempt: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('guild_code', guildCode)
            logger.warn(
              `Auth failure ${failures}/3 for ${guildCode} — key NOT yet marked invalid (upstream throttling indistinguishable from a bad key)`
            )
          }
        } else {
          // Transient failure — record the attempt but do NOT invalidate the key.
          logger.warn(
            `Transient sync failure for ${guildCode}: ${validation.error}`
          )
          await supabase
            .from(CONFIG.tables.guildConfig)
            .update({
              last_sync_attempt: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('guild_code', guildCode)
        }

        return jsonResponse(
          {
            success: false,
            path: 'modular',
            error: isLockoutPeriod
              ? 'No raid data available (lockout period)'
              : validation.error,
            correlation_id: correlationId,
            validation: {
              isValid: !isApiKeyError,
              canAccessGuild: validation.canAccessGuild,
              canAccessRaidData: false,
              guildInfo: validation.guildInfo,
              isLockoutPeriod
            }
          },
          { status: isLockoutPeriod ? 200 : 502 }
        )
      }

      validation.isValid = true
      validation.canAccessRaidData = true

      const validationUpdateTimestamp = new Date().toISOString()
      const { error: validationUpdateError } = await supabase
        .from(CONFIG.tables.guildConfig)
        .update({
          api_key_is_valid: true,
          api_key_last_validated: validationUpdateTimestamp,
          last_sync_attempt: validationUpdateTimestamp,
          updated_at: validationUpdateTimestamp,
          ...guildMetadataUpdate
        })
        .eq('guild_code', guildCode)

      if (validationUpdateError) {
        logger.warn(
          `Failed to update guild_config validation metadata: ${validationUpdateError.message}`
        )
      } else if (guildMetadataFields.length > 0) {
        logger.info(
          `Updated guild metadata from upstream API: ${guildMetadataFields.join(', ')}`
        )
      }

      const normalizedRaid = normalizeRaidPayload(raidResult.data, {
        isHistorical,
        requestedSeason
      })
      if (!normalizedRaid.valid) {
        return jsonResponse(
          {
            success: false,
            error: 'Invalid or mismatched raid season payload'
          },
          { status: 502 }
        )
      }
      const rawEntries = normalizedRaid.entries as RaidEntry[]
      // The payload's validated season; historical endpoints may omit metadata since the route names it.
      const season = normalizedRaid.season
      const seasonIsValid =
        typeof season === 'number' && Number.isInteger(season) && season > 0

      if (!isHistorical && !seasonIsValid) {
        logger.error(
          `Cannot resolve a valid season from the live API payload for ${guildCode}; skipping EOT_GR_data write to avoid poisoning the table`
        )
      }

      // Raid-feed userIds reveal a stale LOKI roster missing a just-joined member.
      const currentRaidParticipantIds = new Set(
        rawEntries
          .map((e) => e?.userId)
          .filter((id): id is string => Boolean(id))
      )

      logger.info(`Fetched ${rawEntries.length} entries for season ${season}`)

      if (!isHistorical && seasonIsValid) {
        try {
          const timing = await getLokiSeasonTimingConstants()
          const seasonWindow = computeSeasonWindow(season, timing)
          if (seasonWindow) {
            const { error: seasonCalendarError } = await supabase
              .from(CONFIG.tables.seasonCalendar)
              .upsert(
                {
                  season_id: season,
                  season_label: `Season ${season}`,
                  starts_at: seasonWindow.startsAtIso,
                  ends_at: seasonWindow.endsAtIso,
                  tokens_per_player_cap: 28,
                  regen_interval_hours: 12,
                  regen_tokens_per_interval: 1,
                  notes: `LOKI timing (${timing.source})`
                },
                { onConflict: 'season_id' }
              )

            if (seasonCalendarError) {
              logger.warn(
                `Failed to upsert season_calendar for season ${season}: ${seasonCalendarError.message}`
              )
            } else {
              logger.info(
                `Season calendar synced for season ${season} (${timing.source})`
              )
            }
          }
        } catch (err) {
          logger.warn(
            `Failed to derive season timing from LOKI global config: ${getErrorMessage(err)}`
          )
        }
      }

      const playerMappings: PlayerMappings = {}
      let lokiMappingsCount = 0
      let tacticusMemberIds: string[] | null = null
      const { data: rosterObservation, error: rosterObservationError } =
        await supabase.rpc('begin_guild_roster_observation')
      const rosterObservedAt =
        !rosterObservationError &&
        typeof rosterObservation === 'string' &&
        !Number.isNaN(Date.parse(rosterObservation))
          ? rosterObservation
          : '1970-01-01T00:00:00.000Z'
      if (rosterObservationError) {
        logger.warn(
          `Could not mint database roster observation; deactivation will fail closed: ${rosterObservationError.message}`
        )
      }

      // The env scraper id is authoritative (it must match the shared secret;
      // pairing the secret with a legacy guild_config.user_id makes LOKI 500).
      const envLokiUserId = Deno.env.get('LOKI_SCRAPER_USER_ID') || null
      const lokiUserId = envLokiUserId || guildConfig.user_id
      // The stored session belongs to the legacy user; connect a fresh one.
      const lokiOverrodeLegacyRow = !!(
        envLokiUserId &&
        guildConfig.user_id &&
        guildConfig.user_id !== envLokiUserId
      )
      const storedLokiSessionId = lokiOverrodeLegacyRow
        ? null
        : guildConfig.session_id
      const lokiClientSecret =
        Deno.env.get('LOKI_SCRAPER_CLIENT_SECRET') ?? null

      const hasLokiCredentials = !!(
        guildConfig.guild_id &&
        lokiUserId &&
        lokiClientSecret
      )

      if (
        !isHistorical &&
        hasLokiCredentials &&
        validation.guildInfo?.guildId
      ) {
        const tacticusMembersResult = await fetchGuildMembersViaTacticus(
          apiKey,
          validation.guildInfo.guildId,
          guildCode,
          timeouts,
          { baseUrl: CONFIG.api.baseUrl, maxRetries: 1 },
          logger
        )
        if (
          tacticusMembersResult.success &&
          tacticusMembersResult.memberIds.length > 0
        ) {
          tacticusMemberIds = tacticusMembersResult.memberIds
          logger.info(
            `Tacticus API: ${tacticusMemberIds.length} members (authoritative for is_current)`
          )
        }
      }

      let lokiMembers: LokiMember[] = []
      let lokiFailed = false
      // A failed LOKI name backfill sets a partial-success flag; the raid upsert uses existing names.
      let partialLokiFailure = false

      if (!isHistorical && hasLokiCredentials) {
        try {
          const isInitialSync = guildConfig.last_successful_sync == null
          const rawLokiMembers = await fetchGuildMembersViaLoki(
            {
              logger,
              refreshSessionId: async (_gc, uid, secret, to) => {
                const result = await refreshLokiSession(
                  uid,
                  secret,
                  (to as EdgeFunctionTimeouts).createSignal('api_request')
                )
                return result.sessionId
              },
              updateSessionIdInDatabase: async (sb, gc, newSessionId) => {
                const { error } = await sb
                  .from(CONFIG.tables.guildConfig)
                  .update({
                    session_id: newSessionId,
                    updated_at: new Date().toISOString()
                  })
                  .eq('guild_code', gc)
                return !error
              }
            },
            { baseUrl: CONFIG.api.lokiUrl },
            {
              guildCode,
              guildId: guildConfig.guild_id!,
              userId: lokiUserId,
              sessionId: freshSessionId || storedLokiSessionId,
              clientSecret: lokiClientSecret || '',
              supabase,
              timeouts,
              initialSync: isInitialSync,
              recentActivityIds: currentRaidParticipantIds
            }
          )

          if (rawLokiMembers.length === 0) {
            lokiFailed = true
            logger.error(
              'LOKI returned 0 members - this indicates a LOKI API failure'
            )
          } else {
            lokiMembers = rawLokiMembers as LokiMember[]
          }
        } catch (err) {
          lokiFailed = true
          logger.error(`LOKI fetch failed: ${getErrorMessage(err)}`)
        }

        if (lokiFailed) {
          // LOKI is only a name backfill: failing it must not drop raid entries, trip the raid breaker or 502,
          // or one bad shared session fails every guild. Keep session_id; the fetcher refreshes it on auth errors.
          partialLokiFailure = true
          lokiMembers = []

          logger.warn(
            `LOKI name backfill failed for ${guildCode}; continuing with existing player_mapping names (raid upsert proceeds, partial_loki_failure=true)`
          )

          await supabase
            .from(CONFIG.tables.guildConfig)
            .update({
              // Separate counter: a LOKI outage never evicts a working guild.
              consecutive_loki_failures:
                (guildConfig.consecutive_loki_failures || 0) + 1,
              last_sync_attempt: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('guild_code', guildCode)
        }
      }

      const getBossMappings = async (): Promise<BossMappings> => {
        const now = Date.now()
        if (
          cachedBossMappings &&
          now - bossMappingsCacheTime < BOSS_CACHE_TTL_MS
        ) {
          logger.debug('Using cached boss mappings')
          return cachedBossMappings
        }
        const mappings = await fetchBossMappings(
          { supabase, logger },
          { bossMappingTable: CONFIG.tables.bossMapping }
        )
        cachedBossMappings = mappings
        bossMappingsCacheTime = now
        return mappings
      }

      const [bossMappings, existingMappingsResult] = await Promise.all([
        getBossMappings(),
        supabase
          .from(CONFIG.tables.playerMapping)
          // Departed rows are included as a last-resort fallback only.
          .select(PLAYER_NAME_ROW_COLUMNS)
          .eq('guild_code', guildCode)
      ])

      if (lokiMembers.length > 0) {
        lokiMappingsCount = lokiMembers.length
        const processedMembers = disambiguateDuplicateDisplayNames(
          lokiMembers,
          guildCode,
          logger
        )
        for (const member of processedMembers) {
          playerMappings[member.userId] = member.displayName
          playerMappings[member.userId.toLowerCase()] = member.displayName
        }
        if (!isHistorical) {
          savePlayerMappings(
            { supabase, logger },
            {
              playerMappingTable: CONFIG.tables.playerMapping,
              dataTable: CONFIG.tables.data
            },
            guildCode,
            processedMembers,
            tacticusMemberIds,
            rosterObservedAt
          )
            .then((outcome) => {
              if (outcome.attempted && !outcome.ok) {
                // Logged again so the failure is visible where the sync succeeds.
                logger.warn(
                  `Roster write FAILED for ${guildCode} (raid ingest continues): ${outcome.reason ?? 'unknown'}`
                )
              }
            })
            .catch((err) => {
              // Defensive: the counter must move even if this ever throws.
              const reason = getErrorMessage(err)
              logger.error(`Failed to save player mappings: ${reason}`)
              void supabase
                .rpc('record_roster_write_outcome', {
                  p_guild_code: guildCode,
                  p_ok: false,
                  p_rows_written: null,
                  p_reason: `unhandled: ${reason}`
                })
                .then(() => undefined)
                .catch(() => undefined)
            })
        }
      }

      // Current names gap-fill the primary map; departed names go to a last-resort map consulted after the
      // entry's username, so the erasure seed below always wins.
      const departedMappings = seedSyncPlayerMappings(
        (existingMappingsResult.data || []) as PlayerNameRow[],
        playerMappings
      )

      // Erased subjects' mappings are deactivated, so seed their tombstones or a sync writes the real name
      // back over anonymized rows. Unreadable erasure status gets the synthesized alias.
      const windowPlayerIds = Array.from(
        new Set(
          rawEntries
            .map((entry: RaidEntry) =>
              typeof entry?.userId === 'string' ? entry.userId.trim() : ''
            )
            .filter((userId: string) => userId.length > 0)
        )
      ) as string[]
      const erasure = await loadErasureTombstones(
        supabase,
        {
          playerMappingTable: CONFIG.tables.playerMapping,
          dataTable: CONFIG.tables.data
        },
        guildCode,
        season == null ? null : String(season),
        windowPlayerIds
      )
      if (erasure.withheld.length > 0) {
        logger.warn(
          `Could not read erasure tombstones for ${erasure.withheld.length} player(s); falling back to synthesized aliases`
        )
      }
      seedErasureNames(playerMappings, erasure.tombstones, erasure.withheld)

      let visitedEntries = 0
      let droppedEntries = 0
      let validEntriesCount = 0
      let processedCount = 0
      let finalValidCount = 0
      let totalUpserted = 0
      let totalInserted = 0
      let totalUpdated = 0
      let totalErrors = 0

      const bombEntries: Array<{
        userId: string
        damageDealt: number
        completedOn?: unknown
        startedOn?: unknown
      }> = []
      const totalBatches = Math.ceil(rawEntries.length / CONFIG.batchSize)

      // Write raid rows only with a valid season (fail closed); also narrows `season` to `number`.
      if (seasonIsValid && season != null) {
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
          if (timeouts.shouldTerminate()) {
            logger.warn(`Timeout at batch ${batchIndex}/${totalBatches}`)
            break
          }

          const batchStart = batchIndex * CONFIG.batchSize
          const batchEnd = Math.min(
            batchStart + CONFIG.batchSize,
            rawEntries.length
          )
          const batchData: NonNullable<ReturnType<typeof processRaidEntry>>[] =
            []

          for (let i = batchStart; i < batchEnd; i++) {
            visitedEntries++
            const entry = rawEntries[i]
            if (!entry || typeof entry !== 'object') {
              droppedEntries++
              continue
            }

            const userId =
              typeof entry.userId === 'string' ? entry.userId.trim() : ''
            const encounterIndex = toNumberValue(entry.encounterIndex)

            if (
              !userId ||
              encounterIndex == null ||
              !Number.isFinite(encounterIndex) ||
              encounterIndex < 0
            ) {
              droppedEntries++
              continue
            }
            if (!entry.type && !entry.unitId) {
              droppedEntries++
              continue
            }

            validEntriesCount++

            if (entry.damageType === 'Bomb' && userId) {
              const damage =
                typeof entry.damageDealt === 'number'
                  ? entry.damageDealt
                  : Number(entry.damageDealt) || 0
              if (damage > 0)
                bombEntries.push({
                  userId,
                  damageDealt: damage,
                  completedOn: entry.completedOn,
                  startedOn: entry.startedOn
                })
            }

            const processed = processRaidEntry(
              entry,
              guildCode,
              season,
              playerMappings,
              bossMappings,
              guildConfig.cluster_code,
              guildConfig.cluster_id,
              logger,
              departedMappings
            )
            if (!processed) continue
            processedCount++

            if (
              processed.Guild &&
              processed.Season &&
              processed.Guild !== 'null' &&
              processed.Season !== 'Unknown' &&
              processed.Name !== 'Unknown' &&
              processed.displayName !== 'Unknown'
            ) {
              batchData.push(processed)
              finalValidCount++
            }
          }

          if (batchData.length > 0) {
            const result = await upsertDataBatches(
              { supabase, logger },
              { table: CONFIG.tables.data, batchSize: CONFIG.batchSize },
              guildCode,
              batchData,
              (e) => validateDataTypes(e as any, guildCode, logger)
            )
            totalUpserted += result.upserted
            totalInserted += result.inserted
            totalUpdated += result.updated
            totalErrors += result.errors
          }
        }
      }

      // Clean only if every entry was visited, accepted and acknowledged; else guild-batch-sync re-syncs.
      const syncClean = isCompleteRaidWrite({
        sourceEntries: rawEntries.length,
        visitedEntries,
        acceptedEntries: finalValidCount,
        upsertedEntries: totalUpserted,
        errors: totalErrors,
        seasonValid: seasonIsValid
      })

      if (
        bombEntries.length > 0 &&
        !isHistorical &&
        seasonIsValid &&
        syncClean
      ) {
        await updateBombTracking(
          { supabase, logger },
          { table: CONFIG.tables.bombTracking },
          bombEntries,
          guildCode,
          playerMappings
        )
      }

      if (!isHistorical && syncClean) {
        if (seasonIsValid && season != null) {
          try {
            await supabase.rpc('update_token_burn_state_for_guild', {
              p_guild_code: guildCode,
              p_season: String(season)
            })
          } catch {
            /* ignore */
          }
        }

        if (hasLokiCredentials && validation.guildInfo?.guildId) {
          try {
            await fetchGuildRankings(
              {
                logger,
                refreshSessionId: async (_gc, uid, secret, to) => {
                  const result = await refreshLokiSession(
                    uid,
                    secret,
                    (to as EdgeFunctionTimeouts).createSignal('api_request')
                  )
                  return result.sessionId
                },
                updateSessionIdInDatabase: async (sb, gc, newSessionId) => {
                  const { error } = await sb
                    .from(CONFIG.tables.guildConfig)
                    .update({
                      session_id: newSessionId,
                      updated_at: new Date().toISOString()
                    })
                    .eq('guild_code', gc)
                  return !error
                }
              },
              {
                lokiUrl: CONFIG.api.lokiUrl,
                guildConfigTable: CONFIG.tables.guildConfig
              },
              {
                guildCode,
                guildId: validation.guildInfo.guildId,
                userId: lokiUserId,
                sessionId: freshSessionId || storedLokiSessionId,
                clientSecret: lokiClientSecret || '',
                supabase,
                timeouts
              }
            )
          } catch (err) {
            logger.warn(`Rankings fetch failed: ${getErrorMessage(err)}`)
          }
        }

        supabase
          .rpc('refresh_cluster_rankings')
          .then(() => {
            logger.info('Cluster rankings refresh triggered')
          })
          .catch((err: unknown) => {
            logger.error(
              `Cluster rankings refresh failed: ${getErrorMessage(err)}`
            )
          })

        if (!skipNotifications) {
          supabase.functions
            .invoke(
              `update-discord-leaderboards?guild=${encodeURIComponent(guildCode)}`,
              {
                body: { cluster_code: guildConfig.cluster_code || null }
              }
            )
            .then(() => {
              logger.info('Discord leaderboard update triggered')
            })
            .catch((err) => {
              logger.warn(
                `Discord leaderboard update failed: ${getErrorMessage(err)}`
              )
            })
        }
      }

      let seasonCount = 0
      let needsBackfill = false
      let missingSeasons: number[] = []
      let backfillQueued = false

      // Backfill arithmetic depends on a valid season; skip when unresolved.
      if (!isHistorical && syncClean && seasonIsValid && season != null) {
        try {
          const storedSeasons = await readGuildSeasons(() =>
            supabase.rpc('get_distinct_seasons_for_guild', {
              p_guild: guildCode
            })
          )
          const retention = assessSeasonRetention(
            storedSeasons,
            season,
            MIN_REQUIRED_SEASONS,
            HISTORY_LOOKBACK_SEASONS
          )
          seasonCount = retention.seasonCount
          needsBackfill = retention.needsBackfill
          missingSeasons = retention.missingSeasons

          if (needsBackfill) {
            if (missingSeasons.length > 0 && !skipNotifications) {
              logger.info(
                `Needs backfill: ${seasonCount} seasons, missing ${missingSeasons.join(', ')}`
              )
              // The daily key stops an empty completed season (no raid rows) re-enqueueing on every sync.

              const dedupeKey = `guild_historical_backfill:${guildCode}:${season}:${missingSeasons.join(',')}:${new Date().toISOString().slice(0, 10)}`
              const { data: completedBackfill, error: completedError } =
                await supabase
                  .from('work_queue')
                  .select('id')
                  .eq('dedupe_key', dedupeKey)
                  .eq('status', 'completed')
                  .limit(1)
                  .maybeSingle()
              if (completedError)
                throw new Error('Cannot check historical completion')
              if (!completedBackfill) {
                const { error: enqueueError } = await supabase
                  .from('work_queue')
                  .insert({
                    job_type: 'guild_historical_backfill',
                    job_class: 'batch',
                    scheduled_for: new Date(Date.now() + 30_000).toISOString(),
                    payload: {
                      guild_code: guildCode,
                      force_seasons: missingSeasons
                    },
                    dedupe_key: dedupeKey
                  })
                if (enqueueError && enqueueError.code !== '23505') {
                  throw new Error(
                    `Historical backfill enqueue failed: ${enqueueError.message}`
                  )
                }
                backfillQueued = true
              }
            }
          }
        } catch (error) {
          logger.warn(
            `Historical coverage check failed: ${getErrorMessage(error)}`
          )
        }
      }

      if (!isHistorical) {
        const successTimestamp = new Date().toISOString()

        if (syncClean) {
          const { error: updateError } = await supabase
            .from(CONFIG.tables.guildConfig)
            .update({
              last_successful_sync: successTimestamp,
              last_sync_attempt: successTimestamp,
              consecutive_sync_failures: 0,
              ...(preserveSyncSettings ? {} : { auto_sync_enabled: true }),
              // Reset the LOKI counter only when LOKI did NOT fail this run.
              ...(partialLokiFailure ? {} : { consecutive_loki_failures: 0 }),
              ...guildMetadataUpdate,
              updated_at: successTimestamp
            })
            .eq('guild_code', guildCode)

          if (updateError) {
            logger.warn(
              `Failed to update last_successful_sync: ${updateError.message}`
            )
          }
        } else {
          // Partial/failed run: touch attempt only; never advance last_successful_sync.
          logger.warn(
            `Sync NOT clean for ${guildCode} (errorEntries=${totalErrors}, visited=${visitedEntries}/${rawEntries.length}, acknowledged=${totalUpserted}, seasonValid=${seasonIsValid}); withholding last_successful_sync + consecutive_sync_failures reset`
          )
          const { error: attemptUpdateError } = await supabase
            .from(CONFIG.tables.guildConfig)
            .update({
              last_sync_attempt: successTimestamp,
              // LOKI health is independent of raid health.
              ...(partialLokiFailure ? {} : { consecutive_loki_failures: 0 }),
              ...guildMetadataUpdate,
              updated_at: successTimestamp
            })
            .eq('guild_code', guildCode)

          if (attemptUpdateError) {
            logger.warn(
              `Failed to update last_sync_attempt: ${attemptUpdateError.message}`
            )
          }
        }

        try {
          const { error: syncHealthError } = await supabase.rpc(
            'update_sync_health',
            { p_guild_code: guildCode, p_success: syncClean }
          )
          if (syncHealthError) {
            logger.warn(
              `Failed to update sync health: ${syncHealthError.message}`
            )
          }
        } catch (err) {
          logger.warn(`Failed to update sync health: ${getErrorMessage(err)}`)
        }
      }

      logger.info(
        `Modular sync complete: ${finalValidCount} records (clean=${syncClean})`
      )

      const metrics = timeouts.getMetrics()
      const completion = buildSyncCompletion(
        {
          correlationId,
          season,
          startedAt,
          lockAcquireStarted,
          lockAcquiredAt,
          rawEntries: rawEntries.length,
          droppedEntries,
          validEntries: validEntriesCount,
          processedEntries: processedCount,
          upsertedEntries: totalUpserted,
          insertedEntries: totalInserted,
          updatedEntries: totalUpdated,
          errorEntries: totalErrors,
          bombEntries: bombEntries.length,
          lokiMappingsRefreshed: lokiMappingsCount > 0
        },
        metrics
      )
      completion.warnings.forEach((warning) => logger.warn(warning))
      logger.info(`sync_summary ${JSON.stringify(completion.summary)}`)

      return jsonResponse(
        {
          // Report partial/failed runs honestly so the batch driver retries.
          success: syncClean,
          partial: !syncClean,
          path: 'modular',
          guild: guildCode,
          season,
          correlation_id: correlationId,
          stats: {
            totalEntries: rawEntries.length,
            visitedEntries,
            droppedEntries,
            validEntries: validEntriesCount,
            processedEntries: processedCount,
            finalValidEntries: finalValidCount,
            upsertedEntries: totalUpserted,
            insertedEntries: totalInserted,
            updatedEntries: totalUpdated,
            errorEntries: totalErrors,
            lokiMappings: lokiMappingsCount,
            totalMappings: Object.keys(playerMappings).length / 2,
            executionTimeMs: timeouts.getMetrics().elapsed,
            // LOKI name-backfill outage; raid data still written from existing names.
            partial_loki_failure: partialLokiFailure,
            // True when a valid season could not be resolved and the raid write was skipped.
            season_resolution_skipped: !isHistorical && !seasonIsValid
          },
          validation: {
            isValid: validation.isValid,
            canAccessGuild: validation.canAccessGuild,
            canAccessRaidData: validation.canAccessRaidData,
            guildInfo: validation.guildInfo,
            autoSyncEnabled:
              !isHistorical && syncClean && !preserveSyncSettings
                ? true
                : guildConfig.auto_sync_enabled
          },
          metadata: {
            updatedFields: guildMetadataFields,
            upstreamGuildName: validation.guildInfo?.guildName ?? null
          },
          execution: completion.execution,
          historical: isHistorical
            ? { requestedSeason: requestedSeason }
            : {
                seasonCount,
                needsBackfill,
                missingSeasons,
                backfillTriggered: backfillQueued
              }
        },
        { status: 200 }
      )
    } finally {
      await releaseLock(
        { supabase, logger },
        { table: CONFIG.tables.locks, lockTimeoutMs: CONFIG.lockTimeoutMs },
        guildCode,
        guildConfig.cluster_code,
        lockId
      )
    }
  } catch (error) {
    const errorLogger = createLogger({
      module: 'sync-modular-workflow',
      guildCode: guildCode || 'UNKNOWN'
    })
    errorLogger.error(
      `Modular workflow exception: ${getErrorMessage(error)}`,
      error
    )
    return jsonResponse(
      {
        success: false,
        path: 'modular',
        error: 'Internal server error',
        correlation_id: correlationId
      },
      { status: 500 }
    )
  }
})
