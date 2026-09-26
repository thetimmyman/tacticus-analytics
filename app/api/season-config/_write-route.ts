import type { User } from '@supabase/supabase-js'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { db, type Database } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import { invalidateSeasonConfigCache } from './_cache'
import {
  mergeSeasonConfigSubBossPatch,
  type SeasonConfigBaseInput
} from './_write-helpers'

interface SeasonConfigWriteAuthorization<TInput> {
  input: TInput
  supabase: Database
  user: User
}

export async function authorizeSeasonConfigWrite<
  TInput extends SeasonConfigBaseInput
>(
  request: Request,
  options: {
    endpoint: string
    normalizeInput: (body: unknown) => TInput | null
    validationMessage: string
  }
): Promise<SeasonConfigWriteAuthorization<TInput>> {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.authenticationRequired('Authentication required', {
      endpoint: options.endpoint
    })
  )
  const input = options.normalizeInput(await request.json().catch(() => null))
  if (!input) {
    throw Errors.validation(options.validationMessage, {
      endpoint: options.endpoint
    })
  }

  await requireGuildOfficerOrClusterLeader(
    supabase,
    user.id,
    input.guild_code,
    options.endpoint
  )
  return { input, supabase, user }
}

/** Atomic merge, then invalidate every affected read key. */
export async function persistSeasonConfigPatch<
  TInput extends SeasonConfigBaseInput
>(options: {
  endpoint: string
  failures: {
    insert: string
    lookup: string
    update: string
  }
  input: TInput
  patch: Record<string, unknown>
  selectedBy: string
  supabase: Database
}): Promise<void> {
  await mergeSeasonConfigSubBossPatch({
    supabase: options.supabase,
    selectedBy: options.selectedBy,
    input: options.input,
    patch: options.patch,
    endpoint: options.endpoint,
    lookupFailureMessage: options.failures.lookup,
    updateFailureMessage: options.failures.update,
    insertFailureMessage: options.failures.insert
  })
  await invalidateSeasonConfigCache(options.supabase, {
    guildCode: options.input.guild_code,
    raritySet: options.input.level,
    season: options.input.season_number
  })
}
