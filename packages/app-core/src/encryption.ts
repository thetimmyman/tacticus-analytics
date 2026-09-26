import { legacyConsoleLogger as logger } from './logger'

type BufferModule = typeof import('buffer').Buffer
const getBuffer = (): BufferModule | null => {
  if (typeof globalThis.Buffer !== 'undefined') {
    return globalThis.Buffer as BufferModule
  }
  return null
}

/** AES-256-GCM via Web Crypto (Edge compatible) with PBKDF2 key derivation. */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12 // Default IV length for Web Crypto AES-GCM
const AUTH_TAG_LENGTH = 16 // AES-GCM uses 16 byte auth tags
const KEY_LENGTH = 32
// The static salt is deliberate: the KDF input is a high-entropy server key and the IV is random.
// Never edit SALT in place: ciphertext has no salt field, so every stored value would brick.
// Change it only through ENCRYPTION_KEY_PREVIOUS rotation.
const SALT = 'eot-gr-salt-v2'
const ITERATIONS = 100000

const HEX_REGEX = /^[0-9a-f]+$/i
const BASE64_REGEX = /^[A-Za-z0-9+/=]+$/

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length')
  }
  const matches = hex.match(/.{2}/g) || []
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)))
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer as ArrayBuffer
  }
  const copy = view.slice()
  return copy.buffer as ArrayBuffer
}

function base64ToUint8Array(value: string): Uint8Array {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    }

    const BufferCtor = getBuffer()
    if (!BufferCtor) {
      throw new Error('Base64 decoding is not supported in this environment')
    }
    const buffer = BufferCtor.from(value, 'base64')
    return new Uint8Array(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      )
    )
  } catch (error) {
    logger.error('Failed to decode base64 encryption payload:', error)
    throw error
  }
}

async function decryptWithParams(
  key: CryptoKey,
  iv: Uint8Array,
  cipherBytes: Uint8Array,
  tagBytes?: Uint8Array
): Promise<string | null> {
  try {
    const payload = tagBytes
      ? (() => {
          const combined = new Uint8Array(cipherBytes.length + tagBytes.length)
          combined.set(cipherBytes)
          combined.set(tagBytes, cipherBytes.length)
          return combined
        })()
      : cipherBytes

    const payloadBuffer = toArrayBuffer(payload)
    const ivBuffer = toArrayBuffer(iv)

    const decrypted = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: ivBuffer
      },
      key,
      payloadBuffer
    )

    return new TextDecoder().decode(decrypted)
  } catch {
    return null
  }
}

/**
 * Ciphertext-shaped value that failed authentication under every key. Fails closed: echoing it
 * would make a wrong key look like success. Legacy plaintext passes.
 */
export class DecryptionFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptionFailedError'
  }
}

/** Rotation: set both keys and deploy (reads fall back), re-encrypt, then unset this and deploy. */
const PREVIOUS_KEY_ENV = 'ENCRYPTION_KEY_PREVIOUS'

async function getEncryptionKey(): Promise<CryptoKey> {
  // Outside development a missing key hard-fails rather than using a guessable default.
  if (!process.env.ENCRYPTION_KEY) {
    if (process.env.NODE_ENV !== 'development') {
      throw new Error(
        'ENCRYPTION_KEY is not set — refusing to derive an encryption key from the insecure default outside development'
      )
    }
    logger.warn(
      'ENCRYPTION_KEY not set - using default key (NOT SECURE FOR PRODUCTION)'
    )
  }
  const keyString = process.env.ENCRYPTION_KEY || 'default-dev-key-not-secure'

  return await deriveKeyFromString(keyString)
}

async function deriveKeyFromString(keyString: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyString),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT),
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH * 8 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function getPreviousEncryptionKey(): Promise<CryptoKey | null> {
  const previous = process.env[PREVIOUS_KEY_ENV]
  if (!previous) return null
  return await deriveKeyFromString(previous)
}

/** @returns ivHex:authTagHex:cipherHex */
export async function encrypt(text: string): Promise<string> {
  if (!text) return ''

  try {
    const key = await getEncryptionKey()
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const encoder = new TextEncoder()

    const encrypted = await crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv: iv
      },
      key,
      encoder.encode(text)
    )

    const encryptedBytes = new Uint8Array(encrypted)
    const cipherBytes = encryptedBytes.slice(
      0,
      Math.max(0, encryptedBytes.length - AUTH_TAG_LENGTH)
    )
    const tagBytes = encryptedBytes.slice(
      Math.max(0, encryptedBytes.length - AUTH_TAG_LENGTH)
    )

    const ivHex = uint8ArrayToHex(iv)
    const tagHex = uint8ArrayToHex(tagBytes)
    const cipherHex = uint8ArrayToHex(cipherBytes)

    return `${ivHex}:${tagHex}:${cipherHex}`
  } catch (error) {
    logger.error('Encryption failed:', error)
    throw new Error('Failed to encrypt data')
  }
}

