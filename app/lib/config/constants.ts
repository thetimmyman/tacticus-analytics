import { APP_ORIGINS } from '@tacticus/app-core/app-config'

export const CACHE_CONFIG = {
  STALE_TIME: {
    DEFAULT: 15 * 60 * 1000,
    STATIC_DATA: 24 * 60 * 60 * 1000, // e.g. hero mappings
    SEASON_DATA: 6 * 60 * 60 * 1000,
    SHORT: 2 * 60 * 1000,
    MEDIUM: 10 * 60 * 1000
  },

  MAX_SIZE: {
    DEFAULT: 100,
    LARGE: 200,
    EXTRA_LARGE: 300,
    CALCULATION: 1000,
    SMALL: 50
  },

  TTL: {
    DEFAULT: 10 * 60 * 1000,
    SHORT: 5 * 60 * 1000,
    LONG: 30 * 60 * 1000
  }
} as const

export const RATE_LIMIT = {
  API: {
    DEFAULT: 60, // per minute
    AUTH: 5, // per 5 minutes
    PUBLIC: 30 // per minute
  },
  WINDOW: {
    DEFAULT: 60 * 1000,
    AUTH: 5 * 60 * 1000
  }
} as const

export const AUTH_CONFIG = {
  SESSION: {
    MAX_AGE: 60 * 60 * 24 * 7
  },
  LIMITS: {
    MAX_PLAYERS_PER_GUILD: 30
  }
} as const

export const PERFORMANCE = {
  THRESHOLDS: {
    SLOW_RENDER: 100,
    SLOW_OPERATION: 500
  }
} as const

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BACKOFF: {
    INITIAL: 1000,
    MULTIPLIER: 2,
    MAX: 10000
  }
} as const

export const TOKEN_CONFIG = {
  MAX_TOKENS: 3,
  REGENERATION_HOURS: 12,
  MAX_PER_SEASON: 29,
  OFFENDER_THRESHOLD: 10,
  ABUSER_THRESHOLD: 15
} as const

export const BOSS_CONFIG = {
  MIN_TIER_FOR_STATS: 4, // L4 and L5 bosses only
  MIN_TOKENS_NEEDED: 3,
  DEFAULT_PRIMARY_TOKEN_VALUE: 3,
  DEFAULT_SECONDARY_TOKEN_VALUE: 2
} as const

export const DATABASE_CONFIG = {
  BATCH_SIZE: 100,
  TIMEOUT: 30000,
  CONNECTION_POOL: {
    MIN: 2,
    MAX: 10
  }
} as const

export const UI_CONFIG = {
  ITEMS_PER_PAGE: 20,
  MAX_TOAST_DURATION: 5000,
  DEBOUNCE_DELAY: 300,
  ANIMATION_DURATION: 200,
  NOTIFICATION_TIMEOUT: 3000,
  API_POLLING_INTERVAL: 3000,
  MODAL_CLOSE_DELAY: 100
} as const

export const SITE_CONFIG = {
  URL: APP_ORIGINS.CURRENT,
  get CLEAN_URL() {
    return this.URL.replace(/\n|\r/g, '')
  }
} as const

export const FEATURES = {
  DEBUG_MODE: process.env.NEXT_PUBLIC_DEBUG === 'true',
  ENABLE_ANALYTICS: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true',
  ENABLE_ERROR_REPORTING:
    process.env.NEXT_PUBLIC_ENABLE_ERROR_REPORTING === 'true'
} as const
