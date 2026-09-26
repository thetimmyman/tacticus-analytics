import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  afterEach,
  vi
} from 'vitest'
import { webcrypto } from 'crypto'
import {
  encrypt,
  decrypt,
  encryptApiKey,
  decryptApiKey,
  isEncrypted,
  resolveStoredSecret,
  DecryptionFailedError
} from '@tacticus/app-core/encryption'

const originalCrypto = globalThis.crypto

beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as Crypto
  }
})

afterAll(() => {
  if (!originalCrypto) {
    delete (globalThis as { crypto?: Crypto }).crypto
  }
})

describe('encryption helpers', () => {
  it('returns empty strings for empty input', async () => {
    await expect(encrypt('')).resolves.toBe('')
    await expect(decrypt('')).resolves.toBe('')
    expect(isEncrypted('')).toBe(false)
  })

  it('round-trips encrypted values', async () => {
    const cipherText = await encrypt('secret-value')
    const plainText = await decrypt(cipherText)

    expect(plainText).toBe('secret-value')
    expect(isEncrypted(cipherText)).toBe(true)
  })

  it('decrypts base64 payloads', async () => {
    const cipherText = await encrypt('base64-secret')
    const [ivHex, tagHex, cipherHex] = cipherText.split(':')
    const combined = Buffer.from(`${ivHex}${tagHex}${cipherHex}`, 'hex')
    const base64 = combined.toString('base64')

    await expect(decrypt(base64)).resolves.toBe('base64-secret')
    expect(isEncrypted(base64)).toBe(true)
  })

  it('throws for invalid hex payloads', async () => {
    const consoleErrorMock = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    await expect(decrypt('abc:def')).rejects.toThrow('Failed to decrypt data')

    consoleErrorMock.mockRestore()
  })

  it('rejects empty api key inputs', async () => {
    await expect(encryptApiKey('')).rejects.toThrow('API key cannot be empty')
    await expect(decryptApiKey('')).rejects.toThrow(
      'Encrypted API key cannot be empty'
    )
  })

  it('round-trips a UUID-shaped secret', async () => {
    const secret = '00000000-0000-4000-8000-000000000002'
    expect(await decrypt(await encrypt(secret))).toBe(secret)
  })
})

describe('resolveStoredSecret', () => {
  it('decrypts a value produced by encrypt()', async () => {
    const secret = '00000000-0000-4000-8000-000000000002'
    const stored = await encrypt(secret)

    expect(await resolveStoredSecret(stored)).toBe(secret)
  })

  it('passes a hyphenated plaintext UUID through unchanged', async () => {
    const plaintext = '00000000-0000-4000-8000-000000000002'

    expect(await resolveStoredSecret(plaintext)).toBe(plaintext)
  })

  it('passes a compact 32-char hex UUID through unchanged (false-positive guard)', async () => {
    const compactHexUuid = '00000000000040008000000000000002'

    expect(await resolveStoredSecret(compactHexUuid)).toBe(compactHexUuid)
  })

  it('returns null for empty and nullish input', async () => {
    expect(await resolveStoredSecret('')).toBeNull()
    expect(await resolveStoredSecret(null)).toBeNull()
    expect(await resolveStoredSecret(undefined)).toBeNull()
  })

  it('returns null (not the raw ciphertext) when a ciphertext-shaped value fails to decrypt', async () => {
    // Ciphertext-shaped but undecryptable: null, so ciphertext is never sent as the secret.
    const bogusCiphertext = 'deadbeef:deadbeef:deadbeef'
    expect(await resolveStoredSecret(bogusCiphertext)).toBeNull()
  })
})

