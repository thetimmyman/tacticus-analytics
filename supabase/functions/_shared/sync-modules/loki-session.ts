import { getErrorMessage } from './helpers.ts'
import { getRecommendedLokiBuildString } from '../loki-build-version.ts'
import {
  PUBLIC_LOKI_DEVICE_METADATA,
  PUBLIC_LOKI_DEVICE_ID,
  PUBLIC_LOKI_INSTALL_ID
} from '../loki-public-device.ts'

export interface LokiConnectResult {
  sessionId: string | null
  error?: string
  attempts?: number
}

const MAX_REFRESH_RETRIES = 3
const RETRY_DELAY_MS = 1000

const LOKI_CONFIG = {
  appVersion: '1.34.49.1617',
  gameConfigVersion: '4e661fec785ba22d843a34a23cb4d229',
  multiConfigVersion: '8a6a0c96de8e65d9a922d24fd75aaee7',
  builtInMultiConfigVersion: 'ae0c1c2e72cbb76a0165dfd19931e5fc',
  installId: PUBLIC_LOKI_INSTALL_ID,
  deviceId: PUBLIC_LOKI_DEVICE_ID
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function attemptLokiConnect(
  userId: string,
  clientSecret: string,
  timeoutSignal?: AbortSignal
): Promise<{
  success: boolean
  sessionId?: string
  status?: number
  error?: string
}> {
  const url = `https://api-live.loki.snowprintstudios.com/player/player2/userId/${userId}`

  // LOKI can reject a stale build on CONNECT; falls back to LOKI_CONFIG.appVersion.
  const buildString = await getRecommendedLokiBuildString('Windows').catch(
    () => LOKI_CONFIG.appVersion
  )

  const payload = {
    playerEvent: {
      playerEventType: 'CONNECT',
      playerEventData: {
        userId,
        clientSecret,
        deviceData: {
          ...PUBLIC_LOKI_DEVICE_METADATA,
          buildString
        }
      },
      universeVersion: 'universe_not_needed',
      gameConfigVersion: LOKI_CONFIG.gameConfigVersion,
      createdOn: Date.now().toString(),
      multiConfigVersion: LOKI_CONFIG.multiConfigVersion
    },
    builtInMultiConfigVersion: LOKI_CONFIG.builtInMultiConfigVersion,
    installId: LOKI_CONFIG.installId
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'User-Agent':
          'UnityPlayer/2022.3.40f1 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)',
        'X-Unity-Version': '2022.3.40f1'
      },
      body: JSON.stringify(payload),
      signal: timeoutSignal
    })

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'Could not read error body')
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}: ${errorText}`
      }
    }

    const data = await response.json()
    const newSessionId =
      data?.eventResult?.eventResponseData?.userData?.sessionId
    if (typeof newSessionId === 'string' && newSessionId) {
      return { success: true, sessionId: newSessionId }
    }

    return { success: false, error: 'No sessionId in LOKI CONNECT response' }
  } catch (error) {
    const errMsg = getErrorMessage(error)
    const isRetryable =
      errMsg.includes('ECONNRESET') ||
      errMsg.includes('ETIMEDOUT') ||
      errMsg.includes('ENOTFOUND') ||
      errMsg.includes('fetch failed') ||
      errMsg.includes('network')
    return { success: false, error: errMsg, status: isRetryable ? 503 : 500 }
  }
}

export async function refreshLokiSession(
  userId: string,
  clientSecret: string,
  timeoutSignal?: AbortSignal
): Promise<LokiConnectResult> {
  if (!clientSecret) {
    return {
      sessionId: null,
      error: 'clientSecret is required for LOKI CONNECT',
      attempts: 0
    }
  }

  let lastError = ''
  let attempts = 0

  try {
    for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
      attempts = attempt
      const result = await attemptLokiConnect(
        userId,
        clientSecret,
        timeoutSignal
      )

      if (result.success && result.sessionId) {
        return { sessionId: result.sessionId, attempts }
      }

      lastError = result.error || 'Unknown error'

      if (result.status === 401 || result.status === 403) {
        return {
          sessionId: null,
          error: `Auth failed (${result.status}): ${lastError}`,
          attempts
        }
      }

      if (attempt < MAX_REFRESH_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1)
        await sleep(delay)
      }
    }

    return {
      sessionId: null,
      error: `Failed after ${attempts} attempts: ${lastError}`,
      attempts
    }
  } catch (error) {
    return { sessionId: null, error: getErrorMessage(error), attempts }
  }
}
