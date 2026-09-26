import {
  PUBLIC_LOKI_DEVICE_METADATA,
  PUBLIC_LOKI_INSTALL_ID
} from './public-device'

export function buildLokiConnectPayload(
  userId: string,
  clientSecret: string,
  buildString: string,
  createdOn = Date.now()
) {
  return {
    playerEvent: {
      playerEventType: 'CONNECT',
      playerEventData: {
        userId,
        clientSecret,
        deviceData: { ...PUBLIC_LOKI_DEVICE_METADATA, buildString }
      },
      universeVersion: 'universe_not_needed',
      gameConfigVersion: '706f74cc2d10c3547d81b89417afba20',
      createdOn: createdOn.toString(),
      multiConfigVersion: '39c33816869d9fcfdde8a53a5724c1d5'
    },
    builtInMultiConfigVersion: 'dc441f8a1b301d74ff73eeff1380e537',
    installId: PUBLIC_LOKI_INSTALL_ID
  }
}

// Probed before the recursive fallback, which matches any key containing
// "session" (e.g. sessionExpiresAt) and could persist the wrong value.
const STANDARD_SESSION_ID_PATHS: ReadonlyArray<readonly string[]> = [
  ['sessionId'],
  ['playerEvent', 'sessionId'],
  ['eventResult', 'sessionId'],
  ['eventResult', 'eventResponseData', 'sessionId'],
  ['eventResult', 'eventResponseData', 'playerEvent', 'sessionId'],
  ['eventResult', 'eventResponseData', 'userData', 'sessionId'],
  ['response', 'sessionId'],
  ['body', 'sessionId'],
  ['event', 'sessionId']
]

function readPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function findLokiSessionId(value: unknown): string | null {
  for (const path of STANDARD_SESSION_ID_PATHS) {
    const candidate = readPath(value, path)
    if (typeof candidate === 'string' && candidate.length > 10) {
      return candidate
    }
  }
  return findSessionIdRecursive(value)
}

function findSessionIdRecursive(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  for (const [key, nested] of Object.entries(value)) {
    if (
      key.toLowerCase().includes('session') &&
      typeof nested === 'string' &&
      nested.length > 10
    ) {
      return nested
    }
    const found = findSessionIdRecursive(nested)
    if (found) return found
  }
  return null
}
