import {
  getSupabaseHost,
  getSupabaseWsUrl,
  hasSupabaseCredentials
} from './supabase-env'

const hasSupabaseConfig = hasSupabaseCredentials()
const SUPABASE_HOST = hasSupabaseConfig
  ? getSupabaseHost()
  : 'placeholder.supabase.co'
const SUPABASE_ORIGIN = hasSupabaseConfig
  ? `https://${SUPABASE_HOST}`
  : 'https://placeholder.supabase.co'
const SUPABASE_WS = hasSupabaseConfig
  ? getSupabaseWsUrl()
  : 'wss://placeholder.supabase.co'
const STORAGE_BASE = `${SUPABASE_ORIGIN}/storage/v1/object/public`
const DEFAULT_TACTICUS_BASE = 'https://api.tacticusgame.com/api/v1'
const RESOLVED_TACTICUS_BASE =
  process.env.NEXT_PUBLIC_TACTICUS_API_URL || DEFAULT_TACTICUS_BASE

export const API_URLS = {
  TACTICUS: {
    BASE: RESOLVED_TACTICUS_BASE,
    LOKI: 'https://api-live.loki.snowprintstudios.com'
  },
  DISCORD: {
    CDN_AVATARS: 'https://cdn.discordapp.com/embed/avatars/0.png',
    WEBHOOK_BASE: 'https://discord.com/api/webhooks/'
  },
  APP: {
    LOGO: 'https://www.tacticusanalytics.com/images/logo-no-words.png',
    FAVICON: 'https://www.tacticusanalytics.com/favicon.svg',
    BASE_URL: 'https://www.tacticusanalytics.com'
  },
  SUPABASE: {
    URL_PATTERN: SUPABASE_ORIGIN,
    WS_PATTERN: SUPABASE_WS,
    HOST: SUPABASE_HOST
  },
  STORAGE: {
    BASE: STORAGE_BASE,
    HERO_ICONS: `${STORAGE_BASE}/hero-icons`,
    BOSS_PORTRAITS: `${STORAGE_BASE}/boss-portraits`,
    AVATARS: `${STORAGE_BASE}/avatars`
  }
} as const

/** Derives the guildchat host from the Loki host so they cannot drift: `api-x` becomes `websocket-x`. */
export function deriveGuildchatWsHost(lokiHttpHost: string): string {
  const parsed = new URL(
    lokiHttpHost.includes('://') ? lokiHttpHost : `https://${lokiHttpHost}`
  )
  const wsHost = parsed.hostname.replace(/^api-/, 'websocket-')
  return `wss://${wsHost}/`
}

/** Fallback when the daemon has no `GUILDCHAT_WS_HOST`, so no hardcoded literal is needed. */
export const LOKI_GUILDCHAT_WS_HOST = deriveGuildchatWsHost(
  API_URLS.TACTICUS.LOKI
)

export const API_REQUEST_CONFIG = {
  TIMEOUTS: {
    DEFAULT: 30000, // 30 seconds - standard API timeout
    SHORT: 15000, // 15 seconds - quick requests
    LONG: 60000, // 60 seconds - heavy operations
    AUTH: 10000 // 10 seconds - auth operations
  },
  RETRY: {
    MAX_ATTEMPTS: 3,
    DEFAULT_DELAY: 1000, // 1 second
    MAX_DELAY: 10000, // 10 seconds
    BACKOFF_MULTIPLIER: 2
  },
  BATCH: {
    SIZE: 100,
    DELAY: 100, // Delay between batches
    MAX_CONCURRENCY: 5 // Max concurrent requests
  }
} as const

export const DB_TABLES = {
  BATTLE_DATA: 'EOT_GR_data',
  PLAYER_MAPPING: 'player_mapping',
  BOSS_MAPPING: 'boss_mapping',
  GUILD_CONFIG: 'guild_config',
  BOMB_TRACKING: 'bomb_tracking',
  WEBHOOK_CONFIG: 'webhook_config',
  HERO_MAPPINGS: 'hero_mappings'
} as const

// Reference shape only; the live CSP header is built in proxy.ts. Keep in sync.
export const CSP_DOMAINS = {
  SCRIPT_SRC: [
    "'self'",
    "'unsafe-eval'" // Development only
  ],
  CONNECT_SRC: [
    "'self'",
    API_URLS.SUPABASE.URL_PATTERN,
    API_URLS.SUPABASE.WS_PATTERN,
    API_URLS.TACTICUS.BASE
  ],
  IMG_SRC: ["'self'", 'data:', 'blob:', 'https:']
} as const

export const WEBHOOK_CONFIG = {
  AVATAR_URLS: {
    DEFAULT: API_URLS.DISCORD.CDN_AVATARS,
    APP_LOGO: API_URLS.APP.LOGO,
    APP_FAVICON: API_URLS.APP.FAVICON
  },
  TIMEOUT: 10000, // 10 seconds for webhook requests
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000 // 1 second
} as const

/** Matches .supabase.co and Kong-gateway storage URLs. */
export function isStorageUrl(url: string): boolean {
  if (!url) return false
  if (url.includes('supabase.co/storage')) return true
  if (url.includes(`${SUPABASE_HOST}/storage`)) return true
  if (url.includes('/storage/v1/object')) return true
  return false
}

export function getStorageBase(): string {
  return STORAGE_BASE
}

export type ApiTimeout =
  (typeof API_REQUEST_CONFIG.TIMEOUTS)[keyof typeof API_REQUEST_CONFIG.TIMEOUTS]
export type DbTable = (typeof DB_TABLES)[keyof typeof DB_TABLES]
export type ApiUrl = (typeof API_URLS)[keyof typeof API_URLS]
