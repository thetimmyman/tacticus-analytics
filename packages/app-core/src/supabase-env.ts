const FALLBACK_SUPABASE_URL = 'https://placeholder.supabase.co'
const FALLBACK_SUPABASE_HOST = new URL(FALLBACK_SUPABASE_URL).host

const getEnv = (keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key]
    if (value) return value
  }
  return undefined
}

const rawSupabaseUrl =
  getEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'Supabase_URL']) ||
  FALLBACK_SUPABASE_URL

const resolveHost = (url: string): string => {
  try {
    const parsed = new URL(url)
    return parsed.host || FALLBACK_SUPABASE_HOST
  } catch {
    return FALLBACK_SUPABASE_HOST
  }
}

const supabaseHost = resolveHost(rawSupabaseUrl)
const supabaseWsUrl = `wss://${supabaseHost}`
const hasSupabaseConfig = Boolean(
  getEnv(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'])
)

export const SUPABASE_URL = rawSupabaseUrl
export const SUPABASE_HOST = supabaseHost
export const SUPABASE_WS_URL = supabaseWsUrl
export const HAS_SUPABASE_CONFIG = hasSupabaseConfig

export function getSupabaseUrl(): string {
  return SUPABASE_URL
}

export function getSupabaseHost(): string {
  return SUPABASE_HOST
}

export function getSupabaseWsUrl(): string {
  return SUPABASE_WS_URL
}

export function hasSupabaseCredentials(): boolean {
  return HAS_SUPABASE_CONFIG
}

export function getSupabaseServiceRoleKey(): string | undefined {
  return getEnv([
    'SUPABASE_SERVICE_ROLE_KEY',
    'Supabase_Service_Role_Key',
    'Secret_key'
  ])
}

export function getSupabaseAnonKey(): string | undefined {
  return getEnv(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase_Anon_Key'])
}

export function getSupabaseProjectRef(): string {
  const host = getSupabaseHost()
  return host.split('.')[0] || 'placeholder'
}
