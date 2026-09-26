import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { GUILD_DISPLAY_COMPACT } from '@/app/lib/guild-config-selects'

export async function resolveGuildDisplayLabel(
  supabase: TypedSupabaseClient,
  guildCode: string | null | undefined
): Promise<string> {
  const fallback = formatGuildDisplayLabel(null, guildCode)
  if (!guildCode) return fallback

  try {
    const { data } = await supabase
      .from('guild_config')
      .select(GUILD_DISPLAY_COMPACT)
      .eq('guild_code', guildCode)
      .maybeSingle()

    return formatGuildDisplayLabel(data, guildCode)
  } catch {
    return fallback
  }
}
