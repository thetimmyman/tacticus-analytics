import { NextResponse } from 'next/server'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.admin.auto-invalidate-api-keys')
import { Errors } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'

type ProblematicGuild = {
  guild_code: string
  display_name: string | null
  consecutive_sync_failures: number | null
  api_key_is_valid: boolean | null
  api_key_last_validated: string | null
  last_successful_sync: string | null
}

type AutoInvalidationRecord = {
  guild_code: string
  display_name: string | null
  failures: number
  previous_status: boolean | null
  action: 'invalidated_due_to_failures'
}

// Cross-guild: the gate must be app-admin, never a guild rank.
export const POST = withAdminGuards({ guard: 'app-admin' }, async () => {
  const supabase = await db()

  const { data: problematicGuilds, error: queryError } = await supabase
    .from('guild_config')
    .select(
      `
      guild_code,
      display_name,
      consecutive_sync_failures,
      api_key_is_valid,
      api_key_last_validated,
      last_successful_sync
    `
    )
    .or(
      'and(consecutive_sync_failures.gte.5,api_key_is_valid.eq.true),' +
        'and(consecutive_sync_failures.gte.10,api_key_is_valid.is.null)'
    )

  if (queryError) {
    throw Errors.database('Failed to query guilds', {
      details: queryError.message
    })
  }

  const updates: AutoInvalidationRecord[] = []

  const guildList = (problematicGuilds as ProblematicGuild[] | null) ?? []

  for (const guild of guildList) {
    const failures = guild.consecutive_sync_failures ?? 0

    if (
      (failures >= 5 && guild.api_key_is_valid === true) ||
      (failures >= 10 && guild.api_key_is_valid === null)
    ) {
      updates.push({
        guild_code: guild.guild_code,
        display_name: guild.display_name,
        failures: failures,
        previous_status: guild.api_key_is_valid,
        action: 'invalidated_due_to_failures'
      })
    }
  }

  if (updates.length > 0) {
    // The update RLS policy admits only that guild's officers and would silently drop other rows.
    const { error: updateError } = await serviceDb()
      .from('guild_config')
      .update({
        api_key_is_valid: false,
        api_key_last_validated: new Date().toISOString(),
        auto_sync_enabled: false
      })
      .in(
        'guild_code',
        updates.map((update) => update.guild_code)
      )

    if (updateError) {
      throw Errors.database('Failed to apply auto-invalidations', {
        details: updateError.message
      })
    }
  }

  logger.info(`Auto-invalidated ${updates.length} problematic API keys`)

  return NextResponse.json({
    success: true,
    message: `Auto-invalidated ${updates.length} API keys with excessive failures`,
    updates: updates
  })
})
