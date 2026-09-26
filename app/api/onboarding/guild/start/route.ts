import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.guild.start')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { AppError, Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  getOrCreateOnboardingProgress,
  type OnboardingProgress
} from '@/app/lib/onboarding/progress'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import {
  fetchCreateConfig,
  isCreateConfigTimeoutError
} from '@/app/api/onboarding/_lib/create-config-fetch'
import {
  captureGuildConflict,
  reconcileGuildConflict
} from '@/app/lib/onboarding/guild-membership-reconciliation'

interface GuildStartPayload {
  guildMode?: 'existing_guild' | 'new_guild'
  guildCode?: string
  guildName?: string
  apiKey?: string
}

type StandardRetryGuild = {
  guild_code: string
  display_name: string | null
}

type CreateConfigPayload = {
  // Raw DB/exception text: never forward or persist it.
  error?: { message?: string }
  data?: {
    // create-config may adopt an existing row's code.
    guild_code?: string
    claimed?: boolean
    playerMappingsCreated?: boolean
    autoDiscovered?: {
      guildName?: string
    }
  }
}

type GuildAttemptSettlement = {
  success?: boolean
  error_code?: string
  progress?: OnboardingProgress
}

async function beginGuildAttempt(
  serviceSupabase: ReturnType<typeof serviceDb>,
  userId: string
): Promise<number> {
  const { data, error } = await serviceSupabase.rpc(
    'begin_own_guild_onboarding_attempt',
    { p_subject: userId }
  )
  if (
    error ||
    typeof data !== 'number' ||
    !Number.isSafeInteger(data) ||
    data < 1
  ) {
    logger.error({ err: error }, 'Could not begin guild onboarding attempt')
    throw Errors.fromResponse(503, {
      error: 'Guild onboarding could not be started. Please retry.'
    })
  }
  return data
}

async function settleGuildAttempt({
  serviceSupabase,
  userId,
  generation,
  outcome,
  guildMode = 'new_guild',
  roleIntent = 'leader',
  guildCode = null,
  guildName = null,
  syncStatus = null,
  errorMessage = null
}: {
  serviceSupabase: ReturnType<typeof serviceDb>
  userId: string
  generation: number
  outcome: 'complete' | 'failed'
  guildMode?: 'new_guild' | 'existing_guild'
  roleIntent?: 'leader' | 'member'
  guildCode?: string | null
  guildName?: string | null
  syncStatus?: 'not_required' | 'pending' | 'complete' | null
  errorMessage?: string | null
}): Promise<GuildAttemptSettlement> {
  const { data, error } = await serviceSupabase.rpc(
    'settle_own_guild_onboarding_attempt',
    {
      p_subject: userId,
      p_generation: generation,
      p_outcome: outcome,
      p_guild_mode: guildMode,
      p_role_intent: roleIntent,
      p_guild_code: guildCode ?? undefined,
      p_guild_name: guildName ?? undefined,
      p_sync_status: syncStatus ?? undefined,
      p_error_message: errorMessage ?? undefined
    }
  )
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    logger.error({ err: error }, 'Could not settle guild onboarding attempt')
    return { success: false, error_code: 'SETTLEMENT_FAILED' }
  }
  return data as GuildAttemptSettlement
}

async function recordBootstrapClaimAuthority({
  serviceSupabase,
  userId,
  guildCode,
  attemptGeneration
}: {
  serviceSupabase: ReturnType<typeof serviceDb>
  userId: string
  guildCode: string
  attemptGeneration: number
}): Promise<void> {
  const { error } = await serviceSupabase.rpc(
    'record_guild_bootstrap_claim_authority',
    {
      p_subject: userId,
      p_guild_code: guildCode,
      p_attempt_generation: attemptGeneration,
      p_source: 'verified_registration'
    }
  )
  if (error) {
    logger.error(
      { err: error, guildCode },
      'Could not record first-profile claim authority'
    )
    throw Errors.fromResponse(503, {
      error:
        'Your guild was verified, but profile linking could not be prepared. Please retry.'
    })
  }
}

/** True when `apiKey` resolves to the guild `guildCode` is registered under; null never matches. */
async function resumeOwnedGuildRegistration({
  apiKey,
  guildCode,
  serviceSupabase
}: {
  apiKey: string
  guildCode: string
  serviceSupabase: ReturnType<typeof serviceDb>
}): Promise<string | null> {
  try {
    const { data: row } = await serviceSupabase
      .from('guild_config')
      .select('guild_id')
      .eq('guild_code', guildCode)
      .maybeSingle()

    const registeredGuildId = (row as { guild_id?: string | null } | null)
      ?.guild_id
    if (!registeredGuildId) return null

    const upstream = await tacticusAPI.getGuild(apiKey)
    const keyGuildId = upstream?.guildId
    if (!keyGuildId) return null

    return keyGuildId === registeredGuildId ? registeredGuildId : null
  } catch (error) {
    logger.warn(
      { err: error, guildCode },
      'Could not verify guild key custody for an already-registered guild'
    )
    return null
  }
}

