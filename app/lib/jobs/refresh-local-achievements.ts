import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { serviceDb } from '@/app/lib/db'
import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { evaluateAndPersistAchievements } from '@/app/lib/achievements/persist'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'

const refreshLocalAchievements: JobHandler = async (_payload, context) => {
  if (getRuntimeProfile() !== 'desktop')
    throw new Error('Local achievement job requires a desktop workspace')
  context.signal?.throwIfAborted()
  const db = serviceDb(context.signal)
  // The coordinator owns this context; job payloads cannot choose another user.
  const { data: workspaces, error } = await createDirectClient().query<
    { subject_user_id: string; guild_code: string }[]
  >(
    'desktop_preview_setup?select=subject_user_id,guild_code&singleton=eq.true',
    {
      signal: context.signal
    }
  )
  const workspace =
    Array.isArray(workspaces) && workspaces.length === 1 ? workspaces[0] : null
  if (error || !workspace?.subject_user_id || !workspace.guild_code)
    throw new Error('Local achievement workspace is unavailable')
  await evaluateAndPersistAchievements(db, workspace.guild_code, {
    subjectUserId: workspace.subject_user_id,
    strict: true,
    includeVotlwAwards: true,
    signal: context.signal
  })
  return { status: 'ok' }
}

export function registerLocalAchievementsHandler(): void {
  registerJobHandler('refresh-local-achievements', refreshLocalAchievements)
}
