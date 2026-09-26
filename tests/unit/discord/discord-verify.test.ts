import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { webcrypto } from 'crypto'
import { verifyDiscordRequest } from '@/app/lib/utils/discord-verify'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generateKeyPair() {
  const keyPair = (await webcrypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair

  const rawPublicKey = new Uint8Array(
    await webcrypto.subtle.exportKey('raw', keyPair.publicKey)
  )

  return { keyPair, publicKeyHex: toHex(rawPublicKey) }
}

async function sign(
  privateKey: CryptoKey,
  timestamp: string,
  body: string
): Promise<string> {
  const message = new TextEncoder().encode(timestamp + body)
  const signature = new Uint8Array(
    await webcrypto.subtle.sign('Ed25519', privateKey, message)
  )
  return toHex(signature)
}

describe('verifyDiscordRequest', () => {
  let publicKeyHex: string
  let keyPair: CryptoKeyPair
  const originalEnv = process.env.DISCORD_PUBLIC_KEY

  beforeAll(async () => {
    const generated = await generateKeyPair()
    publicKeyHex = generated.publicKeyHex
    keyPair = generated.keyPair
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DISCORD_PUBLIC_KEY
    } else {
      process.env.DISCORD_PUBLIC_KEY = originalEnv
    }
    vi.restoreAllMocks()
  })

  it('returns true for a validly signed request', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })
    const signature = await sign(keyPair.privateKey, timestamp, body)

    const result = await verifyDiscordRequest(body, signature, timestamp)

    expect(result).toBe(true)
  })

  it('returns false when the body is tampered with after signing', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })
    const signature = await sign(keyPair.privateKey, timestamp, body)

    const tamperedBody = JSON.stringify({ type: 2 })
    const result = await verifyDiscordRequest(
      tamperedBody,
      signature,
      timestamp
    )

    expect(result).toBe(false)
  })

  it('returns false when the timestamp is tampered with after signing', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })
    const signature = await sign(keyPair.privateKey, timestamp, body)

    const tamperedTimestamp = '1700000001'
    const result = await verifyDiscordRequest(
      body,
      signature,
      tamperedTimestamp
    )

    expect(result).toBe(false)
  })

  it('returns false (fails closed) when DISCORD_PUBLIC_KEY is not set', async () => {
    delete process.env.DISCORD_PUBLIC_KEY
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })
    const signature = await sign(keyPair.privateKey, timestamp, body)

    const result = await verifyDiscordRequest(body, signature, timestamp)

    expect(result).toBe(false)
  })

  it('returns false when verified against the wrong public key', async () => {
    const { publicKeyHex: wrongPublicKeyHex } = await generateKeyPair()
    process.env.DISCORD_PUBLIC_KEY = wrongPublicKeyHex
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })
    const signature = await sign(keyPair.privateKey, timestamp, body)

    const result = await verifyDiscordRequest(body, signature, timestamp)

    expect(result).toBe(false)
  })

  it('returns false without throwing when the signature hex is malformed', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })

    await expect(
      verifyDiscordRequest(body, 'not-valid-hex!!', timestamp)
    ).resolves.toBe(false)
  })
})