/** Decrypt iv:tag:cipher, legacy iv:cipher, or base64 payloads. */
export async function decrypt(encryptedText: string): Promise<string> {
  if (!encryptedText) return ''

  try {
    const decrypted = await tryDecryptWithKey(
      encryptedText,
      await getEncryptionKey()
    )
    if (decrypted !== null) return decrypted

    const previousKey = await getPreviousEncryptionKey()
    if (previousKey) {
      const underPrevious = await tryDecryptWithKey(encryptedText, previousKey)
      if (underPrevious !== null) {
        logger.warn(
          'Decrypted under ENCRYPTION_KEY_PREVIOUS — this value has not been re-encrypted yet; run the rotation job before dropping the previous key'
        )
        return underPrevious
      }
    }

    // Ciphertext-shaped but unauthenticated under every key: fail closed. Base64
    // shapes also match ordinary strings (a compact UUID), so they pass through, logged.
    if (HEX_CIPHERTEXT_REGEX.test(encryptedText)) {
      throw new DecryptionFailedError(
        'Ciphertext failed AES-GCM authentication under all configured keys (check ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS)'
      )
    }

    logger.error(
      'Value was not decryptable and is not a recognised ciphertext shape - returning as-is'
    )
    return encryptedText
  } catch (error) {
    if (error instanceof DecryptionFailedError) throw error
    logger.error('Decryption failed:', error)
    throw new Error('Failed to decrypt data')
  }
}

/** Try every encoding under one key; null if none authenticated (never throws for auth). */
async function tryDecryptWithKey(
  encryptedText: string,
  key: CryptoKey
): Promise<string | null> {
  {
    const parts = encryptedText.split(':')

    if (
      parts.length === 3 &&
      parts.every((part) => part.length > 0 && HEX_REGEX.test(part))
    ) {
      const ivHex = parts[0]
      const authTagHex = parts[1]
      const cipherHex = parts[2]
      if (ivHex && authTagHex && cipherHex) {
        const iv = hexToUint8Array(ivHex)
        const tagBytes = hexToUint8Array(authTagHex)
        const cipherBytes = hexToUint8Array(cipherHex)

        const result = await decryptWithParams(key, iv, cipherBytes, tagBytes)
        if (result !== null) {
          return result
        }
      }
    }

    if (
      parts.length === 2 &&
      parts.every((part) => part.length > 0 && HEX_REGEX.test(part))
    ) {
      const ivHex = parts[0]
      const cipherHex = parts[1]
      if (ivHex && cipherHex) {
        const iv = hexToUint8Array(ivHex)
        const cipherBytes = hexToUint8Array(cipherHex)

        const result = await decryptWithParams(key, iv, cipherBytes)
        if (result !== null) {
          return result
        }
      }
    }

    if (encryptedText.length % 4 === 0 && BASE64_REGEX.test(encryptedText)) {
      const combined = base64ToUint8Array(encryptedText)

      for (const ivLength of [12, 16]) {
        if (combined.length <= ivLength + AUTH_TAG_LENGTH) {
          continue
        }

        const iv = combined.slice(0, ivLength)
        const tagBytes = combined.slice(ivLength, ivLength + AUTH_TAG_LENGTH)
        const cipherBytes = combined.slice(ivLength + AUTH_TAG_LENGTH)

        const result = await decryptWithParams(key, iv, cipherBytes, tagBytes)
        if (result !== null) {
          return result
        }
      }
    }

    return null
  }
}

/** Unambiguous ciphertext shapes; excludes base64, which cannot be told from plaintext. */
const HEX_CIPHERTEXT_REGEX = /^[0-9a-f]+:[0-9a-f]+(:[0-9a-f]+)?$/i

export function isEncrypted(text: string): boolean {
  if (!text) return false

  const parts = text.split(':')
  if (
    (parts.length === 2 || parts.length === 3) &&
    parts.every((part) => part.length > 0 && HEX_REGEX.test(part))
  ) {
    return true
  }

  return text.length % 4 === 0 && BASE64_REGEX.test(text)
}

/** Strict `encrypt()` shape; isEncrypted() would misclassify a plaintext UUID. */
const ENCRYPTED_TRIPLE_REGEX = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i

/** Resolves a stored credential to plaintext or null, for handing a secret to a client; never persist it. */
export async function resolveStoredSecret(
  stored: string | null | undefined
): Promise<string | null> {
  if (!stored) return null
  if (!ENCRYPTED_TRIPLE_REGEX.test(stored)) return stored
  try {
    const decrypted = await decrypt(stored)
    // An implementation that echoes its input on auth failure must still yield null.
    return decrypted === stored ? null : decrypted
  } catch (error) {
    if (error instanceof DecryptionFailedError) {
      // Null so `if (!secret)` guards fire instead of passing ciphertext downstream;
      // direct decrypt() callers still get the hard failure.
      logger.error(
        'Stored secret failed decryption under all configured keys - treating as unusable'
      )
      return null
    }
    throw error
  }
}

export async function encryptApiKey(apiKey: string): Promise<string> {
  if (!apiKey) {
    throw new Error('API key cannot be empty')
  }
  return await encrypt(apiKey)
}

export async function decryptApiKey(encryptedApiKey: string): Promise<string> {
  if (!encryptedApiKey) {
    throw new Error('Encrypted API key cannot be empty')
  }
  return await decrypt(encryptedApiKey)
}
