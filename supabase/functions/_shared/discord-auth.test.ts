import {
  assertEquals,
  assert
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { verifyDiscordRequest } from './discord-auth.ts'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function generateKeyPair() {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519', namedCurve: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair

  const rawPublicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', keyPair.publicKey)
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
    await crypto.subtle.sign('Ed25519', privateKey, message)
  )
  return toHex(signature)
}

function buildRequest(
  body: string,
  signature: string | null,
  timestamp: string | null
): Request {
  const headers = new Headers()
  if (signature !== null) headers.set('x-signature-ed25519', signature)
  if (timestamp !== null) headers.set('x-signature-timestamp', timestamp)
  return new Request('http://localhost', {
    method: 'POST',
    headers,
    body
  })
}

Deno.test('discord-auth - valid signature verifies true', async () => {
  const { keyPair, publicKeyHex } = await generateKeyPair()
  const timestamp = '1700000000'
  const body = JSON.stringify({ type: 1 })
  const signature = await sign(keyPair.privateKey, timestamp, body)

  const req = buildRequest(body, signature, timestamp)
  const result = await verifyDiscordRequest(req, publicKeyHex)

  assertEquals(result.isValid, true)
  assertEquals(result.body, { type: 1 })
})

Deno.test('discord-auth - tampered body fails verification', async () => {
  const { keyPair, publicKeyHex } = await generateKeyPair()
  const timestamp = '1700000000'
  const body = JSON.stringify({ type: 1 })
  const signature = await sign(keyPair.privateKey, timestamp, body)

  const tamperedBody = JSON.stringify({ type: 2 })
  const req = buildRequest(tamperedBody, signature, timestamp)
  const result = await verifyDiscordRequest(req, publicKeyHex)

  assertEquals(result.isValid, false)
  assertEquals(result.body, null)
})

Deno.test('discord-auth - tampered timestamp fails verification', async () => {
  const { keyPair, publicKeyHex } = await generateKeyPair()
  const timestamp = '1700000000'
  const body = JSON.stringify({ type: 1 })
  const signature = await sign(keyPair.privateKey, timestamp, body)

  const req = buildRequest(body, signature, '1700000001')
  const result = await verifyDiscordRequest(req, publicKeyHex)

  assertEquals(result.isValid, false)
  assertEquals(result.body, null)
})

Deno.test(
  'discord-auth - missing signature/timestamp headers fails closed',
  async () => {
    const { publicKeyHex } = await generateKeyPair()
    const body = JSON.stringify({ type: 1 })

    const req = buildRequest(body, null, null)
    const result = await verifyDiscordRequest(req, publicKeyHex)

    assertEquals(result.isValid, false)
    assertEquals(result.body, null)
  }
)

Deno.test('discord-auth - wrong public key fails verification', async () => {
  const { keyPair } = await generateKeyPair()
  const { publicKeyHex: wrongPublicKeyHex } = await generateKeyPair()
  const timestamp = '1700000000'
  const body = JSON.stringify({ type: 1 })
  const signature = await sign(keyPair.privateKey, timestamp, body)

  const req = buildRequest(body, signature, timestamp)
  const result = await verifyDiscordRequest(req, wrongPublicKeyHex)

  assertEquals(result.isValid, false)
  assertEquals(result.body, null)
})

Deno.test(
  'discord-auth - malformed signature hex fails without throwing',
  async () => {
    const { publicKeyHex } = await generateKeyPair()
    const timestamp = '1700000000'
    const body = JSON.stringify({ type: 1 })

    const req = buildRequest(body, 'not-valid-hex!!', timestamp)
    const result = await verifyDiscordRequest(req, publicKeyHex)

    assertEquals(result.isValid, false)
    assertEquals(result.body, null)
    assert(true)
  }
)
