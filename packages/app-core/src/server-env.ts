function getRequiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function getOptionalEnv(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue
}

export const serverEnv = {
  /** Browser-facing; the fixed cookie storageKey tolerates a URL mismatch. Server calls prefer the internal URL. */
  get NEXT_PUBLIC_SUPABASE_URL() {
    return getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  },
  /** Internal URL for server auth/admin clients (custom undici fetch); falls back to the public URL. */
  get SUPABASE_INTERNAL_URL() {
    return (
      getOptionalEnv('SUPABASE_URL') ||
      getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
    )
  },
  get NEXT_PUBLIC_SUPABASE_ANON_KEY() {
    return getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  },
  get DISCORD_DEV_WEBHOOK_URL() {
    return getOptionalEnv('DISCORD_DEV_WEBHOOK_URL')
  },
  /** Read-replica PostgREST URL; empty means use the primary. */
  get SUPABASE_READONLY_REST_URL() {
    return getOptionalEnv('SUPABASE_READONLY_REST_URL')
  }
}
