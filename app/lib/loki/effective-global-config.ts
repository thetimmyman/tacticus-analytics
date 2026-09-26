import 'server-only'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { GlobalConfigShape } from './global-config-diff'

// The gzipped override in $LOKI_CONFIG_OVERRIDE_DIR wins only if it parses, has a different
// configVersion and a strictly newer extractedAt than the baked copy. Override writers must
// stamp both fields (the CDN body has neither) or the override never wins.

const BAKED_DIR = path.join(process.cwd(), 'data', 'loki-api')
export const OVERRIDE_GZ_FILENAME = 'GlobalConfig.json.gz'

interface LoadedGlobalConfig {
  raw: GlobalConfigShape
  configVersion: string
  extractedAt: string | null
  source: 'baked' | 'override'
}

export interface EffectiveGlobalConfig {
  effective: LoadedGlobalConfig | null
  baked: LoadedGlobalConfig | null
  override: LoadedGlobalConfig | null
  overrideActive: boolean
}

const parseLoaded = (
  jsonText: string,
  source: LoadedGlobalConfig['source']
): LoadedGlobalConfig => {
  const raw = JSON.parse(jsonText) as GlobalConfigShape
  return {
    raw,
    configVersion: raw.configVersion ?? '',
    extractedAt: raw.extractedAt ?? null,
    source
  }
}

const readBakedConfig = (
  dataDir: string = BAKED_DIR
): LoadedGlobalConfig | null => {
  try {
    if (!existsSync(dataDir)) return null
    const files = readdirSync(dataDir)
    const file =
      files.find((f) => f === 'GlobalConfig.json') ??
      files.find((f) => f.startsWith('GlobalConfig') && f.endsWith('.json'))
    if (!file) return null
    return parseLoaded(readFileSync(path.join(dataDir, file), 'utf8'), 'baked')
  } catch (error) {
    console.warn('[effective-global-config] failed to read baked config', {
      dataDir,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

const readOverrideConfig = (
  overrideDir: string | undefined = process.env.LOKI_CONFIG_OVERRIDE_DIR
): LoadedGlobalConfig | null => {
  if (!overrideDir) return null
  try {
    const gzPath = path.join(overrideDir, OVERRIDE_GZ_FILENAME)
    if (!existsSync(gzPath)) return null
    return parseLoaded(
      gunzipSync(readFileSync(gzPath)).toString('utf8'),
      'override'
    )
  } catch (error) {
    console.warn(
      '[effective-global-config] override unreadable — using baked',
      {
        overrideDir,
        error: error instanceof Error ? error.message : String(error)
      }
    )
    return null
  }
}

const overrideWins = (
  override: LoadedGlobalConfig | null,
  baked: LoadedGlobalConfig | null
): boolean => {
  if (!override) return false
  if (!baked) return true // nothing baked at all — any parsed override beats DEFAULT
  if (!override.configVersion || override.configVersion === baked.configVersion)
    return false
  if (!override.extractedAt) return false
  if (!baked.extractedAt) return true
  return Date.parse(override.extractedAt) > Date.parse(baked.extractedAt)
}

export const resolveEffectiveGlobalConfig = (opts?: {
  dataDir?: string
  overrideDir?: string
}): EffectiveGlobalConfig => {
  const baked = readBakedConfig(opts?.dataDir)
  const override = readOverrideConfig(
    opts && 'overrideDir' in opts
      ? opts.overrideDir
      : process.env.LOKI_CONFIG_OVERRIDE_DIR
  )
  const overrideActive = overrideWins(override, baked)
  return {
    effective: overrideActive ? override : baked,
    baked,
    override,
    overrideActive
  }
}
