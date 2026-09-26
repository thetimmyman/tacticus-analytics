import { decryptApiKey } from '@tacticus/app-core/encryption'
import {
  type ServiceSupabaseClient,
  type WorkerResult,
  type SyncJob
} from './worker-types'
import {
  completeSyncJob,
  failMissingGuildConfig,
  failSyncJob
} from './sync-job-lifecycle'
import {
  getLastSyncTime,
  processPlayerSync,
  processValidationSync,
  runRaidSyncWithOptionalExecutionLock
} from './worker-jobs'

export async function processJob(
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  workerId: string
): Promise<WorkerResult> {
  const jobStart = Date.now()
  const result: WorkerResult = {
    jobId: job.id,
    success: false,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  }

  try {
    const { data: guildConfig, error: configError } = await supabase
      .from('guild_config')
      .select('*')
      .eq('guild_code', job.guild_code)
      .single()
    const configErrorMessage = configError?.message ?? 'No config returned'

    if (configError || !guildConfig) {
      // PGRST116 / no row means the guild doesn't exist, not a transient RLS issue.
      const isPermanentError = configError?.code === 'PGRST116' || !guildConfig
      if (isPermanentError) {
        await failMissingGuildConfig(
          job,
          supabase,
          workerId,
          configErrorMessage
        )
        return result
      }
      throw new Error(`Guild config not found: ${configErrorMessage}`)
    }

    if (job.job_type === 'validation_sync') {
      await processValidationSync(job, guildConfig, supabase, result)
    } else {
      let apiKey: string | null = null
      if (guildConfig.api_key_encrypted) {
        apiKey = await decryptApiKey(guildConfig.api_key_encrypted)
      }

      if (!apiKey) {
        throw new Error('No API key available')
      }

      let deferredForExecutionLock = false

      switch (job.job_type) {
        case 'full_sync':
          deferredForExecutionLock = await runRaidSyncWithOptionalExecutionLock(
            job,
            guildConfig,
            apiKey,
            supabase,
            result,
            workerId,
            {
              sinceTime: null,
              deleteBeforeUpsert: true,
              strictEntryFilter: true,
              batchedUpsert: true,
              runCoverageCheck: true
            }
          )
          break

        // Frequent syncs tolerate partial batch failures; the next cycle catches up.
        case 'incremental_sync': {
          const sinceTime = await getLastSyncTime(job.guild_code, supabase)
          deferredForExecutionLock = await runRaidSyncWithOptionalExecutionLock(
            job,
            guildConfig,
            apiKey,
            supabase,
            result,
            workerId,
            {
              sinceTime,
              deleteBeforeUpsert: false,
              strictEntryFilter: false,
              batchedUpsert: true,
              runCoverageCheck: false
            }
          )
          break
        }

        case 'realtime_sync':
          deferredForExecutionLock = await runRaidSyncWithOptionalExecutionLock(
            job,
            guildConfig,
            apiKey,
            supabase,
            result,
            workerId,
            {
              sinceTime: new Date(Date.now() - 5 * 60 * 1000),
              deleteBeforeUpsert: false,
              strictEntryFilter: false,
              batchedUpsert: false,
              runCoverageCheck: false
            }
          )
          break

        case 'player_sync':
          await processPlayerSync(job, guildConfig, apiKey, supabase, result)
          break

        default:
          throw new Error(`Unknown job type: ${job.job_type}`)
      }

      if (deferredForExecutionLock) {
        result.duration = Date.now() - jobStart
        return result
      }
    }

    if (result.upsertFailures > 0 && job.job_type === 'full_sync') {
      throw new Error(
        `${result.upsertFailures} upsert error(s): ${result.errors
          .filter((e) => e.includes('psert failed'))
          .slice(0, 3)
          .join('; ')}`
      )
    }

    await completeSyncJob(job, supabase, workerId, result)
  } catch (error) {
    await failSyncJob(error, job, supabase, workerId, result)
  }

  result.duration = Date.now() - jobStart
  return result
}
