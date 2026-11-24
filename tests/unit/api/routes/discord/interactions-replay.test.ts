import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { NextRequest } from 'next/server'
import { InteractionType, InteractionResponseType } from 'discord-api-types/v10'
import * as discordVerify from '@/app/lib/utils/discord-verify'
import { GET, POST } from '@/app/api/discord/interactions/route'

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

async function signPayload(
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

describe('/api/discord/interactions timestamp replay window', () => {
  let keyPair: CryptoKeyPair
  let publicKeyHex: string
  const originalPublicKey = process.env.DISCORD_PUBLIC_KEY

  beforeAll(async () => {
    const generated = await generateKeyPair()
    keyPair = generated.keyPair
    publicKeyHex = generated.publicKeyHex
  })

  afterEach(() => {
    if (originalPublicKey === undefined) {
      delete process.env.DISCORD_PUBLIC_KEY
    } else {
      process.env.DISCORD_PUBLIC_KEY = originalPublicKey
    }
    vi.restoreAllMocks()
  })

  it('rejects missing x-signature-timestamp with 401', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const request = new NextRequest(
      'http://localhost/api/discord/interactions',
      {
        method: 'POST',
        headers: { 'x-signature-ed25519': 'deadbeef' },
        body: JSON.stringify({ type: InteractionType.Ping })
      }
    )

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it.each(['', 'abc', '1700000000.5', '-1700000000', '1700000000abc', 'NaN'])(
    'rejects malformed non-numeric timestamp (%s) with 401 before verifying signature',
    async (badTimestamp) => {
      process.env.DISCORD_PUBLIC_KEY = publicKeyHex
      const verifySpy = vi.spyOn(discordVerify, 'verifyDiscordRequest')
      const body = JSON.stringify({ type: InteractionType.Ping })
      const signature = await signPayload(
        keyPair.privateKey,
        badTimestamp,
        body
      )

      const request = new NextRequest(
        'http://localhost/api/discord/interactions',
        {
          method: 'POST',
          headers: {
            'x-signature-ed25519': signature,
            'x-signature-timestamp': badTimestamp
          },
          body
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(401)
      expect(verifySpy).not.toHaveBeenCalled()
    }
  )

  it('rejects a validly signed request older than 300 seconds with 401', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const verifySpy = vi.spyOn(discordVerify, 'verifyDiscordRequest')
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 301)
    const body = JSON.stringify({ type: InteractionType.Ping })
    const signature = await signPayload(
      keyPair.privateKey,
      staleTimestamp,
      body
    )

    const request = new NextRequest(
      'http://localhost/api/discord/interactions',
      {
        method: 'POST',
        headers: {
          'x-signature-ed25519': signature,
          'x-signature-timestamp': staleTimestamp
        },
        body
      }
    )

    const response = await POST(request)
    expect(response.status).toBe(401)
    expect(verifySpy).not.toHaveBeenCalled()
  })

  it('rejects a validly signed request more than 300 seconds in the future with 401', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const verifySpy = vi.spyOn(discordVerify, 'verifyDiscordRequest')
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 305)
    const body = JSON.stringify({ type: InteractionType.Ping })
    const signature = await signPayload(
      keyPair.privateKey,
      futureTimestamp,
      body
    )

    const request = new NextRequest(
      'http://localhost/api/discord/interactions',
      {
        method: 'POST',
        headers: {
          'x-signature-ed25519': signature,
          'x-signature-timestamp': futureTimestamp
        },
        body
      }
    )

    const response = await POST(request)
    expect(response.status).toBe(401)
    expect(verifySpy).not.toHaveBeenCalled()
  })

  it('accepts a validly signed Ping within the 5-minute replay window', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const freshTimestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify({ type: InteractionType.Ping })
    const signature = await signPayload(
      keyPair.privateKey,
      freshTimestamp,
      body
    )

    const request = new NextRequest(
      'http://localhost/api/discord/interactions',
      {
        method: 'POST',
        headers: {
          'x-signature-ed25519': signature,
          'x-signature-timestamp': freshTimestamp
        },
        body
      }
    )

    const response = await POST(request)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      type: InteractionResponseType.Pong
    })
  })

  it('rejects signed GET requests with a stale timestamp', async () => {
    process.env.DISCORD_PUBLIC_KEY = publicKeyHex
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 400)
    const signature = await signPayload(keyPair.privateKey, staleTimestamp, '')

    const request = new NextRequest(
      'http://localhost/api/discord/interactions',
      {
        method: 'GET',
        headers: {
          'x-signature-ed25519': signature,
          'x-signature-timestamp': staleTimestamp
        }
      }
    )

    const response = await GET(request)
    expect(response.status).toBe(401)
  })
})
