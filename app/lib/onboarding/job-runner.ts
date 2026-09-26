import type { NextRequest } from 'next/server'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { OnboardingJob } from '@tacticus/app-core/onboarding.types'
import type { OnboardingProgress } from '@/app/lib/onboarding/progress'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.onboarding.job-runner')
import { resetStatusFields } from '@/app/lib/onboarding/progress'
import { updateOnboardingJobStatus } from '@/app/lib/onboarding/jobs'
import { SERVICE_TIMEOUTS, withTimeout } from '@/app/lib/utils/async-timeout'
import { buildTrustedInternalUrl } from '@/app/lib/onboarding/internal-url'

interface ProcessJobArgs {
  job: OnboardingJob
  authedSupabase: TypedSupabaseClient
  serviceSupabase: TypedSupabaseClient
  progress: OnboardingProgress
  request?: NextRequest
}

type SyncEdgeResponse = {
  success?: boolean
  error?: string
  message?: string
  recordsInserted?: number
  battles_inserted?: number
  durationMs?: number
  processing_time_ms?: number
  fallback?: boolean
  [key: string]: unknown
}

type OnboardingProgressClient = {
  from: (table: 'onboarding_progress' | 'guild_config') => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string | null
      ) => {
        single: <T>() => Promise<{
          data: T | null
          error: { message: string } | null
        }>
      }
    }
    update: (data: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string
      ) => Promise<{ error: { message: string } | null }>
    }
  }
  functions: {
    invoke: (
      name: string,
      options: { body: Record<string, unknown> }
    ) => Promise<{
      data: SyncEdgeResponse | null
      error: { message: string } | null
    }>
  }
}

