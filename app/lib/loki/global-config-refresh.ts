import 'server-only'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  isDiscordWebhookUrl,
  isRetryableNetworkError,
  parseAppStartLatestHash,
  type AppStartResponse,
  type GlobalConfigShape
} from '@/app/lib/loki/global-config-diff'
import { resolveEffectiveGlobalConfig } from './effective-global-config'

// GlobalConfig drift detection (IO side): compares the served config with live LOKI
// (APP_START -> hash -> CDN). Reports drift only; never writes GlobalConfig.json.

const APP_START_ENDPOINT = (userId: string) =>
  `https://api-live.loki.snowprintstudios.com/player/player2/userId/${encodeURIComponent(userId)}`

const GLOBAL_CONFIG_URL = (hash: string) =>
  `https://cdn.loki.snowprintstudios.com/config/global/GlobalConfig.${hash}.json`

const DATA_DIR = path.join(process.cwd(), 'data', 'loki-api')
const GLOBAL_CONFIG_FETCH_TIMEOUT_MS = 15000

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      GLOBAL_CONFIG_FETCH_TIMEOUT_MS
    )
    let retryDelayMs: number | null = null

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      })
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      if (i < attempts && isRetryableNetworkError(msg)) {
        retryDelayMs = Math.min(400 * 2 ** (i - 1), 2500)
      } else {
        throw err
      }
    } finally {
      clearTimeout(timeoutId)
    }

    if (retryDelayMs !== null) {
      await new Promise((r) => setTimeout(r, retryDelayMs))
    }
  }
  throw lastErr
}

export interface BakedConfig {
  configVersion: string
  extractedAt: string | null
  raw: GlobalConfigShape
  source?: 'baked' | 'override'
  bakedVersion?: string
  overrideActive?: boolean
}

// Throws when no baked config exists: a real misconfiguration worth surfacing.
function readBakedGlobalConfig(dataDir: string = DATA_DIR): BakedConfig {
  if (!existsSync(dataDir)) {
    throw new Error(`baked LOKI data dir not found: ${dataDir}`)
  }
  const files = readdirSync(dataDir)
  const file =
    files.find((f) => f === 'GlobalConfig.json') ??
    files.find((f) => f.startsWith('GlobalConfig') && f.endsWith('.json'))
  if (!file) {
    throw new Error(`no GlobalConfig*.json found in ${dataDir}`)
  }
  const raw = JSON.parse(
    readFileSync(path.join(dataDir, file), 'utf8')
  ) as GlobalConfigShape
  return {
    configVersion: raw.configVersion ?? '',
    extractedAt: raw.extractedAt ?? null,
    raw
  }
}

// The config actually served (runtime override if active, else baked). Drift must
// be measured against this, or an override that already fixed staleness keeps alerting.
export function readEffectiveGlobalConfig(
  dataDir: string = DATA_DIR
): BakedConfig {
  const { effective, baked, overrideActive } = resolveEffectiveGlobalConfig({
    dataDir
  })
  if (!effective) {
    return readBakedGlobalConfig(dataDir)
  }
  return {
    configVersion: effective.configVersion,
    extractedAt: effective.extractedAt,
    raw: effective.raw,
    source: effective.source,
    bakedVersion: baked?.configVersion ?? '',
    overrideActive
  }
}

export async function discoverLatestHash(
  userId: string,
  currentHash: string
): Promise<string> {
  const payload = {
    playerEvent: {
      playerEventType: 'APP_START',
      playerEventData: {
        appId: 'loki',
        apiVersion: '0.1',
        os: 'Linux',
        deviceType: 'server',
        deviceName: 'tacticus-analytics',
        deviceId: 'tacticus-analytics-refresh',
        locale: 'en_US',
        userId,
        appVersion: '1.21.46.689',
        universeVersion: 'universe_not_needed',
        installId: 'tacticus-analytics-installid',
        platform: 'Linux',
        store: 'Server',
        countryCode: 'US'
      },
      universeVersion: 'universe_not_needed',
      gameConfigVersion: currentHash,
      createdOn: String(Date.now()),
      multiConfigVersion: 'e9aad1344fd7284448d52cedcea18251'
    },
    builtInMultiConfigVersion: '08407f913a5f030d1cca80f604e46f0d',
    installId: 'tacticus-analytics-installid'
  }

  const resp = await fetchWithRetry(APP_START_ENDPOINT(userId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'tacticus-analytics/refresh-global-config'
    },
    body: JSON.stringify(payload),
    cache: 'no-store'
  })
  const text = await resp.text()
  // Never echo the upstream body: APP_START responses carry userId/sessionId.
  if (!resp.ok) {
    throw new Error(`APP_START returned HTTP ${resp.status}`)
  }
  let data: AppStartResponse
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('APP_START response was not JSON')
  }
  return parseAppStartLatestHash(data, currentHash)
}

export async function fetchGlobalConfig(
  hash: string
): Promise<GlobalConfigShape> {
  if (!/^[0-9a-f]{32}$/i.test(hash)) {
    throw new Error('Invalid GlobalConfig version hash')
  }
  const resp = await fetchWithRetry(GLOBAL_CONFIG_URL(hash), {
    headers: { 'User-Agent': 'tacticus-analytics/refresh-global-config' },
    cache: 'no-store'
  })
  if (!resp.ok) {
    throw new Error(`GlobalConfig.${hash}.json returned HTTP ${resp.status}`)
  }
  return (await resp.json()) as GlobalConfigShape
}

export interface WebhookResult {
  ok: boolean
  detail?: string
}

// `cache: 'no-store'` is required: Next.js fetch caching mishandles Discord's 204 and fails the post.
export async function postDiscordWebhook(
  url: string,
  content: string
): Promise<WebhookResult> {
  if (!isDiscordWebhookUrl(url))
    return { ok: false, detail: 'not a Discord webhook URL' }
  try {
    const resp = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      cache: 'no-store'
    })
    if (resp.ok) return { ok: true }
    const body = await resp.text().catch(() => '')
    return {
      ok: false,
      detail: `Discord HTTP ${resp.status}${body ? `: ${body.slice(0, 150)}` : ''}`
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
