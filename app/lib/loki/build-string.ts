import 'server-only'

import { API_REQUEST_CONFIG, API_URLS } from '@tacticus/app-core/api-constants'
import { createComponentLogger } from '@/app/lib/logging'
import { withResponseBodyTimeout } from '@/app/lib/utils/async-timeout'
const logger = createComponentLogger('lib.loki.build-string')

const DEFAULT_LOKI_BUILD_STRING = '1.29.21.1056'
const GLOBAL_CONFIG_FETCH_TIMEOUT_MS = API_REQUEST_CONFIG.TIMEOUTS.SHORT

interface VersionCache {
  versions: Record<string, string> | null
  expiresAt: number
}

let versionCache: VersionCache | null = null
const VERSION_CACHE_TTL_MS = 15 * 60 * 1000

const fetchGlobalConfig = async (url: string): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    GLOBAL_CONFIG_FETCH_TIMEOUT_MS
  )

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    })
    return withResponseBodyTimeout(
      response,
      GLOBAL_CONFIG_FETCH_TIMEOUT_MS,
      'LOKI build globalConfig response',
      { onTimeout: () => controller.abort() }
    )
  } finally {
    clearTimeout(timeoutId)
  }
}

const fetchRecommendedVersions = async (
  forceRefresh = false
): Promise<Record<string, string> | null> => {
  const now = Date.now()
  if (!forceRefresh && versionCache && versionCache.expiresAt > now) {
    return versionCache.versions
  }

  try {
    const url = `${API_URLS.TACTICUS.LOKI}/globalConfig`
    const response = await fetchGlobalConfig(url)

    if (!response.ok) {
      logger.warn(
        { data: response.status },
        '[LokiBuildString] Failed to fetch globalConfig'
      )
      return versionCache?.versions ?? null
    }

    const config = await response.json()
    const versions = config?.general?.minRecommendedAppVersions as
      Record<string, string> | undefined
    const result =
      versions && Object.keys(versions).length > 0 ? versions : null

    versionCache = { versions: result, expiresAt: now + VERSION_CACHE_TTL_MS }
    return result
  } catch (error) {
    logger.warn({ error: error }, '[LokiBuildString] Failed to fetch versions')
    return versionCache?.versions ?? null
  }
}

const getRecommendedBuildStringEdge = async (
  platform: string,
  forceRefresh = false
): Promise<string | null> => {
  const versions = await fetchRecommendedVersions(forceRefresh)
  if (!versions) return null

  const direct = versions[platform]
  if (direct) return direct

  const normalizedKey = platform.charAt(0).toUpperCase() + platform.slice(1)
  return versions[normalizedKey] ?? null
}
const BUILD_STRING_TTL_MS = 10 * 60 * 1000

interface BuildCache {
  value: string
  expiresAt: number
  platform: string
}

let cachedBuild: BuildCache | null = null

interface ResolveOptions {
  forceRefresh?: boolean
}

export const resolveLokiBuildString = async (
  platform = 'Windows',
  options?: ResolveOptions
): Promise<string> => {
  const now = Date.now()
  const forceRefresh = options?.forceRefresh ?? false

  if (
    !forceRefresh &&
    cachedBuild &&
    cachedBuild.platform === platform &&
    cachedBuild.expiresAt > now
  ) {
    return cachedBuild.value
  }

  try {
    const recommended = await getRecommendedBuildStringEdge(
      platform,
      forceRefresh
    )
    const value = recommended ?? DEFAULT_LOKI_BUILD_STRING
    cachedBuild = {
      value,
      expiresAt: now + BUILD_STRING_TTL_MS,
      platform
    }
    return value
  } catch (error) {
    logger.warn(
      { tag: 'LokiBuildString', err: error },
      'Failed to resolve recommended buildString'
    )
    const fallback = DEFAULT_LOKI_BUILD_STRING
    cachedBuild = {
      value: fallback,
      expiresAt: now + BUILD_STRING_TTL_MS,
      platform
    }
    return fallback
  }
}
