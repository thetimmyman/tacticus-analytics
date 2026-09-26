import { describe, expect, it, vi } from 'vitest'
import {
  listActivePlayerInviteCodes,
  parseAccountDeletionPreparation,
  parseDiscordGenerationActivation,
  parseDiscordUnlinkConfirmation,
  parseDiscordUnlinkPreparation,
  parsePlayerGuildDeletion,
  parsePlayerGuildDeletionFailure,
  parsePlayerMappingDeactivation
} from '@/app/lib/auth/player-authority-lifecycle'

const UNLINK_ID = '33333333-3333-4333-8333-333333333333'
const RELINK_NONCE = '44444444-4444-4444-8444-444444444444'
const DISCORD_USER_ID = '123456789012345678'

describe('active invite lookup', () => {
  it('uses the dedicated exact-guild RPC without a client-side history cap', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })

    await listActivePlayerInviteCodes({ rpc } as never, 'GUILD')

    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('list_active_player_invite_codes', {
      p_guild_code: 'GUILD'
    })
  })
})

describe('Discord authority generation proofs', () => {
  it('accepts exact prepare, confirm, and activation proofs', () => {
    expect(
      parseDiscordUnlinkPreparation({
        success: true,
        unlink_id: UNLINK_ID,
        relink_nonce: RELINK_NONCE,
        generation: 2,
        cleared_mappings: 1,
        provider_unlink_required: true,
        stale_sync_blocked: true
      })
    ).toMatchObject({
      unlinkId: UNLINK_ID,
      relinkNonce: RELINK_NONCE,
      generation: 2,
      staleSyncBlocked: true
    })
    expect(
      parseDiscordUnlinkConfirmation(
        {
          success: true,
          unlink_id: UNLINK_ID,
          generation: 2,
          identity_absent: true,
          cleared_mappings: 1,
          relink_requires_nonce: true
        },
        { unlinkId: UNLINK_ID, generation: 2 }
      )
    ).toMatchObject({ unlinkId: UNLINK_ID, identityAbsent: true })
    expect(
      parseDiscordUnlinkConfirmation(
        {
          success: true,
          unlink_id: UNLINK_ID,
          generation: 1,
          identity_absent: true,
          cleared_mappings: 1,
          relink_requires_nonce: true
        },
        { unlinkId: UNLINK_ID, generation: 2 }
      )
    ).toBeNull()
    expect(
      parseDiscordGenerationActivation(
        {
          success: true,
          unlink_id: UNLINK_ID,
          generation: 2,
          mapping_id: 42,
          discord_user_id: DISCORD_USER_ID,
          fresh_generation_activated: true
        },
        { unlinkId: UNLINK_ID, generation: 2, discordUserId: DISCORD_USER_ID }
      )
    ).toMatchObject({ mappingId: 42, freshGenerationActivated: true })
  })

  it('rejects stale or weakened generation proofs', () => {
    expect(
      parseDiscordUnlinkPreparation({
        success: true,
        unlink_id: UNLINK_ID,
        relink_nonce: RELINK_NONCE,
        generation: 2,
        cleared_mappings: 1,
        provider_unlink_required: false,
        stale_sync_blocked: false
      })
    ).toBeNull()
    expect(
      parseDiscordGenerationActivation(
        {
          success: true,
          unlink_id: UNLINK_ID,
          generation: 1,
          mapping_id: 42,
          discord_user_id: DISCORD_USER_ID,
          fresh_generation_activated: true
        },
        { unlinkId: UNLINK_ID, generation: 2, discordUserId: DISCORD_USER_ID }
      )
    ).toBeNull()
  })
})