describe('decrypt fails closed on bad ciphertext (WI-5700)', () => {
  const originalKey = process.env.ENCRYPTION_KEY
  const originalPrevious = process.env.ENCRYPTION_KEY_PREVIOUS

  const KEY_A = 'a'.repeat(64)
  const KEY_B = 'b'.repeat(64)

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY
    } else {
      process.env.ENCRYPTION_KEY = originalKey
    }
    if (originalPrevious === undefined) {
      delete process.env.ENCRYPTION_KEY_PREVIOUS
    } else {
      process.env.ENCRYPTION_KEY_PREVIOUS = originalPrevious
    }
  })

  it('throws DecryptionFailedError instead of echoing the ciphertext back', async () => {
    // decrypt() must fail loudly on auth failure, or a wrong key looks like success during rotation.
    process.env.ENCRYPTION_KEY = KEY_A
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    const ciphertext = await encrypt('00000000-0000-4000-8000-000000000002')

    process.env.ENCRYPTION_KEY = KEY_B
    await expect(decrypt(ciphertext)).rejects.toThrow(DecryptionFailedError)
  })

  it('still passes genuinely non-ciphertext values through untouched', async () => {
    // Hex/base64-ambiguous legacy plaintext must not be treated as failed ciphertext.
    process.env.ENCRYPTION_KEY = KEY_A
    const compactHexUuid = '00000000000040008000000000000002'

    await expect(decrypt(compactHexUuid)).resolves.toBe(compactHexUuid)
  })
})

describe('ENCRYPTION_KEY rotation fallback (WI-5700)', () => {
  const originalKey = process.env.ENCRYPTION_KEY
  const originalPrevious = process.env.ENCRYPTION_KEY_PREVIOUS

  const OLD_KEY = 'a'.repeat(64)
  const NEW_KEY = 'b'.repeat(64)
  const SECRET = '00000000-0000-4000-8000-000000000002'

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY
    } else {
      process.env.ENCRYPTION_KEY = originalKey
    }
    if (originalPrevious === undefined) {
      delete process.env.ENCRYPTION_KEY_PREVIOUS
    } else {
      process.env.ENCRYPTION_KEY_PREVIOUS = originalPrevious
    }
  })

  it('reads a value still encrypted under the outgoing key', async () => {
    // Rows not yet re-encrypted must still resolve via ENCRYPTION_KEY_PREVIOUS.
    process.env.ENCRYPTION_KEY = OLD_KEY
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    const legacyCiphertext = await encrypt(SECRET)

    process.env.ENCRYPTION_KEY = NEW_KEY
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD_KEY

    expect(await decrypt(legacyCiphertext)).toBe(SECRET)
    expect(await resolveStoredSecret(legacyCiphertext)).toBe(SECRET)
  })

  it('writes under the new key so re-encrypted rows survive dropping the previous key', async () => {
    process.env.ENCRYPTION_KEY = NEW_KEY
    process.env.ENCRYPTION_KEY_PREVIOUS = OLD_KEY
    const rewritten = await encrypt(SECRET)

    delete process.env.ENCRYPTION_KEY_PREVIOUS
    expect(await decrypt(rewritten)).toBe(SECRET)
  })

  it('fails closed when neither key authenticates', async () => {
    process.env.ENCRYPTION_KEY = OLD_KEY
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    const ciphertext = await encrypt(SECRET)

    process.env.ENCRYPTION_KEY = NEW_KEY
    process.env.ENCRYPTION_KEY_PREVIOUS = 'c'.repeat(64)

    await expect(decrypt(ciphertext)).rejects.toThrow(DecryptionFailedError)
  })
})

describe('getEncryptionKey hard-fail (WI-1570)', () => {
  const originalKey = process.env.ENCRYPTION_KEY
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ENCRYPTION_KEY
    } else {
      process.env.ENCRYPTION_KEY = originalKey
    }
    process.env.NODE_ENV = originalNodeEnv
  })

  it('throws when ENCRYPTION_KEY is unset outside development', async () => {
    delete process.env.ENCRYPTION_KEY
    process.env.NODE_ENV = 'production'

    await expect(encrypt('x')).rejects.toThrow('Failed to encrypt data')
  })
})
