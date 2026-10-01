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
