import { decryptApiKey } from './encryption'
import { legacyConsoleLogger as logger } from './logger'
import { API_URLS } from './api-constants'

const TACTICUS_API = API_URLS.TACTICUS.BASE

const INVALID_PATTERNS = ['[object Promise]', 'Promise {']
const MIN_SEGMENT_LENGTH = 16

export function isMalformedEncryptedKey(
  value: string | null | undefined
): boolean {
  if (!value) return false
  if (INVALID_PATTERNS.some((pattern) => value.includes(pattern))) return true

  const segments = value.split(':')
  if (segments.length < 2 || segments.length > 3) return true

  return segments.some(
    (segment) =>
      segment.length < MIN_SEGMENT_LENGTH || !/^[0-9a-f]+$/i.test(segment)
  )
}

export async function isDecryptableEncryptedKey(
  value: string | null | undefined
): Promise<boolean> {
  if (!value || isMalformedEncryptedKey(value)) return false
  try {
    await decryptApiKey(value)
    return true
  } catch {
    return false
  }
}

export function classifyEncryptedKey(
  value: string | null | undefined
): 'missing' | 'malformed' | 'decryptable' | 'decrypt_failed' {
  if (!value) return 'missing'
  if (isMalformedEncryptedKey(value)) return 'malformed'
  return 'decryptable'
}

const TACTICUS_RETRY_DELAY_MS = 2000
const TACTICUS_MAX_RETRIES = 2

/** GET with retry on 5xx only; explicit GET because a POST returns 500 from Tacticus. */
async function fetchTacticusWithRetry(
  url: string,
  apiKey: string
): Promise<Response> {
  let lastResponse: Response | null = null

  for (let attempt = 0; attempt <= TACTICUS_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      logger.info(
        `[API-KEY-VALIDATION] Retrying ${url} (attempt ${attempt + 1}/${TACTICUS_MAX_RETRIES + 1}) after ${TACTICUS_RETRY_DELAY_MS}ms...`
      )
      await new Promise((resolve) =>
        setTimeout(resolve, TACTICUS_RETRY_DELAY_MS)
      )
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(30000)
    })

    if (response.status < 500) {
      return response
    }

    logger.warn(
      `[API-KEY-VALIDATION] ${url} returned ${response.status} (attempt ${attempt + 1}/${TACTICUS_MAX_RETRIES + 1})`
    )
    lastResponse = response
  }

  return lastResponse!
}

export interface ApiKeyValidationResult {
  isValid: boolean
  canAccessGuild: boolean
  canAccessRaidData: boolean
  guildInfo?: {
    guildId?: string
    guildName?: string
    guildCode?: string
  }
  error?: string
  statusCode?: number
}

/** Player keys need guild access; guild management keys need guild and raid access. */
interface ValidateApiKeyOptions {
  skipFormatValidation?: boolean
}

