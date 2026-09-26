import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DISCORD_RELINK_STATE_MAX_AGE_SECONDS,
  sealDiscordRelinkState,
  unsealDiscordRelinkState
} from '@/app/lib/auth/discord-relink-state'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const UNLINK_ID = '33333333-3333-4333-8333-333333333333'
const RELINK_NONCE = '44444444-4444-4444-8444-444444444444'
const NOW = new Date('2026-08-09T20:00:00Z')

describe('encrypted Discord relink state', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', 'test-only-high-entropy-relink-state-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('round-trips without exposing the raw nonce or unlink ID', async () => {
    const sealed = await sealDiscordRelinkState(
      USER_ID,
      {
        success: true,
        unlinkId: UNLINK_ID,
        relinkNonce: RELINK_NONCE,
        generation: 2,
        clearedMappings: 1,
        providerUnlinkRequired: true,
        staleSyncBlocked: true
      },
      NOW
    )

    expect(sealed).not.toContain(UNLINK_ID)
    expect(sealed).not.toContain(RELINK_NONCE)
    await expect(unsealDiscordRelinkState(sealed, NOW)).resolves.toMatchObject({
      userId: USER_ID,
      unlinkId: UNLINK_ID,
      relinkNonce: RELINK_NONCE,
      generation: 2
    })
  })

  it('rejects expired and tampered state', async () => {
    const sealed = await sealDiscordRelinkState(
      USER_ID,
      {
        success: true,
        unlinkId: UNLINK_ID,
        relinkNonce: RELINK_NONCE,
        generation: 2,
        clearedMappings: 0,
        providerUnlinkRequired: false,
        staleSyncBlocked: true
      },
      NOW
    )
    const expiredAt = new Date(
      NOW.getTime() + DISCORD_RELINK_STATE_MAX_AGE_SECONDS * 1000 + 1
    )

    await expect(
      unsealDiscordRelinkState(sealed, expiredAt)
    ).resolves.toBeNull()
    const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('0') ? '1' : '0'}`
    await expect(unsealDiscordRelinkState(tampered, NOW)).resolves.toBeNull()
  })
})
