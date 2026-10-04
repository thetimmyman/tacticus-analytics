export type RuntimeProfile = 'hosted' | 'desktop'

export interface RuntimeProfileEnv {
  NEXT_PUBLIC_RUNTIME_PROFILE?: string
  SUPABASE_URL?: string
  NEXT_PUBLIC_SUPABASE_URL?: string
}

/** Unknown profiles and non-loopback desktop services fail before any fallback. */
export function getRuntimeProfile(
  env: RuntimeProfileEnv = {
    NEXT_PUBLIC_RUNTIME_PROFILE: process.env.NEXT_PUBLIC_RUNTIME_PROFILE
  }
): RuntimeProfile {
  const profile = env.NEXT_PUBLIC_RUNTIME_PROFILE || 'hosted'
  if (profile !== 'hosted' && profile !== 'desktop') {
    throw new Error('Unknown runtime profile')
  }
  return profile
}

export function requireDesktopServiceUrl(value: string | undefined): string {
  if (!value) throw new Error('Desktop service URL is required')
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Desktop service must use an explicit IPv4 loopback endpoint'
    )
  }
  return url.toString().replace(/\/$/, '')
}