describe('parseAccountDeletionPreparation', () => {
  it('accepts the exact fail-closed owner-RPC result', () => {
    expect(
      parseAccountDeletionPreparation({
        success: true,
        cleared_mapping_count: 2,
        deleted_mapping_count: 0,
        subject_authority_blocked: true,
        revoked_attestations: 2,
        purged_loki_credential_count: 2,
        purged_loki_guild_codes: ['A', 'B'],
        binding_restorable: false
      })
    ).toEqual({
      success: true,
      clearedMappingCount: 2,
      deletedMappingCount: 0,
      subjectAuthorityBlocked: true,
      revokedAttestations: 2,
      purgedLokiCredentialCount: 2,
      purgedLokiGuildCodes: ['A', 'B'],
      bindingRestorable: false
    })
  })

  it.each([
    { success: true },
    {
      success: true,
      cleared_mapping_count: 1,
      deleted_mapping_count: 0,
      subject_authority_blocked: true,
      revoked_attestations: 1,
      purged_loki_credential_count: 1,
      purged_loki_guild_codes: [],
      binding_restorable: false
    },
    {
      success: true,
      cleared_mapping_count: 1,
      deleted_mapping_count: 0,
      subject_authority_blocked: false,
      revoked_attestations: 1,
      purged_loki_credential_count: 0,
      purged_loki_guild_codes: [],
      binding_restorable: true
    },
    {
      success: true,
      cleared_mapping_count: 1,
      deleted_mapping_count: 0,
      subject_authority_blocked: true,
      revoked_attestations: 1,
      purged_loki_credential_count: 2,
      purged_loki_guild_codes: ['GUILD', 'GUILD'],
      binding_restorable: false
    }
  ])('rejects malformed or restorable deletion proof %#', (value) => {
    expect(parseAccountDeletionPreparation(value)).toBeNull()
  })
})

describe('guarded writer proofs', () => {
  it('accepts exact atomic deactivation and guild deletion proofs', () => {
    expect(
      parsePlayerMappingDeactivation(
        {
          success: true,
          guild_code: 'GUILD',
          requested_count: 2,
          deactivated_count: 2,
          observation_stale: false,
          deactivated_mapping_ids: [12, 13],
          revoked_attestations: 1,
          purged_loki_credential_count: 1,
          purged_loki_guild_codes: ['GUILD'],
          authority_cleared: true
        },
        { guildCode: 'GUILD', requestedCount: 2 }
      )
    ).toMatchObject({
      deactivatedMappingIds: [12, 13],
      purgedLokiCredentialCount: 1,
      purgedLokiGuildCodes: ['GUILD'],
      authorityCleared: true
    })
    expect(
      parsePlayerGuildDeletion(
        {
          success: true,
          guild_id: 42,
          guild_code: 'GUILD',
          deleted_mapping_count: 3,
          deleted_invite_count: 2,
          revoked_attestations: 1,
          authority_cleared: true,
          guild_deleted: true
        },
        42
      )
    ).toMatchObject({ guildCode: 'GUILD', guildDeleted: true })
    expect(
      parsePlayerGuildDeletionFailure({
        success: false,
        error: 'Protected system guild cannot be deleted',
        error_code: 'PROTECTED_GUILD'
      })
    ).toEqual({
      success: false,
      error: 'Protected system guild cannot be deleted',
      errorCode: 'PROTECTED_GUILD'
    })
  })

  it('accepts a fail-closed stale-observation deactivation proof', () => {
    expect(
      parsePlayerMappingDeactivation(
        {
          success: true,
          guild_code: 'GUILD',
          requested_count: 1,
          deactivated_count: 0,
          observation_stale: true,
          deactivated_mapping_ids: [],
          revoked_attestations: 0,
          purged_loki_credential_count: 0,
          purged_loki_guild_codes: [],
          authority_cleared: true
        },
        { guildCode: 'GUILD', requestedCount: 1 }
      )
    ).toMatchObject({
      deactivatedCount: 0,
      observationStale: true,
      deactivatedMappingIds: []
    })
  })

  it('rejects partial, mismatched, or duplicated writer proofs', () => {
    expect(
      parsePlayerMappingDeactivation(
        {
          success: true,
          guild_code: 'GUILD',
          requested_count: 2,
          deactivated_count: 1,
          observation_stale: false,
          deactivated_mapping_ids: [12, 12],
          revoked_attestations: 1,
          purged_loki_credential_count: 1,
          purged_loki_guild_codes: [],
          authority_cleared: true
        },
        { guildCode: 'GUILD', requestedCount: 2 }
      )
    ).toBeNull()
    expect(
      parsePlayerGuildDeletionFailure({
        success: false,
        error: 'Unexpected race',
        error_code: 'TARGET_SET_NOT_EXACT'
      })
    ).toBeNull()
    expect(
      parsePlayerGuildDeletion(
        {
          success: true,
          guild_id: 41,
          guild_code: 'GUILD',
          deleted_mapping_count: 3,
          deleted_invite_count: 2,
          revoked_attestations: 1,
          authority_cleared: true,
          guild_deleted: true
        },
        42
      )
    ).toBeNull()
  })
})
