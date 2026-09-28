import { createComponentLogger } from '@/app/lib/logging'
import type { ServiceSupabaseClient, SyncJob } from './worker-types'

const logger = createComponentLogger('lib.sync.job-defer')

interface DeferOptions {
  delayMs: number
  reason: string
  progress?: Record<string, unknown>
}

export async function deferSyncJob(
  job: SyncJob,
  supabase: ServiceSupabaseClient,
  workerId: string,
  options: DeferOptions
): Promise<void> {
  const deferredAt = new Date()
  const scheduledFor = new Date(deferredAt.getTime() + options.delayMs)
  const { data: queueRow, error: attemptsError } = await supabase
    .from('sync_queue')
    .select('attempts')
    .eq('id', job.id)
    .eq('worker_id', workerId)
    .single()

  // Deferral must hand back the claim's attempt; without a readable count the
  // job would park pending at max_attempts, so let fail_job's retry path own it.
  if (attemptsError || typeof queueRow?.attempts !== 'number') {
    throw new Error(
      `Could not read attempts before deferral: ${attemptsError?.message ?? 'no attempts value'}`
    )
  }
  const attempts = Math.max(0, queueRow.attempts - 1)

  const { error } = await supabase
    .from('sync_queue')
    .update({
      status: 'pending',
      worker_id: null,
      started_at: null,
      scheduled_for: scheduledFor.toISOString(),
      updated_at: deferredAt.toISOString(),
      progress: {
        deferred: true,
        reason: options.reason,
        ...options.progress,
        deferred_by: workerId,
        deferred_at: deferredAt.toISOString()
      },
      attempts
    })
    .eq('id', job.id)
    .eq('worker_id', workerId)

  if (error) {
    throw new Error(
      `Failed to defer job for ${options.reason}: ${error.message ?? 'Unknown error'}`
    )
  }

  logger.info(
    { guildCode: job.guild_code, jobId: job.id, scheduledFor },
    `[Worker ${workerId}] Deferred job ${job.id} for ${options.reason}`
  )
}