async function fetchLegacyInitialSync(
  url: URL,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    SERVICE_TIMEOUTS.EXTERNAL_API
  )

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `Legacy initial sync timed out after ${SERVICE_TIMEOUTS.EXTERNAL_API}ms`
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function processGuildInitialSyncJob({
  job,
  authedSupabase,
  serviceSupabase,
  progress,
  request
}: ProcessJobArgs): Promise<{ success: boolean; error?: string | null }> {
  const startedAt = new Date().toISOString()
  const authedClient = authedSupabase as unknown as OnboardingProgressClient
  const serviceClient = serviceSupabase as unknown as OnboardingProgressClient

  await updateOnboardingJobStatus(serviceSupabase, job.id, 'processing', {
    attempts: job.attempts + 1,
    started_at: startedAt,
    last_error_at: null,
    error_message: null
  })

  try {
    // Credential is keyed on the job, not progress: `progress.guild_code` is
    // browser-writable, while the job row's guild code is server-derived.
    const authorizedGuildCode = job.guild_code
    if (!authorizedGuildCode) {
      throw new Error('Sync job carries no authorized guild')
    }

    const { data: guildConfig, error: guildError } = await serviceClient
      .from('guild_config')
      .select('api_key_encrypted')
      .eq('guild_code', authorizedGuildCode)
      .single<{ api_key_encrypted: string | null }>()

    if (guildError || !guildConfig?.api_key_encrypted) {
      throw new Error('Unable to locate encrypted API key for guild')
    }

    const encryptedKey = guildConfig.api_key_encrypted
    const useEdgeFunction = process.env.ONBOARDING_USE_EDGE_FUNCTION !== 'false'
    const allowLegacyFallback =
      !!request && process.env.ONBOARDING_ALLOW_LEGACY_FALLBACK !== 'false'

    let syncPayload: SyncEdgeResponse | null = null
    let syncSuccess = false
    let failureMessage: string | null = null

    if (useEdgeFunction) {
      try {
        const { data: functionData, error: functionError } = await withTimeout(
          serviceClient.functions.invoke('sync-modular-workflow', {
            body: {
              guild_code: authorizedGuildCode,
              api_key: encryptedKey
            }
          }),
          SERVICE_TIMEOUTS.EXTERNAL_API,
          'onboarding edge initial sync'
        )

        if (functionError) {
          failureMessage =
            functionError.message || 'Edge function invocation failed'
          logger.error(
            {
              jobId: job.id,
              guild: authorizedGuildCode,
              error: functionError
            },
            '[OnboardingJobs] Edge function invocation error'
          )
        } else if (!functionData?.success) {
          failureMessage =
            functionData?.error ||
            functionData?.message ||
            'Edge function reported failure'
          logger.error(
            {
              jobId: job.id,
              guild: authorizedGuildCode,
              payload: functionData
            },
            '[OnboardingJobs] Edge function reported failure'
          )
        } else {
          syncPayload = functionData
          syncSuccess = true
        }
      } catch (edgeError) {
        failureMessage =
          edgeError instanceof Error
            ? edgeError.message
            : 'Edge function invocation threw'
        logger.error(
          {
            jobId: job.id,
            guild: authorizedGuildCode,
            error: edgeError
          },
          '[OnboardingJobs] Edge function invocation threw'
        )
      }
    }

    if (!syncSuccess && allowLegacyFallback) {
      const decryptedKey = await decryptApiKey(encryptedKey)

      const syncResponse = await fetchLegacyInitialSync(
        buildTrustedInternalUrl('/api/guild/initial-sync'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: request!.headers.get('cookie') || ''
          },
          body: JSON.stringify({
            guild_code: authorizedGuildCode,
            api_key: decryptedKey
          })
        }
      )

      const legacyPayload = (await syncResponse.json()) as SyncEdgeResponse

      if (!syncResponse.ok || !legacyPayload?.success) {
        const errorMessage =
          legacyPayload?.error ||
          legacyPayload?.message ||
          failureMessage ||
          'Initial sync failed. Please verify your API key.'

        await updateOnboardingJobStatus(serviceSupabase, job.id, 'failed', {
          error_message: errorMessage,
          last_error_at: new Date().toISOString()
        })

        await authedClient
          .from('onboarding_progress')
          .update(
            resetStatusFields(progress, {
              sync_status: 'failed',
              sync_error_message: errorMessage,
              sync_can_retry: true
            })
          )
          .eq('user_id', progress.user_id)

        return { success: false, error: errorMessage }
      }

      syncPayload = legacyPayload
      syncSuccess = true
    }

    if (!syncSuccess) {
      const errorMessage =
        failureMessage || 'Initial sync failed. Please verify your API key.'

      await updateOnboardingJobStatus(serviceSupabase, job.id, 'failed', {
        error_message: errorMessage,
        last_error_at: new Date().toISOString()
      })

      await authedClient
        .from('onboarding_progress')
        .update(
          resetStatusFields(progress, {
            sync_status: 'failed',
            sync_error_message: errorMessage,
            sync_can_retry: true
          })
        )
        .eq('user_id', progress.user_id)

      return { success: false, error: errorMessage }
    }

    const updatedPayload = resetStatusFields(progress, {
      sync_status: 'complete',
      sync_progress: 100,
      sync_records_synced:
        typeof syncPayload?.recordsInserted === 'number'
          ? syncPayload.recordsInserted
          : typeof syncPayload?.battles_inserted === 'number'
            ? syncPayload.battles_inserted
            : progress.sync_records_synced,
      guild_status: 'complete'
    })

    await authedClient
      .from('onboarding_progress')
      .update(updatedPayload)
      .eq('user_id', progress.user_id)

    await updateOnboardingJobStatus(serviceSupabase, job.id, 'completed', {
      completed_at: new Date().toISOString(),
      result: {
        recordsInserted:
          syncPayload?.recordsInserted ?? syncPayload?.battles_inserted ?? null,
        durationMs:
          syncPayload?.durationMs ?? syncPayload?.processing_time_ms ?? null,
        message: syncPayload?.message ?? null,
        fallback: syncPayload?.fallback ?? false
      }
    })

    return { success: true }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error during initial sync job'
    logger.error(
      { jobId: job.id, error },
      '[OnboardingJobs] Guild initial sync job failed'
    )

    await updateOnboardingJobStatus(serviceSupabase, job.id, 'failed', {
      error_message: message,
      last_error_at: new Date().toISOString()
    })

    await authedClient
      .from('onboarding_progress')
      .update(
        resetStatusFields(progress, {
          sync_status: 'failed',
          sync_error_message: message,
          sync_can_retry: true
        })
      )
      .eq('user_id', progress.user_id)

    return { success: false, error: message }
  }
}
