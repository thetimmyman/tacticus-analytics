import { db } from '@/app/lib/db'
import { calculateTokenAvailability } from '@/app/lib/calculations/token-calculation'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'

export interface TokenAvailabilityRow {
  display_name: string
  tokens_used: number
  max_possible: number
  bombs_used?: number
  bombs_available?: number
  tokens_available: number
  token_next_in_seconds: number | null
  bombs_available_live: number
  bomb_next_in_seconds: number | null
}

export async function getTokenUsageOverlay(
  guild: string,
  season: string
): Promise<TokenAvailabilityRow[]> {
  const normalizedGuild = normalizeGuildIdentifier(guild)
  const { getTokenUsage } = await import('@/app/lib/data/token-usage')
  const usage = await getTokenUsage(normalizedGuild, season)

  const supabase = await db()
  const { data: rawBattles } = await supabase
    .from('EOT_GR_data')
    .select('displayName, damageType, startedOn')
    .eq('Guild', normalizedGuild)
    .in('damageType', ['Battle', 'Bomb'])
    .not('displayName', 'is', null)
    .order('startedOn', { ascending: false })

  const battlesByPlayer = new Map<
    string,
    {
      displayName: string
      damageType: 'Battle' | 'Bomb'
      startedOn: string | null
    }[]
  >()
  if (Array.isArray(rawBattles)) {
    rawBattles.forEach((row) => {
      const name = row.displayName
      if (!name) return
      const arr = battlesByPlayer.get(name) || []
      arr.push({
        displayName: name,
        damageType: row.damageType as 'Battle' | 'Bomb',
        startedOn: row.startedOn
      })
      battlesByPlayer.set(name, arr)
    })
  }

  const availabilityCache = new Map<
    string,
    ReturnType<typeof calculateTokenAvailability>
  >()

  return usage.map((row) => {
    const name = row.display_name || ''
    let avail = availabilityCache.get(name)
    if (!avail) {
      const battles = battlesByPlayer.get(name) || []
      avail = calculateTokenAvailability(battles)
      availabilityCache.set(name, avail)
    }

    return {
      display_name: row.display_name,
      tokens_used: row.tokens_used,
      max_possible: row.max_possible,
      bombs_used: row.bombs_used ?? 0,
      bombs_available: row.bombs_available ?? 0,
      tokens_available: avail.tokensAvailable,
      token_next_in_seconds: avail.tokenNextSeconds ?? null,
      bombs_available_live: avail.bombsAvailable,
      bomb_next_in_seconds: avail.bombNextSeconds ?? null
    }
  })
}