/** The stored message and the HTTP body must be the same sentence. */
async function recordGuildFailure({
  userId,
  status,
  message,
  attemptGeneration,
  serviceSupabase
}: {
  userId: string
  status: number
  message: string
  attemptGeneration: number
  serviceSupabase: ReturnType<typeof serviceDb>
}): Promise<AppError> {
  const settlement = await settleGuildAttempt({
    serviceSupabase,
    userId,
    generation: attemptGeneration,
    outcome: 'failed',
    errorMessage: message
  })
  if (
    settlement.success !== true &&
    settlement.error_code !== 'ATTEMPT_SUPERSEDED'
  ) {
    logger.error(
      { errorCode: settlement.error_code },
      'Guild onboarding failure could not be persisted'
    )
  }
  return Errors.fromResponse(status, { error: message })
}

const GUILD_ALREADY_REGISTERED_IN_ANALYTICS =
  'This guild is already registered in analytics. If it is your guild, use the "Existing Guild" option, or sign in with the account that registered it.'
const GUILD_REGISTRATION_UNAVAILABLE =
  'We could not register your guild. Please try again in a few minutes.'
const MAX_FORWARDED_MESSAGE_LENGTH = 200

/** Allowlist: 409 can embed another guild's id or name and 5xx may carry raw exception text. */
function resolveCreateConfigMessage(
  status: number,
  payload: CreateConfigPayload | null | undefined
): string {
  if (status === 409) return GUILD_ALREADY_REGISTERED_IN_ANALYTICS

  if (status === 400 || status === 401 || status === 403 || status === 404) {
    const message = payload?.error?.message
    if (
      typeof message === 'string' &&
      message.trim().length > 0 &&
      message.length <= MAX_FORWARDED_MESSAGE_LENGTH &&
      // The catch-all wraps raw exception text; never render it.
      !message.startsWith('Validation failed:')
    ) {
      return message
    }
  }

  return GUILD_REGISTRATION_UNAVAILABLE
}

