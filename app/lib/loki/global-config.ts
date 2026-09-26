import 'server-only'

import { promises as fs } from 'node:fs'

import { API_REQUEST_CONFIG, API_URLS } from '@tacticus/app-core/api-constants'
import { createComponentLogger } from '@/app/lib/logging'
import { resolveEffectiveGlobalConfig } from '@/app/lib/loki/effective-global-config'
const logger = createComponentLogger('lib.loki.global-config')

import type {
  LokiGlobalConfig,
  LokiGlobalConfigSnapshot,
  LokiGuildWarLevel,
  LokiGuildWarLevelZone,
  LokiGuildWarSeasonConfig,
  LokiGuildWarZoneTier
} from '@/app/lib/loki/types'

const CACHE_TTL_MS = 15 * 60 * 1000
const GLOBAL_CONFIG_FETCH_TIMEOUT_MS = API_REQUEST_CONFIG.TIMEOUTS.SHORT
// path.join here triggers Turbopack glob warnings.
const DATA_DIR = `${process.cwd()}/data/loki-api`
const GLOBAL_CONFIG_PREFIX = 'GlobalConfig'

let cachedSnapshot: LokiGlobalConfigSnapshot | null = null
let cacheExpiry = 0

const readLocalGlobalConfig =
  async (): Promise<LokiGlobalConfigSnapshot | null> => {
    try {
      // Must honour the self-heal override too, or one pod serves two config
      // versions; the 15-min TTL cache picks up heals between restarts.
      const { effective, overrideActive } = resolveEffectiveGlobalConfig()
      if (overrideActive && effective) {
        return {
          config: effective.raw as unknown as LokiGlobalConfig,
          source: 'disk',
          fetchedAt: new Date().toISOString()
        }
      }

      const files = await fs.readdir(DATA_DIR)
      const exact = files.find(
        (file) => file === `${GLOBAL_CONFIG_PREFIX}.json`
      )

      const candidates = exact
        ? [exact]
        : files.filter(
            (file) =>
              file.startsWith(GLOBAL_CONFIG_PREFIX) && file.endsWith('.json')
          )

      if (candidates.length === 0) {
        return null
      }

      const resolved =
        candidates.length === 1
          ? candidates[0]
          : (
              await Promise.all(
                candidates.map(async (file) => ({
                  file,
                  mtime: (await fs.stat(`${DATA_DIR}/${file}`)).mtimeMs
                }))
              )
            ).sort(
              (a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file)
            )[0]?.file

      if (!resolved) {
        return null
      }

      const filePath = `${DATA_DIR}/${resolved}`
      const contents = await fs.readFile(filePath, 'utf8')
      const config = JSON.parse(contents) as LokiGlobalConfig
      return {
        config,
        source: 'disk',
        fetchedAt: new Date().toISOString()
      }
    } catch (error) {
      logger.warn(
        { error: error },
        '[LokiGlobalConfig] Failed to read local snapshot'
      )
      return null
    }
  }

const fetchRemoteGlobalConfig =
  async (): Promise<LokiGlobalConfigSnapshot | null> => {
    const url = `${API_URLS.TACTICUS.LOKI}/globalConfig`
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      GLOBAL_CONFIG_FETCH_TIMEOUT_MS
    )

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        cache: 'no-store',
        signal: controller.signal
      })

      if (!response.ok) {
        logger.warn(
          {
            tag: 'LokiGlobalConfig',
            status: response.status,
            statusText: response.statusText
          },
          'Remote fetch failed'
        )
        return null
      }

      const config = (await response.json()) as LokiGlobalConfig
      return {
        config,
        source: 'network',
        fetchedAt: new Date().toISOString()
      }
    } catch (error) {
      logger.warn({ error: error }, '[LokiGlobalConfig] Remote fetch threw')
      return null
    } finally {
      clearTimeout(timeoutId)
    }
  }

export interface GlobalConfigOptions {
  forceRefresh?: boolean
}

export const getGlobalConfigSnapshot = async (
  options?: GlobalConfigOptions
): Promise<LokiGlobalConfigSnapshot> => {
  const now = Date.now()
  if (!options?.forceRefresh && cachedSnapshot && cacheExpiry > now) {
    return cachedSnapshot
  }

  const remote = await fetchRemoteGlobalConfig()

  if (remote) {
    cachedSnapshot = remote
    cacheExpiry = now + CACHE_TTL_MS
    return remote
  }

  const local = await readLocalGlobalConfig()
  if (local) {
    cachedSnapshot = local
    cacheExpiry = now + CACHE_TTL_MS
    return local
  }

  throw new Error(
    'Unable to load LOKI global config from network or local cache'
  )
}

