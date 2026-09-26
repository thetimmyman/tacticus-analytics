'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { clearGuildSettingsCache } from '@/app/lib/calculations/guild-settings'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('votlw.actions')

export interface UpdateVOTLWSettingsInput {
  guildCode: string
  applyTokenOffenderFiltering: boolean
  tokenOffenderThreshold: number
  tokenAbuserThreshold: number
}

type UpdateVOTLWSettingsResult =
  { success: true } | { success: false; error: string }

const MIN_THRESHOLD = 1
const MAX_THRESHOLD = 14

function clampThreshold(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, Math.round(value)))
}

export async function updateVOTLWSettingsAction(
  input: UpdateVOTLWSettingsInput
): Promise<UpdateVOTLWSettingsResult> {
  try {
    const { profile } = await requireRole('officer')

    if (
      (profile.guild_code ?? '').toUpperCase() !== input.guildCode.toUpperCase()
    ) {
      return {
        success: false,
        error: 'You can only update settings for your own guild.'
      }
    }

    const offenderThreshold = clampThreshold(input.tokenOffenderThreshold, 4)
    const abuserThreshold = clampThreshold(input.tokenAbuserThreshold, 5)

    if (abuserThreshold < offenderThreshold) {
      return {
        success: false,
        error:
          'Abuser threshold must be greater than or equal to the offender threshold.'
      }
    }

    const supabase = await db()
    // Untyped client: the generated DB types lack `apply_token_offender_filtering`.
    const { error } = await (supabase as unknown as SupabaseClient)
      .from('guild_config')
      .update({
        apply_token_offender_filtering: input.applyTokenOffenderFiltering,
        token_offender_threshold: offenderThreshold,
        token_abuser_threshold: abuserThreshold,
        updated_at: new Date().toISOString()
      })
      .eq('guild_code', input.guildCode)

    if (error) {
      logger.error(
        { guildCode: input.guildCode, error: error.message },
        'Failed to update VOTLW settings'
      )
      return { success: false, error: 'Failed to save VOTLW settings.' }
    }

    await clearGuildSettingsCache(input.guildCode)
    revalidatePath('/votlw')

    return { success: true }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to save VOTLW settings.'
    return { success: false, error: message }
  }
}
