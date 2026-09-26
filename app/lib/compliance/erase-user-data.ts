import 'server-only'

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
import {
  parseAccountDeletionPreparation,
  preparePlayerAccountDeletion,
  type AccountDeletionPreparation
} from '@/app/lib/auth/player-authority-lifecycle'
import { anonymizeSubjectBattleRows } from '@/app/lib/compliance/anonymize-subject-battle-rows'

const logger = createComponentLogger('lib.compliance.erase-user-data')

/** The single complete-erasure path, so a `completed` request always means full erasure. */

export type ErasureStep =
  | 'webhook_attribution'
  | 'battle_data_anonymization'
  | 'player_authority'
  | 'auth_user'

export class ErasureStepError extends Error {
  readonly step: ErasureStep

  constructor(step: ErasureStep, message: string) {
    super(message)
    this.name = 'ErasureStepError'
    this.step = step
  }
}

export interface ErasureAuditHooks {
  /** Never allowed to block erasure. */
  recordProcessing?: (record: {
    userId: string
    dataType: string
    processingPurpose: string
    legalBasis: 'legal_obligation'
  }) => Promise<void>
}

/** Both `user_not_found` and a bare 404 must count as absence or the request never closes. */
export function isAuthUserAlreadyAbsent(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 'user_not_found') return true
  return 'status' in error && error.status === 404
}

/**
 * Not transactional (the last step is a GoTrue call): any failure throws before the
 * request is marked completed, and the nightly executor re-runs this idempotent function.
 */
export async function eraseAllUserData(
  supabase: TypedSupabaseClient,
  userId: string,
  reason: 'account_delete' | 'gdpr_erasure',
  hooks: ErasureAuditHooks = {}
): Promise<AccountDeletionPreparation> {
  const now = new Date().toISOString()

  // Fatal: a stale FK reference blocks the auth delete.
  const { error: webhookError } = await supabase
    .from('webhook_config')
    .update({ updated_by: null, updated_at: now })
    .eq('updated_by', userId)
  if (webhookError) {
    throw new ErasureStepError(
      'webhook_attribution',
      `Failed to clear webhook attribution: ${webhookError.message}`
    )
  }

  // Non-fatal: ON DELETE SET NULL clears it anyway.
  const { error: guildThemesError } = await supabase
    .from('guild_themes')
    .update({ updated_by: null, updated_at: now })
    .eq('updated_by', userId)
  if (guildThemesError) {
    logger.error(
      {
        event: 'gdpr.erasure.guild_themes_attribution_failed',
        message: guildThemesError.message
      },
      'gdpr.erasure.guild_themes_attribution_failed: ON DELETE SET NULL still clears it'
    )
  }

  // Keyed on player ids, never display name (which would rename a stranger's rows).
  // Must run before preparePlayerAccountDeletion clears the user_id links.
  let anonymizedRows: number
  try {
    anonymizedRows = await anonymizeSubjectBattleRows(supabase, userId)
  } catch (error) {
    throw new ErasureStepError(
      'battle_data_anonymization',
      error instanceof Error ? error.message : String(error)
    )
  }
  if (anonymizedRows === 0) {
    logger.info(
      { event: 'gdpr.erasure.no_player_ids' },
      'gdpr.erasure.no_player_ids: subject has no erasable player ids, no battle data anonymized'
    )
  }

  const { data: authorityData, error: authorityError } =
    await preparePlayerAccountDeletion(supabase, userId, reason)
  const preparation = parseAccountDeletionPreparation(authorityData)
  if (authorityError || !preparation) {
    throw new ErasureStepError(
      'player_authority',
      `Failed to revoke player authority: ${authorityError?.message ?? 'invalid response'}`
    )
  }

  if (preparation.purgedLokiCredentialCount > 0) {
    logger.info(
      { credentialCount: preparation.purgedLokiCredentialCount },
      'Purged LOKI credentials for GDPR erasure'
    )
    await hooks.recordProcessing?.({
      userId,
      dataType: 'loki_credential_erasure',
      processingPurpose: 'gdpr_data_erasure',
      legalBasis: 'legal_obligation'
    })
  }

  // Last: the point of no return. The SDK both returns and throws errors.
  try {
    const { error: authDeleteError } =
      await supabase.auth.admin.deleteUser(userId)
    if (authDeleteError && !isAuthUserAlreadyAbsent(authDeleteError)) {
      throw new ErasureStepError(
        'auth_user',
        `Failed to delete Auth user: ${authDeleteError.message}`
      )
    }
  } catch (error) {
    if (error instanceof ErasureStepError) throw error
    if (isAuthUserAlreadyAbsent(error)) return preparation
    throw new ErasureStepError(
      'auth_user',
      `Failed to delete Auth user: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  return preparation
}
