/** Decrypt stored API keys; plaintext keys are no longer supported. */

import { decryptApiKey } from './encryption'
import { legacyConsoleLogger as logger } from './logger'

export async function getApiKey(record: {
  api_key_encrypted?: string | null
}): Promise<string | null> {
  if (record.api_key_encrypted) {
    try {
      return await decryptApiKey(record.api_key_encrypted)
    } catch (error) {
      logger.error('Failed to decrypt API key:', error)
      return null
    }
  }

  return null
}

export async function getPlayerApiKey(record: {
  tacticus_api_key_encrypted?: string | null
}): Promise<string | null> {
  if (record.tacticus_api_key_encrypted) {
    try {
      return await decryptApiKey(record.tacticus_api_key_encrypted)
    } catch (error) {
      logger.error('Failed to decrypt player API key:', error)
      return null
    }
  }

  return null
}

export function hasApiKey(record: {
  api_key_encrypted?: string | null
}): boolean {
  return !!record.api_key_encrypted
}

export function hasPlayerApiKey(record: {
  tacticus_api_key_encrypted?: string | null
}): boolean {
  return !!record.tacticus_api_key_encrypted
}
