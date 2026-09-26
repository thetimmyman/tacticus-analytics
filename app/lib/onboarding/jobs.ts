import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type {
  OnboardingJob,
  OnboardingJobStatus,
  OnboardingJobType
} from '@tacticus/app-core/onboarding.types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.onboarding.jobs')

export interface EnqueueJobOptions {
  userId: string
  guildCode: string
  clusterCode?: string | null
  payload?: Record<string, unknown>
  maxAttempts?: number
}

type JobInsertData = {
  user_id: string
  guild_code: string
  cluster_code: string | null
  job_type: OnboardingJobType
  status: 'queued'
  payload: Record<string, unknown> | null
  max_attempts: number
}

type JobUpdateData = {
  status: OnboardingJobStatus
  attempts?: number
  result?: Record<string, unknown> | null
  error_message?: string | null
  last_error_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

type OnboardingJobsClient = {
  from: (table: 'onboarding_jobs') => {
    insert: (data: JobInsertData) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: OnboardingJob | null
          error: { message: string } | null
        }>
      }
    }
    update: (data: JobUpdateData) => {
      eq: (
        column: string,
        value: string
      ) => Promise<{ error: { message: string } | null }>
    }
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        single: () => Promise<{
          data: OnboardingJob | null
          error: { message: string } | null
        }>
        order: (
          column: string,
          options: { ascending: boolean }
        ) => {
          limit: (count: number) => {
            maybeSingle: () => Promise<{
              data: OnboardingJob | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  }
}

export interface EnqueueJobResult {
  job: OnboardingJob | null
  error: string | null
}

export async function enqueueOnboardingJob(
  supabase: TypedSupabaseClient,
  jobType: OnboardingJobType,
  options: EnqueueJobOptions
): Promise<EnqueueJobResult> {
  const client = supabase as unknown as OnboardingJobsClient
  try {
    const { data, error } = await client
      .from('onboarding_jobs')
      .insert({
        user_id: options.userId,
        guild_code: options.guildCode,
        cluster_code: options.clusterCode ?? null,
        job_type: jobType,
        status: 'queued',
        payload: options.payload ?? null,
        max_attempts: options.maxAttempts ?? 3
      })
      .select('*')
      .single()

    if (error) {
      logger.error({ err: error }, '[OnboardingJobs] Failed to enqueue job')
      return { job: null, error: error.message }
    }

    return { job: data, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error(
      { err: error },
      '[OnboardingJobs] Unexpected error enqueuing job'
    )
    return { job: null, error: message }
  }
}

export async function updateOnboardingJobStatus(
  supabase: TypedSupabaseClient,
  jobId: string,
  status: OnboardingJobStatus,
  updates: Partial<
    Pick<
      OnboardingJob,
      | 'attempts'
      | 'result'
      | 'error_message'
      | 'last_error_at'
      | 'started_at'
      | 'completed_at'
    >
  > = {}
): Promise<void> {
  const client = supabase as unknown as OnboardingJobsClient
  const payload: JobUpdateData = {
    status,
    ...updates
  }

  try {
    const { error } = await client
      .from('onboarding_jobs')
      .update(payload)
      .eq('id', jobId)

    if (error) {
      logger.error(
        { jobId, status, error },
        '[OnboardingJobs] Failed to update job status'
      )
    }
  } catch (error) {
    logger.error(
      { jobId, status, error },
      '[OnboardingJobs] Unexpected error updating job status'
    )
  }
}

export async function fetchOnboardingJobById(
  supabase: TypedSupabaseClient,
  jobId: string
): Promise<OnboardingJob | null> {
  const client = supabase as unknown as OnboardingJobsClient
  try {
    const { data, error } = await client
      .from('onboarding_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (error) {
      logger.error({ jobId, error }, '[OnboardingJobs] Failed to fetch job')
      return null
    }

    return data
  } catch (error) {
    logger.error(
      { jobId, error },
      '[OnboardingJobs] Unexpected error fetching job'
    )
    return null
  }
}

export async function fetchLatestJobForGuild(
  supabase: TypedSupabaseClient,
  guildCode: string
): Promise<OnboardingJob | null> {
  const client = supabase as unknown as OnboardingJobsClient
  try {
    const { data, error } = await client
      .from('onboarding_jobs')
      .select('*')
      .eq('guild_code', guildCode)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.error(
        { guildCode, error },
        '[OnboardingJobs] Failed to fetch latest job for guild'
      )
      return null
    }

    return data
  } catch (error) {
    logger.error(
      { guildCode, error },
      '[OnboardingJobs] Unexpected error fetching latest job for guild'
    )
    return null
  }
}
