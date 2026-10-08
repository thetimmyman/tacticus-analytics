import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { requireTokenUsageGuildAccess } from '../access'
import { requireTokenSeason } from '../parameters'

export const dynamic = 'force-dynamic'

const BATTLE_SELECT =
  'userId, displayName, Season, damageType, rarity, damageDealt, Name, encounterId, loopIndex'

function splitParam(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const searchParams = new URL(request.url).searchParams
  const requestedGuild = searchParams.get('guild')
  const seasons = splitParam(searchParams.get('seasons'))
  const rarities = splitParam(searchParams.get('rarities'))

  if (!requestedGuild || seasons.length === 0) {
    throw Errors.fromResponse(400, {
      error: 'Guild and seasons parameters required'
    })
  }
  if (
    seasons.length > 12 ||
    rarities.some(
      (rarity) =>
        !['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'].includes(
          rarity
        )
    )
  ) {
    throw Errors.validation('Invalid battle history filters')
  }
  seasons.forEach(requireTokenSeason)

  const { supabase, guild } = await requireTokenUsageGuildAccess(requestedGuild)

  let query = supabase
    // eot-gr-data-requires-order: ordered after optional rarity filters are applied.
    .from('EOT_GR_data')
    .select(BATTLE_SELECT)
    .eq('Guild', guild)
    .eq('damageType', 'Battle')
    .in('Season', seasons)

  if (rarities.length > 0) {
    query = query.in('rarity', rarities)
  }

  const { data, error } = await query.order('startedOn', { ascending: false })

  if (error) {
    throw Errors.database('Failed to load token usage battle history', {
      details: error.message
    })
  }

  return NextResponse.json(data ?? [])
})