export async function validateApiKeyWithTacticus(
  apiKey: string,
  isPlayerKey: boolean = false,
  options: ValidateApiKeyOptions = {}
): Promise<ApiKeyValidationResult> {
  const { skipFormatValidation = false } = options
  if (!apiKey || typeof apiKey !== 'string') {
    return {
      isValid: false,
      canAccessGuild: false,
      canAccessRaidData: false,
      error: 'Invalid API key format'
    }
  }

  const trimmedKey = apiKey.trim()

  if (!skipFormatValidation) {
    if (trimmedKey.length < 20 || trimmedKey.length > 100) {
      return {
        isValid: false,
        canAccessGuild: false,
        canAccessRaidData: false,
        error:
          'API key appears to be malformed - please check you copied the entire key'
      }
    }
  }

  const result: ApiKeyValidationResult = {
    isValid: false,
    canAccessGuild: false,
    canAccessRaidData: false
  }

  try {
    if (isPlayerKey) {
      logger.debug(
        '[API-KEY-VALIDATION] Testing player endpoint for player API key...'
      )

      const playerResponse = await fetchTacticusWithRetry(
        `${TACTICUS_API}/player`,
        trimmedKey
      )

      if (playerResponse.status === 401 || playerResponse.status === 403) {
        result.error =
          'Player API key is invalid or expired (401/403 Unauthorized)'
        result.statusCode = playerResponse.status
        return result
      }

      if (playerResponse.ok) {
        result.canAccessGuild = true // Mark as can access for compatibility
        result.isValid = true

        try {
          const playerData = await playerResponse.json()
          result.guildInfo = {
            guildId: playerData?.guild?.guildId,
            guildName: playerData?.guild?.name,
            guildCode: playerData?.guild?.guildCode
          }
        } catch (parseError) {
          logger.warn(
            '[API-KEY-VALIDATION] Could not parse player response, but API key appears valid'
          )
        }
      } else if (playerResponse.status === 404) {
        // Tacticus 404: the key authenticated but the player has no data yet; still valid.
        result.canAccessGuild = true
        result.isValid = true
        logger.info(
          '[API-KEY-VALIDATION] Player endpoint returned 404 - player may not have data but key appears valid'
        )
      } else if (playerResponse.status >= 500) {
        result.error = `Tacticus API server error (${playerResponse.status}) - please try again later`
        result.statusCode = playerResponse.status
        return result
      } else {
        result.error = `Unexpected response from player endpoint: ${playerResponse.status}`
        result.statusCode = playerResponse.status
        return result
      }
    } else {
      logger.debug(
        '[API-KEY-VALIDATION] Testing guild endpoint for guild API key...'
      )

      const guildResponse = await fetchTacticusWithRetry(
        `${TACTICUS_API}/guild`,
        trimmedKey
      )

      if (guildResponse.status === 401 || guildResponse.status === 403) {
        logger.debug(
          '[API-KEY-VALIDATION] Guild endpoint rejected key, checking if it is a player key...'
        )
        try {
          const playerProbe = await fetchTacticusWithRetry(
            `${TACTICUS_API}/player`,
            trimmedKey
          )
          if (playerProbe.ok) {
            result.error =
              'This appears to be a Player API key. The Guild API Key field requires a key with Guild + Guild Raid read permissions. Go to https://api.tacticusgame.com/ and create a new key with "Guild" and "Guild Raid" scopes selected.'
            result.statusCode = guildResponse.status
            return result
          }
        } catch {
          // Player probe failed; fall through to the generic error.
        }

        result.error =
          'Guild API key is invalid or expired (401/403 Unauthorized)'
        result.statusCode = guildResponse.status
        return result
      }

      if (guildResponse.ok) {
        result.canAccessGuild = true

        try {
          const guildData = await guildResponse.json()
          result.guildInfo = {
            guildId: guildData?.guild?.guildId || guildData?.guildId,
            guildName: guildData?.guild?.name || guildData?.name,
            // Tacticus returns guildTag, not guildCode.
            guildCode:
              guildData?.guild?.guildTag ||
              guildData?.guildTag ||
              guildData?.guild?.guildCode ||
              guildData?.guildCode
          }
        } catch (parseError) {
          logger.warn(
            '[API-KEY-VALIDATION] Could not parse guild response, but API key appears valid'
          )
        }
      } else if (guildResponse.status === 404) {
        // Tacticus 404: authenticated with guild scope, but no active guild data.
        result.canAccessGuild = true
        logger.info(
          '[API-KEY-VALIDATION] Guild endpoint returned 404 - no active guild but key may be valid'
        )
      } else if (guildResponse.status >= 500) {
        result.error = `Tacticus API server error (${guildResponse.status}) - please try again later`
        result.statusCode = guildResponse.status
        return result
      } else {
        result.error = `Unexpected response from guild endpoint: ${guildResponse.status}`
        result.statusCode = guildResponse.status
        return result
      }

      logger.debug('[API-KEY-VALIDATION] Testing guild raid endpoint...')

      const raidResponse = await fetchTacticusWithRetry(
        `${TACTICUS_API}/guildRaid`,
        trimmedKey
      )

      if (raidResponse.status === 401 || raidResponse.status === 403) {
        result.error =
          'API key lacks Guild Raid permissions - please generate a new key with both Guild and Guild Raid permissions'
        result.statusCode = raidResponse.status
        return result
      }

      if (raidResponse.ok) {
        result.canAccessRaidData = true
      } else if (raidResponse.status === 404) {
        // Tacticus 404: raid scope granted, just no current raid.
        result.canAccessRaidData = true
        logger.info(
          '[API-KEY-VALIDATION] Raid endpoint returned 404 - no active raid but key appears valid'
        )
      } else if (raidResponse.status >= 500) {
        result.error = `Tacticus API server error on raid endpoint (${raidResponse.status}) - please try again later`
        result.statusCode = raidResponse.status
        return result
      } else {
        result.error = `Unexpected response from raid endpoint: ${raidResponse.status}`
        result.statusCode = raidResponse.status
        return result
      }

      result.isValid = result.canAccessGuild && result.canAccessRaidData
    }

    logger.info('[API-KEY-VALIDATION] API key validation result:', {
      isValid: result.isValid,
      canAccessGuild: result.canAccessGuild,
      canAccessRaidData: result.canAccessRaidData,
      guildId: result.guildInfo?.guildId,
      guildName: result.guildInfo?.guildName
    })

    return result
  } catch (error: any) {
    logger.error('[API-KEY-VALIDATION] Validation failed with error:', error)

    if (error.name === 'AbortError') {
      result.error =
        'Request timed out - Tacticus API may be slow or unavailable'
      result.statusCode = 408
    } else if (
      error.message?.includes('fetch') ||
      error.message?.includes('network')
    ) {
      result.error = 'Network error - unable to connect to Tacticus API'
      result.statusCode = 503
    } else {
      result.error = `Validation failed: ${error.message}`
      result.statusCode = 500
    }

    return result
  }
}

