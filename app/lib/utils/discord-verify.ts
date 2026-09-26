import { webcrypto } from 'crypto'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.utils.discord-verify')

export async function verifyDiscordRequest(
  body: string,
  signature: string,
  timestamp: string
): Promise<boolean> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY

  if (!publicKey) {
    logger.error('DISCORD_PUBLIC_KEY not set')
    return false
  }

  try {
    const signatureBytes = hexToUint8Array(signature)
    const timestampBytes = new TextEncoder().encode(timestamp)
    const bodyBytes = new TextEncoder().encode(body)

    const message = new Uint8Array(timestampBytes.length + bodyBytes.length)
    message.set(timestampBytes)
    message.set(bodyBytes, timestampBytes.length)

    const keyBytes = hexToUint8Array(publicKey)
    const cryptoKey = await webcrypto.subtle.importKey(
      'raw',
      keyBytes,
      {
        name: 'Ed25519',
        namedCurve: 'Ed25519'
      },
      false,
      ['verify']
    )

    const isValid = await webcrypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signatureBytes,
      message
    )

    return isValid
  } catch (error) {
    logger.error({ err: error }, 'Discord signature verification failed:')
    return false
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string')
  }

  const array = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    array[i / 2] = parseInt(hex.substr(i, 2), 16)
  }

  return array
}