/** 401/403 here are about the GAME key; a 401 would read as "logged out". */
function mapCreateConfigStatus(status: number): number {
  if (status === 401 || status === 403) return 400
  return status || 500
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authedSupabase = await db()
  const user = await requireSessionUser(authedSupabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )

  const serviceSupabase = serviceDb()
  const body = (await request.json()) as GuildStartPayload
  const requestedMode = body.guildMode

  try {
    const progress = await getOrCreateOnboardingProgress(
      authedSupabase,
      user.id
    )

    if (!progress) {
      throw Errors.fromResponse(500, {
        error: 'Unable to load onboarding progress'
      })
    }

    const activeMode = requestedMode ?? progress.guild_mode
    if (!activeMode) {
      throw Errors.fromResponse(400, { error: 'Onboarding mode not selected' })
    }

    if (activeMode === 'existing_guild') {
      const guildInput = body.guildCode?.trim().toUpperCase()
      if (!guildInput) {
        throw Errors.fromResponse(400, { error: 'Guild code is required' })
      }
      const attemptGeneration = await beginGuildAttempt(
        serviceSupabase,
        user.id
      )
      const failExistingGuild = (status: number, message: string) =>
        recordGuildFailure({
          userId: user.id,
          status,
          message,
          attemptGeneration,
          serviceSupabase
        })

      const guild = await GuildConfigService.findByCodeOrTag(
        serviceSupabase,
        guildInput
      )
      const guildCode = guild?.guild_code ?? guildInput

      if (!guild) {
        // Do not interpolate user-typed `guildInput`.
        throw await failExistingGuild(
          404,
          'We could not find that guild code. Check the code on your guild overview screen in Tacticus, or use "Register New Guild" if nobody has onboarded it yet.'
        )
      }

      if (!guild.enabled) {
        throw await failExistingGuild(
          400,
          'Guild exists but is not enabled yet. Contact an administrator.'
        )
      }

      const { count: playerCount } = await guildRosterQuery(
        serviceSupabase,
        guildCode,
        '*',
        { count: 'exact', head: true }
      )

      if (!playerCount || playerCount === 0) {
        throw await failExistingGuild(
          400,
          'Guild exists but has no synced players yet. Please wait a few minutes for the initial sync to complete, then try again.'
        )
      }

      const { data: syncMeta } = await serviceSupabase
        .from('guild_sync_status')
        .select('full_sync_success')
        .eq('guild_code', guildCode)
        .single()

      const guildHasCompletedSync =
        guild.onboarding_completed === true ||
        syncMeta?.full_sync_success === true

      const settlement = await settleGuildAttempt({
        serviceSupabase,
        userId: user.id,
        generation: attemptGeneration,
        outcome: 'complete',
        guildMode: 'existing_guild',
        roleIntent: 'member',
        guildCode: guild.guild_code,
        guildName: guild.display_name,
        syncStatus: guildHasCompletedSync ? 'not_required' : 'pending'
      })
      if (settlement.success !== true || !settlement.progress) {
        if (settlement.error_code === 'ATTEMPT_SUPERSEDED') {
          throw Errors.fromResponse(409, {
            error:
              'A newer guild registration request superseded this one. Refresh onboarding to see the latest result.'
          })
        }
        throw Errors.fromResponse(503, {
          error: 'Onboarding could not be finalized. Please retry.'
        })
      }

      return NextResponse.json({ progress: settlement.progress })
    }

    const guildCode = body.guildCode?.trim().toUpperCase()
    const guildName = body.guildName?.trim()
    const apiKey = body.apiKey?.trim()

    if (!guildCode || !guildName || !apiKey) {
      throw Errors.fromResponse(400, {
        error: 'Guild code, name, and API key are required'
      })
    }

    const attemptGeneration = await beginGuildAttempt(serviceSupabase, user.id)
    const failNewGuild = (status: number, message: string) =>
      recordGuildFailure({
        userId: user.id,
        status,
        message,
        attemptGeneration,
        serviceSupabase
      })
    const completeNewGuild = async (
      completedGuildCode: string,
      completedGuildName: string,
      completedSyncStatus: 'not_required' | 'pending' | 'complete'
    ): Promise<OnboardingProgress> => {
      const settlement = await settleGuildAttempt({
        serviceSupabase,
        userId: user.id,
        generation: attemptGeneration,
        outcome: 'complete',
        guildCode: completedGuildCode,
        guildName: completedGuildName,
        syncStatus: completedSyncStatus
      })
      if (settlement.success === true && settlement.progress) {
        await recordBootstrapClaimAuthority({
          serviceSupabase,
          userId: user.id,
          guildCode: completedGuildCode,
          attemptGeneration
        })
        return settlement.progress
      }
      if (settlement.error_code === 'ATTEMPT_SUPERSEDED') {
        throw Errors.fromResponse(409, {
          error:
            'A newer guild registration request superseded this one. Refresh onboarding to see the latest result.'
        })
      }
      throw Errors.fromResponse(503, {
        error:
          'Your guild was verified, but onboarding could not be finalized. Please retry.'
      })
    }

    const existingGuild = await GuildConfigService.findByCodeOrTag(
      serviceSupabase,
      guildCode
    )
    let retryGuild: StandardRetryGuild | null = null

    if (existingGuild) {
      if (existingGuild.onboarding_completed !== true) {
        const { data: retryRow, error: retryError } = await serviceSupabase
          .from('guild_config')
          .select(
            'guild_code, display_name, cluster_code, onboarding_source, onboarding_completed'
          )
          .eq('guild_code', existingGuild.guild_code)
          .maybeSingle()

        if (retryError) {
          logger.error(
            { err: retryError },
            'Unable to verify existing guild onboarding state'
          )
          throw await failNewGuild(
            500,
            'Unable to verify existing guild onboarding state'
          )
        }

        const retryRecord = retryRow as {
          guild_code?: string | null
          display_name?: string | null
          cluster_code?: string | null
          onboarding_source?: string | null
          onboarding_completed?: boolean | null
        } | null
        const clusterCode = retryRecord?.cluster_code?.trim() ?? ''
        const retrySource = retryRecord?.onboarding_source ?? null

        if (
          retryRecord?.guild_code &&
          retryRecord.onboarding_completed !== true &&
          !clusterCode &&
          (retrySource === 'standard' || retrySource === null)
        ) {
          retryGuild = {
            guild_code: retryRecord.guild_code,
            display_name: retryRecord.display_name ?? null
          }
        }
      }

      if (!retryGuild) {
        // A key resolving to this guild proves custody, so a re-submission resumes (never identity proof).
        const resumedGuildId = await resumeOwnedGuildRegistration({
          apiKey,
          guildCode: existingGuild.guild_code,
          serviceSupabase
        })

        if (resumedGuildId) {
          // A prior attempt may have committed the guild but failed reconciling the former guild.
          let membershipReconciled = false
          try {
            const candidate = await captureGuildConflict({
              service: serviceSupabase,
              userId: user.id,
              targetGuildId: resumedGuildId
            })
            const resolution = await reconcileGuildConflict({
              service: serviceSupabase,
              userId: user.id,
              apiKey,
              attemptGeneration,
              targetGuildCode: existingGuild.guild_code,
              targetGuildId: resumedGuildId,
              candidate
            })
            membershipReconciled = resolution.reconciled
          } catch (error) {
            if (error instanceof AppError) {
              throw await failNewGuild(error.statusCode, error.message)
            }
            throw error
          }

          const updated = await completeNewGuild(
            existingGuild.guild_code,
            existingGuild.display_name ?? existingGuild.guild_code,
            'not_required'
          )

          logger.info(
            { guildCode: existingGuild.guild_code },
            'Resumed onboarding for an already-registered guild the caller holds the key for'
          )

          return NextResponse.json({
            progress: updated,
            guildInfo: null,
            claimed: false,
            alreadyRegistered: true,
            membershipReconciled
          })
        }

        throw await failNewGuild(
          409,
          'This guild is already registered. Use the "Existing Guild" option.'
        )
      }

      logger.info(
        { guildCode: retryGuild.guild_code },
        'Retrying incomplete standard guild onboarding'
      )
    }

    const validation = await validateApiKeyWithTacticus(apiKey)
    if (!validation.isValid) {
      // Only the raw-exception catch-all is suppressed.
      const rawValidationError = validation.error ?? ''
      const message =
        rawValidationError &&
        !rawValidationError.startsWith('Validation failed:')
          ? rawValidationError
          : 'API key validation failed. Please confirm the key is correct and has Guild + Guild Raid read access.'

      throw await failNewGuild(400, message)
    }

    const targetGuildId = validation.guildInfo?.guildId
    let membershipConflict
    try {
      membershipConflict = targetGuildId
        ? await captureGuildConflict({
            service: serviceSupabase,
            userId: user.id,
            targetGuildId
          })
        : null
    } catch (error) {
      if (error instanceof AppError) {
        throw await failNewGuild(error.statusCode, error.message)
      }
      throw error
    }

    let createConfigResponse: Response
    let createConfigPayload: CreateConfigPayload
    try {
      createConfigResponse = await fetchCreateConfig(request, {
        guild_code: retryGuild?.guild_code ?? guildCode,
        display_name: guildName,
        api_key: apiKey
      })
      createConfigPayload =
        (await createConfigResponse.json()) as CreateConfigPayload
    } catch (error) {
      if (isCreateConfigTimeoutError(error)) {
        throw await failNewGuild(
          504,
          'Guild registration timed out. Please retry.'
        )
      }

      throw error
    }

    if (!createConfigResponse.ok) {
      logger.error(
        { err: createConfigPayload },
        'Create-config failed during onboarding'
      )

      throw await failNewGuild(
        mapCreateConfigStatus(createConfigResponse.status),
        resolveCreateConfigMessage(
          createConfigResponse.status,
          createConfigPayload
        )
      )
    }

    const configData = createConfigPayload?.data
    const playerMappingsCreated = configData?.playerMappingsCreated === true
    const syncStatus = playerMappingsCreated ? 'complete' : 'pending'

    const committedGuildCode =
      configData?.guild_code || retryGuild?.guild_code || guildCode
    const claimedExistingGuild = configData?.claimed === true
    if (committedGuildCode !== (retryGuild?.guild_code ?? guildCode)) {
      logger.info(
        {
          requestedGuildCode: retryGuild?.guild_code ?? guildCode,
          committedGuildCode
        },
        'create-config adopted an existing guild_code; keying onboarding progress on the committed code'
      )
    }

    let membershipReconciled = false
    try {
      const resolution = await reconcileGuildConflict({
        service: serviceSupabase,
        userId: user.id,
        apiKey,
        attemptGeneration,
        targetGuildCode: committedGuildCode,
        targetGuildId: targetGuildId ?? '',
        candidate: membershipConflict
      })
      membershipReconciled = resolution.reconciled
    } catch (error) {
      if (error instanceof AppError) {
        throw await failNewGuild(error.statusCode, error.message)
      }
      throw error
    }

    const updated = await completeNewGuild(
      committedGuildCode,
      configData?.autoDiscovered?.guildName ||
        retryGuild?.display_name ||
        guildName,
      syncStatus
    )

    return NextResponse.json({
      progress: updated,
      guildInfo: configData?.autoDiscovered || null,
      claimed: claimedExistingGuild,
      membershipReconciled
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Onboarding guild start failed')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})
