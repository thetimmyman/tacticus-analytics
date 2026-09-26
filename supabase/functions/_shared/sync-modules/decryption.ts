export interface DecryptionLogger {
  error: (context: string, message: string, error?: unknown) => void
}

const fallbackLogger: DecryptionLogger = {
  error: (_context, message, error) => console.error(message, error)
}

// Strict ivHex:tagHex:cipherHex from Node `encrypt()`, so a plaintext UUID is never taken for ciphertext.
const ENCRYPTED_TRIPLE_REGEX = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i

export function isEncryptedFormat(value: string | null | undefined): boolean {
  return typeof value === 'string' && ENCRYPTED_TRIPLE_REGEX.test(value)
}

/** Plaintext (legacy/seed) or ciphertext credential; null if a ciphertext-shaped value fails to decrypt. */
export async function resolveStoredSecret(
  stored: string | null | undefined,
  logger: DecryptionLogger = fallbackLogger
): Promise<string | null> {
  if (!stored) return null
  if (!isEncryptedFormat(stored)) return stored
  return await decryptApiKey(stored, logger)
}

export async function decryptApiKey(
  encryptedData: string,
  logger: DecryptionLogger = fallbackLogger
): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')
  if (!encryptionKey) {
    logger.error('DECRYPT', 'No encryption key found')
    return null
  }

  const underCurrent = await decryptWithKeyString(encryptedData, encryptionKey)
  if (underCurrent !== null) return underCurrent

  // Key-rotation fallback; keep in sync with packages/app-core/src/encryption.ts.
  const previousKey = Deno.env.get('ENCRYPTION_KEY_PREVIOUS')
  if (previousKey) {
    const underPrevious = await decryptWithKeyString(encryptedData, previousKey)
    if (underPrevious !== null) {
      logger.error(
        'DECRYPT',
        'Decrypted under ENCRYPTION_KEY_PREVIOUS — value still awaiting re-encryption'
      )
      return underPrevious
    }
  }

  logger.error(
    'DECRYPT',
    'Decryption failed under all configured keys (ENCRYPTION_KEY / ENCRYPTION_KEY_PREVIOUS)'
  )
  return null
}

async function decryptWithKeyString(
  encryptedData: string,
  encryptionKey: string
): Promise<string | null> {
  try {
    const parts = encryptedData.split(':')
    if (parts.length !== 3) {
      return null
    }

    const [ivHex, authTagHex, encryptedHex] = parts

    const iv = new Uint8Array(
      ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    )
    const authTag = new Uint8Array(
      authTagHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    )
    const encrypted = new Uint8Array(
      encryptedHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    )

    const ciphertext = new Uint8Array(encrypted.length + authTag.length)
    ciphertext.set(encrypted)
    ciphertext.set(authTag, encrypted.length)

    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(encryptionKey),
      'PBKDF2',
      false,
      ['deriveBits']
    )

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode('eot-gr-salt-v2'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    )

    const key = await crypto.subtle.importKey(
      'raw',
      derivedBits,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    )
    const decoder = new TextDecoder()
    return decoder.decode(decryptedBuffer)
  } catch {
    // Not logged: a first-key miss is expected during rotation; the caller logs.
    return null
  }
}
