import 'server-only'

import { serverEnv } from '@tacticus/app-core/server-env'

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/** Rewrites public Supabase storage URLs onto the internal origin: `next/image` fetches
 * server-side and the public hostname can time out. Allowlisted in `next.config.js`. */
export const toInternalStorageUrl = (url: string): string => {
  const publicBase = stripTrailingSlash(serverEnv.NEXT_PUBLIC_SUPABASE_URL)
  const internalBase = stripTrailingSlash(serverEnv.SUPABASE_INTERNAL_URL)

  if (!publicBase || internalBase === publicBase) return url
  if (url !== publicBase && !url.startsWith(`${publicBase}/`)) return url

  return `${internalBase}${url.slice(publicBase.length)}`
}

export const toInternalStorageUrlMap = (
  urlsById: Record<string, string | null>
): Record<string, string | null> =>
  Object.fromEntries(
    Object.entries(urlsById).map(([id, url]) => [
      id,
      url === null ? null : toInternalStorageUrl(url)
    ])
  )
