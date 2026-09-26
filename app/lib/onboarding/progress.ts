import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.onboarding.progress')
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { OnboardingProgress } from '@tacticus/app-core/onboarding.types'

export type {
  GuildMode,
  OnboardingProgress
} from '@tacticus/app-core/onboarding.types'

type OnboardingClient = {
  from: (table: 'onboarding_progress') => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        single: () => Promise<{
          data: OnboardingProgress | null
          error: { code: string; message: string } | null
        }>
      }
    }
    insert: (data: { user_id: string }) => {
      select: (columns: string) => {
        single: () => Promise<{
          data: OnboardingProgress | null
          error: { code: string; message: string } | null
        }>
      }
    }
  }
}

export async function getOrCreateOnboardingProgress(
  supabase: TypedSupabaseClient,
  userId: string
): Promise<OnboardingProgress | null> {
  const client = supabase as unknown as OnboardingClient
  const { data, error } = await client
    .from('onboarding_progress')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      const { data: inserted, error: insertError } = await client
        .from('onboarding_progress')
        .insert({ user_id: userId })
        .select('*')
        .single()

      if (insertError) {
        logger.error(
          { err: insertError },
          'Failed to create onboarding progress'
        )
        return null
      }
      return inserted
    }

    logger.error({ err: error }, 'Failed to load onboarding progress')
    return null
  }

  return data
}

export function resetStatusFields(
  _progress: OnboardingProgress,
  overrides: Partial<OnboardingProgress>
): Partial<OnboardingProgress> {
  return {
    guild_error_message: null,
    guild_can_retry: true,
    sync_error_message: null,
    sync_can_retry: true,
    profile_error_message: null,
    profile_can_retry: true,
    ...overrides
  }
}
