import {
  getRuntimeProfile,
  requireDesktopServiceUrl
} from '@tacticus/app-core/runtime-profile'

export interface ProxySupabaseUrlEnv {
  NEXT_PUBLIC_RUNTIME_PROFILE?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
  SUPABASE_URL?: string
}

export interface ProxySupabaseUrls {
  publicSupabaseUrl: string
  authSupabaseUrl: string
  httpSupabaseOrigin: string
  wsSupabaseOrigin: string
}

const DEFAULT_PUBLIC_SUPABASE_URL = 'https://api.tacticusanalytics.com'

function resolveBrowserOrigins(publicSupabaseUrl: string): {
  httpSupabaseOrigin: string
  wsSupabaseOrigin: string
} {
  try {
    const url = new URL(publicSupabaseUrl)
    const wsProtocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
    return {
      httpSupabaseOrigin: url.origin,
      wsSupabaseOrigin: `${wsProtocol}//${url.host}`
    }
  } catch {
    return {
      httpSupabaseOrigin: DEFAULT_PUBLIC_SUPABASE_URL,
      wsSupabaseOrigin: 'wss://api.tacticusanalytics.com'
    }
  }
}

export function resolveProxySupabaseUrls(
  env: ProxySupabaseUrlEnv = process.env as ProxySupabaseUrlEnv
): ProxySupabaseUrls {
  const desktop = getRuntimeProfile(env) === 'desktop'
  const publicSupabaseUrl = desktop
    ? requireDesktopServiceUrl(env.NEXT_PUBLIC_SUPABASE_URL)
    : env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_PUBLIC_SUPABASE_URL
  const authSupabaseUrl = desktop
    ? requireDesktopServiceUrl(env.SUPABASE_URL)
    : env.SUPABASE_URL || publicSupabaseUrl
  const { httpSupabaseOrigin, wsSupabaseOrigin } =
    resolveBrowserOrigins(publicSupabaseUrl)

  return {
    publicSupabaseUrl,
    authSupabaseUrl,
    httpSupabaseOrigin,
    wsSupabaseOrigin
  }
}
