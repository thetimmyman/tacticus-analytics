const TRUSTED_APP_ORIGIN_ENV_KEYS = [
  'SITE_URL',
  'NEXT_PUBLIC_SITE_URL'
] as const

function resolveTrustedAppOrigin(): string {
  for (const key of TRUSTED_APP_ORIGIN_ENV_KEYS) {
    const value = process.env[key]?.trim()
    if (!value) continue

    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid ${key}: expected http(s) URL`)
    }
    return parsed.origin
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3000'
  }

  throw new Error(
    'Missing trusted app origin: set SITE_URL or NEXT_PUBLIC_SITE_URL'
  )
}

export function buildTrustedInternalUrl(pathname: string): URL {
  return new URL(pathname, resolveTrustedAppOrigin())
}
