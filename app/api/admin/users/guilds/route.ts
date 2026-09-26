import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'

export const GET = withAdminGuards({ guard: 'app-admin' }, async () => {
  const supabase = serviceDb()

  const { data: guilds, error } = await supabase
    .from('guild_config')
    .select('guild_code, display_name, cluster_code')
    .eq('auto_sync_enabled', true)
    .order('display_name', { ascending: true })

  if (error) {
    throw Errors.internal(error.message)
  }

  const guildCodes = (guilds || []).map((g) => g.guild_code)

  const { data: memberCounts } = await supabase
    .from('player_mapping')
    .select('guild_code')
    .in('guild_code', guildCodes)
    .eq('is_current', true)

  const countMap = new Map<string, number>()
  for (const m of memberCounts || []) {
    if (m.guild_code) {
      countMap.set(m.guild_code, (countMap.get(m.guild_code) || 0) + 1)
    }
  }

  const { data: accountCounts } = await supabase
    .from('player_mapping')
    .select('guild_code')
    .in('guild_code', guildCodes)
    .eq('is_current', true)
    .not('user_id', 'is', null)

  const accountMap = new Map<string, number>()
  for (const m of accountCounts || []) {
    if (m.guild_code) {
      accountMap.set(m.guild_code, (accountMap.get(m.guild_code) || 0) + 1)
    }
  }

  const result = (guilds || []).map((g) => ({
    guild_code: g.guild_code,
    guild_name: g.display_name,
    cluster_code: g.cluster_code,
    member_count: countMap.get(g.guild_code) || 0,
    accounts_count: accountMap.get(g.guild_code) || 0
  }))

  return NextResponse.json({ guilds: result })
})
