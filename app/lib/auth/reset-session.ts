import { authConfig } from './config'

export const AUTH_RESET_COOKIE = 'auth-reset-version'
export const AUTH_RESET_VERSION =
  process.env.NEXT_PUBLIC_AUTH_RESET_VERSION || '2026-01-24'
export const AUTH_RESET_MAX_AGE = 60 * 60 * 24 * 365
const AUTH_COOKIE_CHUNK_COUNT = 10

const resolveProjectRef = (): string | null => {
  const rawUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  if (!rawUrl) return 'api'

  try {
    const host = new URL(rawUrl).host
    const [subdomain] = host.split('.')
    return subdomain || 'api'
  } catch {
    return 'api'
  }
}

const projectRef = resolveProjectRef()

export const getAuthCookieNames = (): string[] => {
  const names = new Set<string>()
  const storageKey = authConfig.session.storageKey

  names.add(storageKey)
  for (let i = 0; i < AUTH_COOKIE_CHUNK_COUNT; i += 1) {
    names.add(`${storageKey}.${i}`)
  }

  names.add('sb-access-token')
  names.add('sb-refresh-token')
  names.add('sb-code-verifier')

  if (projectRef) {
    names.add(`sb-${projectRef}-auth-token`)
    for (let i = 0; i < AUTH_COOKIE_CHUNK_COUNT; i += 1) {
      names.add(`sb-${projectRef}-auth-token.${i}`)
    }
  }

  return Array.from(names)
}