const getGlobalConfig = async (
  options?: GlobalConfigOptions
): Promise<LokiGlobalConfig> => {
  const snapshot = await getGlobalConfigSnapshot(options)
  return snapshot.config
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item : null))
    .filter((item): item is string => Boolean(item))
}

const normalizeGuildWarSeasons = (
  seasons: Record<string, unknown> | undefined
): LokiGuildWarSeasonConfig[] => {
  if (!seasons) return []

  return Object.entries(seasons).map(([id, value]) => {
    const season = value as Record<string, unknown>
    const scorePerZoneTypeRaw = season?.scorePerZoneType as
      Record<string, unknown> | undefined
    const scorePerZoneType: Record<string, number> = {}
    if (scorePerZoneTypeRaw) {
      Object.entries(scorePerZoneTypeRaw).forEach(([zone, amount]) => {
        const numeric = toNumberOrNull(amount)
        if (numeric !== null) {
          scorePerZoneType[zone] = numeric
        }
      })
    }

    const defaultLayout = Array.isArray(season?.defaultZoneTypeLayout)
      ? (season.defaultZoneTypeLayout as unknown[]).map((row) =>
          Array.isArray(row)
            ? row.filter((item): item is string => typeof item === 'string')
            : []
        )
      : []

    const zoneTypeConfigsRaw = season?.zoneTypeConfigs as
      Record<string, unknown> | undefined
    const zoneTypeConfigs: LokiGuildWarSeasonConfig['zoneTypeConfigs'] = {}
    if (zoneTypeConfigsRaw) {
      Object.entries(zoneTypeConfigsRaw).forEach(([zoneId, configValue]) => {
        zoneTypeConfigs[zoneId] =
          typeof configValue === 'object' && configValue !== null
            ? { ...(configValue as Record<string, unknown>) }
            : {}
      })
    }

    const rawLevels = Array.isArray(season?.levels) ? season.levels : []
    const levels: LokiGuildWarLevel[] = rawLevels
      .map((level): LokiGuildWarLevel | null => {
        const levelRecord =
          level && typeof level === 'object'
            ? (level as Record<string, unknown>)
            : {}
        const battlefieldLevel = toNumberOrNull(levelRecord.battlefieldLevel)
        if (battlefieldLevel === null) return null

        const rawZones = Array.isArray(levelRecord.zones)
          ? levelRecord.zones
          : []
        const zones: LokiGuildWarLevelZone[] = rawZones
          .map((zone): LokiGuildWarLevelZone | null => {
            const zoneRecord =
              zone && typeof zone === 'object'
                ? (zone as Record<string, unknown>)
                : {}
            const warZoneType = zoneRecord.warZoneType
            const zoneTierId = zoneRecord.zoneTierId
            if (
              typeof warZoneType !== 'string' ||
              typeof zoneTierId !== 'string'
            ) {
              return null
            }
            return {
              warZoneType,
              zoneTierId,
              raw: zone
            }
          })
          .filter((zone): zone is LokiGuildWarLevelZone => zone !== null)

        return {
          battlefieldLevel,
          minGuildPower: toNumberOrNull(levelRecord.minGuildPower),
          minOptedInPlayers: toNumberOrNull(levelRecord.minOptedInPlayers),
          zones,
          raw: level
        }
      })
      .filter((level): level is LokiGuildWarLevel => level !== null)

    const rawZoneTiers = Array.isArray(season?.zoneTiers)
      ? season.zoneTiers
      : []
    const zoneTiers: LokiGuildWarZoneTier[] = rawZoneTiers
      .map((tier): LokiGuildWarZoneTier | null => {
        const tierRecord =
          tier && typeof tier === 'object'
            ? (tier as Record<string, unknown>)
            : {}
        const zoneTierId = tierRecord.zoneTierId
        if (typeof zoneTierId !== 'string') return null

        return {
          zoneTierId,
          npcUnitId:
            typeof tierRecord.npcUnitId === 'string'
              ? tierRecord.npcUnitId
              : null,
          rarityCaps: toStringArray(tierRecord.rarityCaps),
          raw: tier
        }
      })
      .filter((tier): tier is LokiGuildWarZoneTier => tier !== null)

    return {
      id,
      maxAttempts: toNumberOrNull(season?.maxAttempts),
      activeEncounterLockedMinutes: toNumberOrNull(
        season?.activeEncounterLockedMinutes
      ),
      scorePerZoneType,
      defaultZoneTypeLayout: defaultLayout,
      zoneTypeConfigs,
      levels,
      zoneTiers,
      raw: value
    }
  })
}

export const getGuildWarSeasonConfigs = async (
  options?: GlobalConfigOptions
): Promise<LokiGuildWarSeasonConfig[]> => {
  const config = await getGlobalConfig(options)
  const raw = config.guildWar?.guildWarSeasonConfigs as
    Record<string, unknown> | undefined
  return normalizeGuildWarSeasons(raw)
}
