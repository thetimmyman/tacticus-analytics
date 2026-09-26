import { API_URLS } from './api-constants'

const DEFAULT_SITE_URL = API_URLS.APP.BASE_URL
const LOCAL_SITE_URL = 'http://localhost:3000'
const RESOLVED_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL
).trim()

const DEFAULT_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'Tacticus Analytics <support@tacticusanalytics.com>'

/**
 * Build-time NEXT_PUBLIC_CONTACT_EMAIL so no personal address lives in source;
 * when empty, pages omit the address.
 */
export const CONTACT_EMAIL = (
  process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? ''
).trim()

export const APP_ORIGINS = {
  CURRENT: RESOLVED_SITE_URL,
  PRODUCTION: DEFAULT_SITE_URL,
  LOCAL: LOCAL_SITE_URL
} as const

export const EMAIL_ADDRESSES = {
  DEFAULT_FROM: DEFAULT_FROM_EMAIL
} as const

export const DISCORD_CONSTANTS = {
  WEBHOOK_BASE: API_URLS.DISCORD.WEBHOOK_BASE,
  WEBHOOK_IDS: {
    VERSION_UPDATE:
      process.env.DISCORD_VERSION_WEBHOOK_ID || '1414978610481070252',
    DEV: process.env.DISCORD_DEV_WEBHOOK_ID || '1415046444708032554',
    GUILD_UPDATES: process.env.DISCORD_GUILD_WEBHOOK_ID || ''
  }
} as const

const DEFAULT_TACTICUS_ORIGIN = 'https://api.tacticusgame.com'
const TACTICUS_ORIGIN = (() => {
  try {
    return new URL(API_URLS.TACTICUS.BASE).origin
  } catch {
    return DEFAULT_TACTICUS_ORIGIN
  }
})()

export const TACTICUS_API = {
  BASE_URL: API_URLS.TACTICUS.BASE,
  ORIGIN: TACTICUS_ORIGIN
} as const
