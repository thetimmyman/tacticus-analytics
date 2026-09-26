import { NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async () => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Authentication required')
  )

  const { data: mapping } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('guild_code, primary_team, secondary_team, tertiary_team')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (!mapping?.guild_code) {
    return NextResponse.json({ mentions: [] })
  }

  const teamSlugs = [
    mapping.primary_team,
    mapping.secondary_team,
    mapping.tertiary_team
  ].filter(Boolean) as string[]

  if (teamSlugs.length === 0) {
    const { data: metaRoles } = await supabase
      .from('player_meta_roles')
      .select('meta_team_id')
      .eq('user_id', user.id)

    if (metaRoles) {
      for (const r of metaRoles) {
        if (r.meta_team_id) teamSlugs.push(r.meta_team_id)
      }
    }
  }

  if (teamSlugs.length === 0) {
    return NextResponse.json({ mentions: [] })
  }

  const { data: roleMappings } = await supabase
    .from('herald_meta_role_mapping')
    .select('discord_role_id, display_label, meta_team_slug')
    .eq('guild_code', mapping.guild_code)
    .eq('enabled', true)
    .in('meta_team_slug', teamSlugs)

  if (!roleMappings || roleMappings.length === 0) {
    return NextResponse.json({ mentions: [] })
  }

  const roleIdToLabel = new Map<string, string>()
  for (const rm of roleMappings) {
    if (rm.discord_role_id && rm.display_label) {
      roleIdToLabel.set(rm.discord_role_id, rm.display_label)
    }
  }

  if (roleIdToLabel.size === 0) {
    return NextResponse.json({ mentions: [] })
  }

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  ).toISOString()

  const { data: logs } = await supabase
    .from('discord_webhook_logs')
    .select('mentioned_roles')
    .eq('guild_code', mapping.guild_code)
    .eq('suppressed_by_master_toggle', false)
    .eq('manual_override', false)
    .gte('created_at', sevenDaysAgo)
    .not('mentioned_roles', 'is', null)

  const counts = new Map<string, number>()
  for (const [roleId, label] of roleIdToLabel) {
    counts.set(label, 0)
    for (const log of logs ?? []) {
      const roles = log.mentioned_roles as string[] | null
      if (roles && Array.isArray(roles) && roles.includes(roleId)) {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
  }

  const mentions = Array.from(counts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ mentions })
})
