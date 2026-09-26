import 'server-only'

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { User } from '@supabase/supabase-js'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'
import {
  activateDiscordIdentityGeneration,
  parseDiscordGenerationActivation,
  type DiscordGenerationActivation
} from './player-authority-lifecycle'
import { unsealDiscordRelinkState } from './discord-relink-state'

export class DiscordRelinkActivationError extends Error {
  constructor(
    message: string,
    readonly discardState: boolean
  ) {
    super(message)
    this.name = 'DiscordRelinkActivationError'
  }
}

export async function activatePendingDiscordRelink(
  supabase: TypedSupabaseClient,
  user: User,
  sealedState: string | null | undefined
): Promise<DiscordGenerationActivation | null> {
  if (!sealedState) return null
  const state = await unsealDiscordRelinkState(sealedState)
  if (!state || state.userId !== user.id) {
    throw new DiscordRelinkActivationError(
      'Discord relink state is invalid or expired',
      true
    )
  }
  const claims = extractDiscordIdentityClaims(user)
  if (!claims?.discordUserId) {
    throw new DiscordRelinkActivationError(
      'Fresh Discord identity is missing',
      false
    )
  }

  const { data, error } = await activateDiscordIdentityGeneration(
    supabase,
    state.unlinkId,
    state.relinkNonce
  )
  if (error) {
    const staleGeneration =
      error.code === '42501' &&
      (error.message ?? '').includes('Relink generation or nonce is stale')
    throw new DiscordRelinkActivationError(
      `Discord generation activation failed: ${error.message}`,
      staleGeneration
    )
  }
  const activation = parseDiscordGenerationActivation(data, {
    unlinkId: state.unlinkId,
    generation: state.generation,
    discordUserId: claims.discordUserId
  })
  if (!activation) {
    throw new DiscordRelinkActivationError(
      'Discord generation activation returned invalid proof',
      false
    )
  }
  return activation
}
