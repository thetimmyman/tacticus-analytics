import 'server-only'

import type { Database, TypedSupabaseClient } from '@tacticus/app-core/types'
import { resolveLokiIdentity } from './identity'
import {
  createLokiClient,
  type LokiClient,
  type LokiClientOptions
} from './client'

export type GuildLokiCredentialRow = Pick<
  Database['public']['Tables']['guild_config']['Row'],
  'user_id' | 'session_id'
>

export interface CreateGuildLokiClientOptions {
  credentialRow?: GuildLokiCredentialRow | null
  fetchImpl?: typeof fetch
  retryAttempts?: number
}

/** Persists refreshed sessions; null when no guild or env credentials are usable. */
export async function createGuildLokiClient(
  supabase: TypedSupabaseClient,
  guildCode: string,
  options: CreateGuildLokiClientOptions = {}
): Promise<LokiClient | null> {
  let credentialRow = options.credentialRow

  if (credentialRow === undefined) {
    const { data } = await supabase
      .from('guild_config')
      .select('user_id, session_id')
      .eq('guild_code', guildCode)
      .maybeSingle()
    credentialRow = data
  }

  const identity = resolveLokiIdentity(credentialRow)
  const userId = identity.userId
  const clientSecret = process.env.LOKI_SCRAPER_CLIENT_SECRET
  if (!userId || !clientSecret) return null

  const clientOptions: LokiClientOptions = {
    retryAttempts: options.retryAttempts ?? 0,
    fetchImpl: options.fetchImpl,
    onSessionUpdate: async (info) => {
      await supabase
        .from('guild_config')
        .update({
          session_id: info.sessionId,
          updated_at: new Date().toISOString()
        })
        .eq('guild_code', guildCode)
    }
  }

  return createLokiClient(
    {
      userId,
      sessionId: identity.sessionId || null,
      clientSecret
    },
    clientOptions
  )
}
