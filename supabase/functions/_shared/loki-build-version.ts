import {
  decodeBase64,
  OVERRIDE_BYTES_ENV,
  OVERRIDE_DIR_ENV,
  OVERRIDE_FILENAME
} from './loki-config-override-handoff.ts'

const DEFAULT_BUILD_STRING = '1.29.21.1056'
const BUILD_CACHE_TTL_MS = 10 * 60 * 1000
const GLOBAL_CONFIG_URL =
  'https://api-live.loki.snowprintstudios.com/globalConfig'
const DEFAULT_FIRST_SEASON_START_MS = 1646128800000
const DEFAULT_SEASON_CYCLE_SECONDS = 14 * 24 * 60 * 60
const DEFAULT_SEASON_GAP_SECONDS = 24 * 60 * 60

// LOKI CONNECT rejects a stale build string, so read the in-cluster override (like the app tier), then
// upstream globalConfig, then the default. Every step fails soft. Workers cannot read the mount, so
// in the edge runtime the override arrives as env bytes from the main service.
interface BuildCache {
  value: string
  expiresAt: number
  platform: string
}

export interface LokiSeasonTimingConstants {
  firstSeasonStartMs: number
  seasonCycleSeconds: number
  seasonGapSeconds: number
  source: 'loki-globalconfig' | 'fallback'
}

let cachedBuild: BuildCache | null = null
let cachedSeasonTiming: {
  value: LokiSeasonTimingConstants
  expiresAt: number
} | null = null
let cachedOverride: { value: unknown; expiresAt: number } | null = null

const normalizePlatform = (platform: string): string[] => {
  const trimmed = platform.trim()
  return [
    trimmed,
    trimmed.toUpperCase(),
    trimmed.toLowerCase(),
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
  ]
}

const readOverrideGlobalConfig = async (): Promise<unknown | null> => {
  const now = Date.now()
  if (cachedOverride && cachedOverride.expiresAt > now) {
    return cachedOverride.value
  }

  const dir = Deno.env.get(OVERRIDE_DIR_ENV)
  const envPayload = Deno.env.get(OVERRIDE_BYTES_ENV)
  if (!envPayload && !dir) return null

  try {
    const source = envPayload ? 'env' : 'dir'
    const bytes = envPayload
      ? decodeBase64(envPayload)
      : await Deno.readFile(`${dir}/${OVERRIDE_FILENAME}`)
    const decompressed = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
    const text = await new Response(decompressed).text()
    const parsed = JSON.parse(text) as unknown
    const configVersion =
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).configVersion === 'string'
        ? (parsed as Record<string, unknown>).configVersion
        : null
    console.info('[loki-build-version] override loaded', {
      source,
      configVersion
    })
    cachedOverride = { value: parsed, expiresAt: now + BUILD_CACHE_TTL_MS }
    return parsed
  } catch (error) {
    // Best-effort source: never throw, fall through to the upstream fetch.
    console.warn('[loki-build-version] override unreadable — using upstream', {
      overrideDir: dir ?? '',
      source: envPayload ? 'env' : 'dir',
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

const extractBuildString = (data: unknown, platform: string): string | null => {
  if (!data || typeof data !== 'object') return null
  const versions =
    (data as Record<string, any>)?.general?.minRecommendedAppVersions ?? {}
  const resolved =
    normalizePlatform(platform)
      .map((key) => versions?.[key])
      .find((value) => typeof value === 'string' && value.length > 0) ?? null
  return resolved
}

export async function getRecommendedLokiBuildString(
  platform = 'Windows'
): Promise<string> {
  const now = Date.now()
  if (
    cachedBuild &&
    cachedBuild.platform === platform &&
    cachedBuild.expiresAt > now
  ) {
    return cachedBuild.value
  }

  const fromOverride = extractBuildString(
    await readOverrideGlobalConfig(),
    platform
  )
  if (fromOverride) {
    cachedBuild = {
      value: fromOverride,
      expiresAt: now + BUILD_CACHE_TTL_MS,
      platform
    }
    return fromOverride
  }

  try {
    const response = await fetch(GLOBAL_CONFIG_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`globalConfig responded with ${response.status}`)
    }

    const data = await response.json()
    const value = extractBuildString(data, platform) ?? DEFAULT_BUILD_STRING
    cachedBuild = { value, expiresAt: now + BUILD_CACHE_TTL_MS, platform }
    return value
  } catch (error) {
    console.warn(
      '[loki-build-version] Falling back to default build string:',
      error
    )
    cachedBuild = {
      value: DEFAULT_BUILD_STRING,
      expiresAt: now + BUILD_CACHE_TTL_MS,
      platform
    }
    return DEFAULT_BUILD_STRING
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const parseSeasonTimingFromGlobalConfig = (
  data: unknown
): LokiSeasonTimingConstants | null => {
  if (!data || typeof data !== 'object') return null

  const root = data as Record<string, unknown>
  const guildBoss = root.guildBoss
  if (!guildBoss || typeof guildBoss !== 'object') return null

  const misc = (guildBoss as Record<string, unknown>).misc
  if (!misc || typeof misc !== 'object') return null

  const firstSeasonStart = (misc as Record<string, unknown>).firstSeasonStart
  const seasonDuration = (misc as Record<string, unknown>).seasonDuration
  const bufferAfterSeasonEnd = (misc as Record<string, unknown>)
    .bufferAfterSeasonEnd

  if (!isFiniteNumber(firstSeasonStart) || !isFiniteNumber(seasonDuration)) {
    return null
  }

  const seasonGapSeconds = isFiniteNumber(bufferAfterSeasonEnd)
    ? bufferAfterSeasonEnd
    : DEFAULT_SEASON_GAP_SECONDS

  return {
    firstSeasonStartMs: firstSeasonStart,
    seasonCycleSeconds: seasonDuration,
    seasonGapSeconds,
    source: 'loki-globalconfig'
  }
}

export async function getLokiSeasonTimingConstants(): Promise<LokiSeasonTimingConstants> {
  const now = Date.now()
  if (cachedSeasonTiming && cachedSeasonTiming.expiresAt > now) {
    return cachedSeasonTiming.value
  }

  const fromOverride = parseSeasonTimingFromGlobalConfig(
    await readOverrideGlobalConfig()
  )
  if (fromOverride) {
    cachedSeasonTiming = {
      value: fromOverride,
      expiresAt: now + BUILD_CACHE_TTL_MS
    }
    return fromOverride
  }

  try {
    const response = await fetch(GLOBAL_CONFIG_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`globalConfig responded with ${response.status}`)
    }

    const data = await response.json()
    const parsed = parseSeasonTimingFromGlobalConfig(data)
    if (parsed) {
      cachedSeasonTiming = {
        value: parsed,
        expiresAt: now + BUILD_CACHE_TTL_MS
      }
      return parsed
    }
  } catch (error) {
    console.warn(
      '[loki-build-version] Falling back to default season timing constants:',
      error
    )
  }

  const fallback: LokiSeasonTimingConstants = {
    firstSeasonStartMs: DEFAULT_FIRST_SEASON_START_MS,
    seasonCycleSeconds: DEFAULT_SEASON_CYCLE_SECONDS,
    seasonGapSeconds: DEFAULT_SEASON_GAP_SECONDS,
    source: 'fallback'
  }
  cachedSeasonTiming = { value: fallback, expiresAt: now + BUILD_CACHE_TTL_MS }
  return fallback
}
