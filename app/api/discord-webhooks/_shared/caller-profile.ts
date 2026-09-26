import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { Errors } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

const logger = createComponentLogger('api.discord-webhooks.caller-profile')

export type WebhookCallerProfile = Pick<PlayerMapping, 'role' | 'guild_code'>

export async function loadWebhookCallerProfile(
  supabase: SupabaseClient,
  userId: string,
  endpoint: string
): Promise<WebhookCallerProfile> {
  const { data, error } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('role, guild_code')
    .eq('user_id', userId)
    .eq('is_current', true)
    .single()

  if (error?.code === 'PGRST116') {
    throw Errors.userNotFound(userId)
  }

  if (error?.code === 'PGRST115') {
    logger.error(
      { endpoint, user_id: userId, error },
      'CRITICAL: Multiple is_current=true records for user'
    )
    throw Errors.database(
      'Data integrity issue: Multiple active guild memberships found. Please contact support.',
      { endpoint, user_id: userId }
    )
  }

  if (error) {
    logger.error(
      { endpoint, user_id: userId, error },
      'Failed to fetch Discord webhook caller profile'
    )
    throw Errors.database('Failed to verify user permissions', {
      endpoint,
      user_id: userId
    })
  }

  if (!data) {
    throw Errors.userNotFound(userId)
  }

  return data as WebhookCallerProfile
}
