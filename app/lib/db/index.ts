/** All database access goes through `db()` (user session) or `serviceDb()` (service role). */

import { createClient, createServiceClient } from '@/app/lib/auth/server'

import { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger, logError } from '@/app/lib/logging'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

const logger = createComponentLogger('database')

export async function db(): Promise<TypedSupabaseClient> {
  try {
    const supabase = await createClient()
    return supabase as TypedSupabaseClient
  } catch (error) {
    logError(logger, error, 'Database connection error')
    throw new Error('Failed to connect to database')
  }
}

declare const serviceRole: unique symbol
export type ServiceSupabaseClient = TypedSupabaseClient & {
  readonly [serviceRole]: true
}

/** RLS bypass. Use this, not createServiceClient(), so bypass paths stay behind one import. */
export function serviceDb(signal?: AbortSignal): ServiceSupabaseClient {
  try {
    return createServiceClient(signal) as ServiceSupabaseClient
  } catch (error) {
    logError(logger, error, 'Service database connection error')
    throw new Error('Failed to connect to database (service role)')
  }
}

export const query = {
  async fetch<T>(
    queryFn: (
      client: TypedSupabaseClient
    ) => Promise<{ data: T | null; error: Error | null }>
  ): Promise<T> {
    const supabase = await db()
    const { data, error } = await queryFn(supabase)

    if (error) {
      logError(logger, error, 'Database query failed')
      throw new Error(`Database query failed: ${error.message}`)
    }

    if (!data) {
      throw new Error('No data returned from query')
    }

    return data
  },

  async mutate<T>(
    mutateFn: (
      client: TypedSupabaseClient
    ) => Promise<{ data: T | null; error: Error | null }>
  ): Promise<T> {
    const supabase = await db()
    const { data, error } = await mutateFn(supabase)

    if (error) {
      logError(logger, error, 'Database mutation failed')
      throw new Error(`Database mutation failed: ${error.message}`)
    }

    return data as T
  }
}

export const patterns = {
  async getCurrentUser() {
    const supabase = await db()
    const {
      data: { user },
      error
    } = await supabase.auth.getUser()

    if (error || !user) {
      throw new Error('User not authenticated')
    }

    return user
  },

  async getUserGuild(userId: string) {
    return query.fetch(async (supabase) =>
      supabase
        .from(CURRENT_USER_PLAYER_MAPPING)
        .select(
          'display_name, guild_code, role, user_id, is_current, theme_preference, primary_boss, secondary_boss'
        )
        .eq('user_id', userId)
        .eq('is_current', true)
        .single()
    )
  }
}

export type Database = TypedSupabaseClient
export type DbError = { message: string; code?: string }

export { writeQueue } from './write-queue'
