import { describe, it, expect, beforeEach, vi } from 'vitest'

const { decryptApiKeyMock, loggerErrorMock } = vi.hoisted(() => ({
  decryptApiKeyMock: vi.fn(),
  loggerErrorMock: vi.fn()
}))

vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: decryptApiKeyMock
}))

vi.mock('@tacticus/app-core/logger', () => ({
  legacyConsoleLogger: { error: loggerErrorMock }
}))

import {
  getApiKey,
  getPlayerApiKey,
  hasApiKey,
  hasPlayerApiKey
} from '@tacticus/app-core/api-key-helper'

describe('api-key-helper', () => {
  beforeEach(() => {
    decryptApiKeyMock.mockReset()
    loggerErrorMock.mockReset()
  })

  it('returns decrypted api key when present', async () => {
    decryptApiKeyMock.mockResolvedValue('plain-key')

    await expect(getApiKey({ api_key_encrypted: 'enc' })).resolves.toBe(
      'plain-key'
    )
    expect(decryptApiKeyMock).toHaveBeenCalledWith('enc')
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('returns null and logs when api key decryption fails', async () => {
    const error = new Error('bad')
    decryptApiKeyMock.mockRejectedValue(error)

    await expect(getApiKey({ api_key_encrypted: 'enc' })).resolves.toBeNull()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to decrypt API key:',
      error
    )
  })

  it('returns null when api key is missing', async () => {
    await expect(getApiKey({})).resolves.toBeNull()
    expect(decryptApiKeyMock).not.toHaveBeenCalled()
  })

  it('returns decrypted player api key when present', async () => {
    decryptApiKeyMock.mockResolvedValue('player-key')

    await expect(
      getPlayerApiKey({ tacticus_api_key_encrypted: 'enc' })
    ).resolves.toBe('player-key')
    expect(decryptApiKeyMock).toHaveBeenCalledWith('enc')
  })

  it('returns null and logs when player api key decryption fails', async () => {
    const error = new Error('bad')
    decryptApiKeyMock.mockRejectedValue(error)

    await expect(
      getPlayerApiKey({ tacticus_api_key_encrypted: 'enc' })
    ).resolves.toBeNull()
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Failed to decrypt player API key:',
      error
    )
  })

  it('reports presence for api keys', () => {
    expect(hasApiKey({ api_key_encrypted: 'value' })).toBe(true)
    expect(hasApiKey({ api_key_encrypted: '' })).toBe(false)
    expect(hasApiKey({})).toBe(false)
    expect(hasPlayerApiKey({ tacticus_api_key_encrypted: 'value' })).toBe(true)
    expect(hasPlayerApiKey({ tacticus_api_key_encrypted: '' })).toBe(false)
    expect(hasPlayerApiKey({})).toBe(false)
  })
})