export function generateApiKeyUpdatePayload(
  encryptedApiKey: string,
  validationResult: ApiKeyValidationResult,
  apiOwner?: string
) {
  const timestamp = new Date().toISOString()

  const basePayload = {
    api_key_encrypted: encryptedApiKey,
    API_Owner: apiOwner || null,
    api_key_last_validated: timestamp,
    updated_at: timestamp
  }

  if (validationResult.isValid) {
    logger.info(
      '[API-KEY-VALIDATION] Generating payload for VALID API key - enabling sync'
    )

    return {
      ...basePayload,
      api_key_is_valid: true,
      api_key_migration_status: 'completed',

      auto_sync_enabled: true, // ✓ Re-enable automatic sync
      consecutive_sync_failures: 0, // ✓ Reset failure counter

      // Leave last_successful_sync alone.
      last_sync_attempt: null // Clear previous failed attempts
    }
  } else {
    // Disable sync on an invalid key to prevent error spam.
    logger.warn(
      '[API-KEY-VALIDATION] Generating payload for INVALID API key - disabling sync'
    )

    return {
      ...basePayload,
      api_key_is_valid: false,
      api_key_migration_status: 'failed',

      auto_sync_enabled: false, // ✗ Disable automatic sync
      consecutive_sync_failures: 999, // ✗ Set high failure count to prevent retries

      last_sync_attempt: timestamp // Record when this validation failed
    }
  }
}

export function logApiKeyOperation(
  operation: 'update' | 'validate' | 'test',
  guildCode: string,
  result: ApiKeyValidationResult,
  userId?: string
) {
  const logData = {
    operation,
    guildCode,
    userId,
    isValid: result.isValid,
    canAccessGuild: result.canAccessGuild,
    canAccessRaidData: result.canAccessRaidData,
    guildInfo: result.guildInfo,
    error: result.error,
    statusCode: result.statusCode,
    timestamp: new Date().toISOString()
  }

  if (result.isValid) {
    logger.info(
      `[API-KEY-${operation.toUpperCase()}] Operation succeeded`,
      logData
    )
  } else {
    logger.warn(
      `[API-KEY-${operation.toUpperCase()}] Operation failed`,
      logData
    )
  }
}
