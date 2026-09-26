import 'server-only'

import { decrypt, encrypt } from '@tacticus/app-core/encryption'
import type { Json } from '@tacticus/app-core/types'
import type { DiscordUnlinkPreparation } from './player-authority-lifecycle'

export const DISCORD_RELINK_STATE_COOKIE = 'eot-discord-relink-state'
export const DISCORD_RELINK_STATE_MAX_AGE_SECONDS = 10 * 60

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface DiscordRelinkState {
  version: 1
  userId: string
  unlinkId: string
  relinkNonce: string
  generation: number
  expiresAt: string
}

export async function sealDiscordRelinkState(
  userId: string,
  preparation: DiscordUnlinkPreparation,
  now = new Date()
): Promise<string> {
  if (!UUID.test(userId)) throw new Error('Discord relink user ID is invalid')
  const state: DiscordRelinkState = {
    version: 1,
    userId,
    unlinkId: preparation.unlinkId,
    relinkNonce: preparation.relinkNonce,
    generation: preparation.generation,
    expiresAt: new Date(
      now.getTime() + DISCORD_RELINK_STATE_MAX_AGE_SECONDS * 1000
    ).toISOString()
  }
  return encrypt(JSON.stringify(state))
}

export async function unsealDiscordRelinkState(
  value: string | null | undefined,
  now = new Date()
): Promise<DiscordRelinkState | null> {
  if (!value) return null
  let parsed: Json
  try {
    parsed = JSON.parse(await decrypt(value)) as Json
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const state = parsed as Record<string, unknown>
  const expiry =
    typeof state.expiresAt === 'string' ? new Date(state.expiresAt) : null
  if (
    state.version !== 1 ||
    typeof state.userId !== 'string' ||
    !UUID.test(state.userId) ||
    typeof state.unlinkId !== 'string' ||
    !UUID.test(state.unlinkId) ||
    typeof state.relinkNonce !== 'string' ||
    !UUID.test(state.relinkNonce) ||
    typeof state.generation !== 'number' ||
    !Number.isSafeInteger(state.generation) ||
    state.generation < 1 ||
    !expiry ||
    !Number.isFinite(expiry.getTime()) ||
    expiry.getTime() <= now.getTime()
  ) {
    return null
  }
  return state as unknown as DiscordRelinkState
}

export const discordRelinkCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: DISCORD_RELINK_STATE_MAX_AGE_SECONDS
}
