import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.tokens')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { AppError, Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireTokenUsageGuildAccess } from '@/app/api/members/token-usage/access'
import { toRecord } from '@/app/lib/utils/coerce'
import type { TablesUpdate } from '@tacticus/app-core/database.generated'

type TokenSource = 'live' | 'cached' | 'fallback'

const TOKEN_MAX_DEFAULTS = {
  guildRaid: 3,
  bomb: 1,
  arena: 15,
  onslaught: 3,
  salvageRun: 2,
  expedition: 3
} as const

const ZERO_TOKEN_SNAPSHOT = {
  tokensAvailable: 0,
  bombsAvailable: 0,
  nextTokenSeconds: null as number | null,
  nextBombSeconds: null as number | null,
  arenaTokens: 0,
  nextArenaTokenSeconds: null as number | null,
  onslaughtTokens: 0,
  nextOnslaughtTokenSeconds: null as number | null,
  salvageTokens: 0,
  nextSalvageTokenSeconds: null as number | null,
  expeditionTokens: 0,
  nextExpeditionTokenSeconds: null as number | null
}

type PlayerMappingRow = {
  display_name: string | null
  guild_code: string | null
  cluster_code: string | null
  api_tokens: string | null
  last_tokens_refresh: string | null
  last_sync_tokens: number | null
  last_sync_bombs: number | null
  next_token_seconds: number | null
  next_bomb_seconds: number | null
  tacticus_api_key_encrypted: string | null
  api_key_is_valid: boolean | null
  api_key_last_verified: string | null
}

type TokenDetails = {
  current?: number | null
  nextTokenInSeconds?: number | null
  [key: string]: unknown
}

interface LiveTokenSnapshot {
  tokensAvailable: number
  nextTokenSeconds: number | null
  bombsAvailable: number
  nextBombSeconds: number | null
  arenaTokens: number
  nextArenaTokenSeconds: number | null
  onslaughtTokens: number
  nextOnslaughtTokenSeconds: number | null
  salvageTokens: number
  nextSalvageTokenSeconds: number | null
  expeditionTokens: number
  nextExpeditionTokenSeconds: number | null
  guildRaid: TokenDetails | null
  bomb: TokenDetails | null
  arena: TokenDetails | null
  onslaught: TokenDetails | null
  salvageRun: TokenDetails | null
  expedition: TokenDetails | null
  [key: string]: unknown
}

const readTokenDetails = (value: unknown): TokenDetails | null => {
  const record = toRecord(value)
  return record ? (record as TokenDetails) : null
}

const numericOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const nextOr = (value: unknown, fallback: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : null

const deriveStatus = (
  source: unknown,
  fallbackCurrent: number,
  fallbackNext: number | null,
  defaultMax: number
) => {
  const base = {
    current: numericOr(fallbackCurrent, 0),
    max: defaultMax,
    nextInSeconds: fallbackNext !== null ? numericOr(fallbackNext, 0) : null
  }

  const clamp = (value: number, max: number) =>
    Math.min(Math.max(0, value), max > 0 ? max : defaultMax)

  const fromObject = (obj: Record<string, unknown>) => {
    if (
      'tokens' in obj &&
      typeof obj.tokens === 'object' &&
      obj.tokens !== null
    ) {
      return fromObject(obj.tokens as Record<string, unknown>)
    }

    const current = clamp(
      numericOr(
        obj.current ??
          obj.count ??
          obj.available ??
          obj.tokensAvailable ??
          obj.value,
        base.current
      ),
      numericOr(obj.max ?? obj.capacity ?? base.max, defaultMax)
    )

    const max =
      numericOr(obj.max ?? obj.capacity ?? base.max, defaultMax) || defaultMax

    const next = nextOr(
      obj.nextInSeconds ??
        obj.nextTokenInSeconds ??
        obj.next_token_seconds ??
        obj.nextInSecondsSeconds,
      base.nextInSeconds
    )

    return {
      current,
      max,
      nextInSeconds: next
    }
  }

  if (source && typeof source === 'object') {
    return fromObject(source as Record<string, unknown>)
  }

  if (typeof source === 'number' && Number.isFinite(source)) {
    return {
      current: clamp(source, base.max),
      max: base.max,
      nextInSeconds: base.nextInSeconds
    }
  }

  return {
    current: clamp(base.current, base.max),
    max: base.max,
    nextInSeconds: base.nextInSeconds
  }
}

const pushUniqueWarning = (warnings: string[], warning: string) => {
  if (!warnings.includes(warning)) {
    warnings.push(warning)
  }
}

/** Decrypt, live refresh and the player_mapping write run only for POST (`allowRefresh`). */
async function handleTokensRequest(
  request: NextRequest,
  { allowRefresh }: { allowRefresh: boolean }
) {
  try {
    const supabaseAuth = await db()
    await requireSessionUser(supabaseAuth, () =>
      Errors.fromResponse(401, { error: 'Unauthorized' })
    )

    const { searchParams } = new URL(request.url)
    const playerId = searchParams.get('playerId')

    if (!playerId) {
      throw Errors.fromResponse(400, { error: 'Player ID required' })
    }

    // The authenticated role cannot read tacticus_api_key_encrypted.
    const supabase = serviceDb()

    const { data: playerDataRaw, error } = await supabase
      .from('player_mapping')
      .select(
        `
        display_name,
        guild_code,
        cluster_code,
        api_tokens,
        last_tokens_refresh,
        last_sync_tokens,
        last_sync_bombs,
        next_token_seconds,
        next_bomb_seconds,
        tacticus_api_key_encrypted,
        api_key_is_valid,
        api_key_last_verified
      `
      )
      .eq('player_id', playerId)
      .eq('is_current', true)
      .maybeSingle()

    const playerData = playerDataRaw as PlayerMappingRow | null

    if (error) {
      logger.error({ err: error }, 'Error fetching player tokens:')

      if (error.code === 'PGRST116') {
        throw Errors.fromResponse(404, { error: 'Player not found' })
      }

      return NextResponse.json({
        success: true,
        data: {
          playerName: null,
          guildCode: null,
          clusterCode: null,
          tokens: {
            guildRaid: deriveStatus(
              null,
              0,
              null,
              TOKEN_MAX_DEFAULTS.guildRaid
            ),
            bomb: deriveStatus(null, 0, null, TOKEN_MAX_DEFAULTS.bomb),
            arena: deriveStatus(null, 0, null, TOKEN_MAX_DEFAULTS.arena),
            onslaught: deriveStatus(
              null,
              0,
              null,
              TOKEN_MAX_DEFAULTS.onslaught
            ),
            salvageRun: deriveStatus(
              null,
              0,
              null,
              TOKEN_MAX_DEFAULTS.salvageRun
            ),
            expedition: deriveStatus(
              null,
              0,
              null,
              TOKEN_MAX_DEFAULTS.expedition
            )
          },
          lastRefresh: null,
          warnings: ['token_data_unavailable'],
          hasPlayerApiKey: false,
          tokenSource: 'fallback' as TokenSource,
          apiKeyStatus: {
            isValid: null,
            lastVerified: null
          }
        }
      })
    }

    if (!playerData) {
      throw Errors.fromResponse(404, { error: 'Player not found' })
    }

    // IDOR guard: the lookup bypassed RLS on a caller-supplied playerId. Restrict to
    // the player's guild (or cluster for officers) before decrypt/fetch/update.
    if (!playerData.guild_code) {
      throw Errors.fromResponse(403, { error: 'Access denied' })
    }
    await requireTokenUsageGuildAccess(playerData.guild_code)

    const warnings: string[] = []

    const encryptedPlayerApiKey =
      typeof playerData.tacticus_api_key_encrypted === 'string'
        ? playerData.tacticus_api_key_encrypted.trim()
        : ''

    const hasPlayerApiKey =
      encryptedPlayerApiKey.length > 0 || playerData.api_key_is_valid === true

    if (!hasPlayerApiKey) {
      pushUniqueWarning(warnings, 'player_api_key_missing')
    }

    const fallbackTokenSnapshot = {
      ...ZERO_TOKEN_SNAPSHOT,
      tokensAvailable: numericOr(playerData.last_sync_tokens, 0),
      bombsAvailable: numericOr(playerData.last_sync_bombs, 0),
      nextTokenSeconds: nextOr(
        playerData.next_token_seconds,
        ZERO_TOKEN_SNAPSHOT.nextTokenSeconds
      ),
      nextBombSeconds: nextOr(
        playerData.next_bomb_seconds,
        ZERO_TOKEN_SNAPSHOT.nextBombSeconds
      )
    }

    let storedTokenData: Record<string, unknown> | null = null
    if (playerData.api_tokens) {
      try {
        storedTokenData = JSON.parse(playerData.api_tokens)
      } catch (parseError) {
        logger.error({ err: parseError }, 'Error parsing stored token data:')
      }
    }

    let tokenSource: TokenSource = storedTokenData ? 'cached' : 'fallback'
    let lastRefresh = playerData.last_tokens_refresh ?? null

    let apiKeyIsValid =
      typeof playerData.api_key_is_valid === 'boolean'
        ? playerData.api_key_is_valid
        : null
    let apiKeyLastVerified = playerData.api_key_last_verified ?? null

    let decryptedApiKey: string | null = null

    if (allowRefresh) {
      if (encryptedPlayerApiKey.length > 0) {
        decryptedApiKey = await getPlayerApiKey({
          tacticus_api_key_encrypted: encryptedPlayerApiKey
        })

        if (!decryptedApiKey) {
          pushUniqueWarning(warnings, 'player_api_key_unavailable')
        }
      } else if (hasPlayerApiKey) {
        pushUniqueWarning(warnings, 'player_api_key_unavailable')
      }
    }

    if (decryptedApiKey) {
      try {
        const playerInfo = await tacticusAPI.getPlayer(decryptedApiKey)

        if (playerInfo?.progress) {
          const progressRecord = toRecord(playerInfo.progress)

          const guildRaidRecord = progressRecord
            ? toRecord(progressRecord['guildRaid'])
            : null
          const guildRaidTokens = guildRaidRecord
            ? readTokenDetails(guildRaidRecord['tokens'])
            : null
          const bombTokens = guildRaidRecord
            ? readTokenDetails(guildRaidRecord['bombTokens'])
            : null
          const arenaTokens = readTokenDetails(
            progressRecord ? progressRecord['arena'] : null
          )
          const onslaughtTokens = readTokenDetails(
            progressRecord ? progressRecord['onslaught'] : null
          )
          const salvageTokens = readTokenDetails(
            progressRecord ? progressRecord['salvageRun'] : null
          )
          const expeditionTokens = readTokenDetails(
            progressRecord ? progressRecord['expedition'] : null
          )

          const liveTokenSnapshot: LiveTokenSnapshot = {
            tokensAvailable: numericOr(
              guildRaidTokens?.current,
              fallbackTokenSnapshot.tokensAvailable
            ),
            nextTokenSeconds: nextOr(
              guildRaidTokens?.nextTokenInSeconds,
              fallbackTokenSnapshot.nextTokenSeconds
            ),
            bombsAvailable: numericOr(
              bombTokens?.current,
              fallbackTokenSnapshot.bombsAvailable
            ),
            nextBombSeconds: nextOr(
              bombTokens?.nextTokenInSeconds,
              fallbackTokenSnapshot.nextBombSeconds
            ),
            arenaTokens: numericOr(
              arenaTokens?.current,
              fallbackTokenSnapshot.arenaTokens
            ),
            nextArenaTokenSeconds: nextOr(
              arenaTokens?.nextTokenInSeconds,
              fallbackTokenSnapshot.nextArenaTokenSeconds
            ),
            onslaughtTokens: numericOr(
              onslaughtTokens?.current,
              fallbackTokenSnapshot.onslaughtTokens
            ),
            nextOnslaughtTokenSeconds: nextOr(
              onslaughtTokens?.nextTokenInSeconds,
              fallbackTokenSnapshot.nextOnslaughtTokenSeconds
            ),
            salvageTokens: numericOr(
              salvageTokens?.current,
              fallbackTokenSnapshot.salvageTokens
            ),
            nextSalvageTokenSeconds: nextOr(
              salvageTokens?.nextTokenInSeconds,
              fallbackTokenSnapshot.nextSalvageTokenSeconds
            ),
            expeditionTokens: numericOr(
              expeditionTokens?.current,
              fallbackTokenSnapshot.expeditionTokens
            ),
            nextExpeditionTokenSeconds: nextOr(
              expeditionTokens?.nextTokenInSeconds,
              fallbackTokenSnapshot.nextExpeditionTokenSeconds
            ),
            guildRaid: guildRaidTokens,
            bomb: bombTokens,
            arena: arenaTokens,
            onslaught: onslaughtTokens,
            salvageRun: salvageTokens,
            expedition: expeditionTokens
          }

          storedTokenData = liveTokenSnapshot
          tokenSource = 'live'

          const nowIso = new Date().toISOString()
          lastRefresh = nowIso
          apiKeyIsValid = true
          apiKeyLastVerified = nowIso

          const updatePayload: Record<string, unknown> = {
            api_tokens: JSON.stringify(liveTokenSnapshot),
            last_tokens_refresh: nowIso,
            api_key_is_valid: true,
            api_key_last_verified: nowIso,
            updated_at: nowIso
          }

          const raidCurrent = numericOr(
            liveTokenSnapshot.guildRaid?.current ??
              liveTokenSnapshot.tokensAvailable,
            fallbackTokenSnapshot.tokensAvailable
          )
          if (Number.isFinite(raidCurrent)) {
            updatePayload.last_sync_tokens = raidCurrent
          }

          const raidNext = nextOr(
            liveTokenSnapshot.guildRaid?.nextTokenInSeconds ??
              liveTokenSnapshot.nextTokenSeconds,
            fallbackTokenSnapshot.nextTokenSeconds
          )
          updatePayload.next_token_seconds = raidNext

          const bombCurrent = numericOr(
            liveTokenSnapshot.bomb?.current ?? liveTokenSnapshot.bombsAvailable,
            fallbackTokenSnapshot.bombsAvailable
          )
          if (Number.isFinite(bombCurrent)) {
            updatePayload.last_sync_bombs = bombCurrent
          }

          const bombNext = nextOr(
            liveTokenSnapshot.bomb?.nextTokenInSeconds ??
              liveTokenSnapshot.nextBombSeconds,
            fallbackTokenSnapshot.nextBombSeconds
          )
          updatePayload.next_bomb_seconds = bombNext

          const { error: updateError } = await supabase
            .from('player_mapping')
            .update(updatePayload as TablesUpdate<'player_mapping'>)
            .eq('player_id', playerId)
            .eq('is_current', true)

          if (updateError) {
            logger.error(
              { err: updateError },
              'Failed to persist live token snapshot:'
            )
          }
        } else {
          pushUniqueWarning(warnings, 'token_data_unavailable')
        }
      } catch (fetchError) {
        logger.error({ err: fetchError }, 'Failed to fetch live token data:')
        pushUniqueWarning(warnings, 'token_sync_failed')
      }
    }

    if (apiKeyIsValid === false) {
      pushUniqueWarning(warnings, 'player_api_key_invalid')
    }

    const normalizedTokens =
      storedTokenData && typeof storedTokenData === 'object'
        ? { ...fallbackTokenSnapshot, ...storedTokenData }
        : fallbackTokenSnapshot

    const tokenSourceData =
      storedTokenData && typeof storedTokenData === 'object'
        ? (storedTokenData as Record<string, unknown>)
        : null

    const tokensPayload = {
      guildRaid: deriveStatus(
        tokenSourceData?.guildRaid ??
          tokenSourceData?.guildRaidTokens ??
          tokenSourceData?.tokens,
        normalizedTokens.tokensAvailable,
        normalizedTokens.nextTokenSeconds,
        TOKEN_MAX_DEFAULTS.guildRaid
      ),
      bomb: deriveStatus(
        tokenSourceData?.bomb ??
          tokenSourceData?.bombs ??
          tokenSourceData?.bombTokens,
        normalizedTokens.bombsAvailable,
        normalizedTokens.nextBombSeconds,
        TOKEN_MAX_DEFAULTS.bomb
      ),
      arena: deriveStatus(
        tokenSourceData?.arena ??
          tokenSourceData?.arenaTokens ??
          tokenSourceData?.arena_tokens,
        normalizedTokens.arenaTokens,
        normalizedTokens.nextArenaTokenSeconds,
        TOKEN_MAX_DEFAULTS.arena
      ),
      onslaught: deriveStatus(
        tokenSourceData?.onslaught ??
          tokenSourceData?.onslaughtTokens ??
          tokenSourceData?.onslaught_tokens,
        normalizedTokens.onslaughtTokens,
        normalizedTokens.nextOnslaughtTokenSeconds,
        TOKEN_MAX_DEFAULTS.onslaught
      ),
      salvageRun: deriveStatus(
        tokenSourceData?.salvageRun ??
          tokenSourceData?.salvage_run ??
          tokenSourceData?.salvageTokens,
        normalizedTokens.salvageTokens,
        normalizedTokens.nextSalvageTokenSeconds,
        TOKEN_MAX_DEFAULTS.salvageRun
      ),
      expedition: deriveStatus(
        tokenSourceData?.expedition ??
          tokenSourceData?.expeditionTokens ??
          tokenSourceData?.expedition_tokens,
        normalizedTokens.expeditionTokens,
        normalizedTokens.nextExpeditionTokenSeconds,
        TOKEN_MAX_DEFAULTS.expedition
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        playerName: playerData.display_name,
        guildCode: playerData.guild_code,
        clusterCode: playerData.cluster_code,
        tokens: tokensPayload,
        lastRefresh,
        warnings,
        hasPlayerApiKey,
        tokenSource,
        apiKeyStatus: {
          isValid: apiKeyIsValid,
          lastVerified: apiKeyLastVerified
        }
      }
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    logger.error({ err: error }, 'Error in tokens API:')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
}

export const GET = withErrorHandler((request: NextRequest) =>
  handleTokensRequest(request, { allowRefresh: false })
)

/** Same auth as GET; decrypts the stored key, calls Tacticus live and persists. */
export const POST = withErrorHandler((request: NextRequest) =>
  handleTokensRequest(request, { allowRefresh: true })
)
