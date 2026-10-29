/** Read-only synthetic data for explicitly declared native navigation stories.
 * This module is selected only by Storybook's resolver. Production uses the
 * real client. Unknown reads and every write are unsupported; no network or
 * credentials are used here. These fixtures qualify presentation, not auth.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'

function scene() {
  const id = new URLSearchParams(window.location.search).get('id') ?? ''
  if (!id.startsWith('navigation-mobile-nav--')) return null
  const inactive = id.endsWith('--inactive-account')
  const role = id.endsWith('--officer') ? 'officer' : 'member'
  return {
    inactive,
    role,
    userId: `example-${inactive ? 'inactive' : role}-user`
  }
}

function unsupported(): never {
  throw new Error('This Storybook data fixture does not admit that operation.')
}

function resolved<T>(data: T) {
  const result = Promise.resolve({ data, error: null, status: 200 })
  return Object.assign(result, {
    abortSignal: (_signal: AbortSignal) => result
  })
}

const client = {
  auth: {
    getUser: async () => ({
      data: { user: scene() ? { id: scene()!.userId } : null },
      error: null
    }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: unsupported
  },
  from(table: string) {
    if (table !== 'player_with_cluster') return unsupported()
    const chain = {
      select(fields: string) {
        if (
          fields !==
          'guild_code, cluster_code, role, display_name, theme_preference'
        )
          return unsupported()
        return chain
      },
      eq(key: string, value: string) {
        if (key !== 'user_id' || value !== scene()?.userId) return unsupported()
        return chain
      },
      single() {
        const current = scene()
        return resolved(
          !current || current.inactive
            ? null
            : {
                guild_code: 'EXAMPLE',
                cluster_code: null,
                role: current.role,
                display_name: 'Example Vanguard with a long display name',
                theme_preference: 'dark'
              }
        )
      }
    }
    return chain
  },
  rpc(name: string, args: Record<string, unknown>) {
    if (!scene()) return unsupported()
    if (
      name === 'get_duplicate_display_labels' &&
      Object.keys(args).length === 0
    )
      return resolved([])
    if (
      name === 'get_distinct_seasons_for_guild' &&
      args.p_guild === 'EXAMPLE'
    ) {
      return resolved(['112', '111'])
    }
    return unsupported()
  }
}

export function dbClient(): SupabaseClient<Database> {
  return client as unknown as SupabaseClient<Database>
}

export const storageClient = unsupported
export const authenticatedDbClient = unsupported
export const assertClientSession = unsupported
