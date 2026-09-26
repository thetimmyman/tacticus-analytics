// @deno-types="npm:tweetnacl@1.0.3"
import nacl from 'https://esm.sh/tweetnacl@1.0.3'

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5
} as const

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
  MODAL: 9
} as const

function hexToUint8Array(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g)
  if (!matches) throw new Error('Invalid hex string')
  return new Uint8Array(matches.map((byte) => parseInt(byte, 16)))
}

export interface DiscordVerificationResult {
  isValid: boolean
  body: any
}

export async function verifyDiscordRequest(
  request: Request,
  publicKey: string
): Promise<DiscordVerificationResult> {
  const signature = request.headers.get('x-signature-ed25519')
  const timestamp = request.headers.get('x-signature-timestamp')
  const body = await request.text()

  if (!signature || !timestamp) {
    return { isValid: false, body: null }
  }

  try {
    const isValid = nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + body),
      hexToUint8Array(signature),
      hexToUint8Array(publicKey)
    )

    return { isValid, body: isValid ? JSON.parse(body) : null }
  } catch {
    return { isValid: false, body: null }
  }
}

export function createPongResponse(): Response {
  return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
    headers: { 'Content-Type': 'application/json' }
  })
}

export function createDeferredResponse(): Response {
  return new Response(
    JSON.stringify({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
