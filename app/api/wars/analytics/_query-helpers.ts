import { Errors } from '@/app/lib/errors/AppError'

export type GuildWarAnalyticsSide = 'offense' | 'defense'

export interface GuildWarAnalyticsQuery {
  side: GuildWarAnalyticsSide
  limit: number
  seasonCount: number
  minUses?: number
  seasons?: number[]
  battlefieldLevels?: number[]
}

function parseIntegerListQueryParam(
  searchParams: URLSearchParams,
  key: string
): number[] | undefined {
  const rawValues = searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  if (rawValues.length === 0) return undefined
  const values = rawValues.map((value) => Number(value))
  if (values.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw Errors.fromResponse(400, { error: `${key} must contain integers` })
  }
  return [...new Set(values)].slice(0, 20)
}

interface GuildWarAnalyticsQueryDefaults {
  limit: number
  seasonCount?: number
  minUses?: number
}

function parseIntQueryParam(
  searchParams: URLSearchParams,
  key: string,
  defaultValue: number
): number {
  return Number.parseInt(searchParams.get(key) || String(defaultValue), 10)
}

export function parseGuildWarAnalyticsQuery(
  searchParams: URLSearchParams,
  defaults: GuildWarAnalyticsQueryDefaults
): GuildWarAnalyticsQuery {
  const side = searchParams.get('side') || 'offense'
  if (side !== 'offense' && side !== 'defense') {
    throw Errors.fromResponse(400, {
      error: 'side must be offense or defense'
    })
  }

  const query: GuildWarAnalyticsQuery = {
    side,
    limit: parseIntQueryParam(searchParams, 'limit', defaults.limit),
    seasonCount: parseIntQueryParam(
      searchParams,
      'season_count',
      defaults.seasonCount ?? 4
    )
  }

  query.seasons = parseIntegerListQueryParam(searchParams, 'seasons')
  query.battlefieldLevels = parseIntegerListQueryParam(
    searchParams,
    'battlefield_levels'
  )
  if (query.battlefieldLevels?.some((level) => level > 5)) {
    throw Errors.fromResponse(400, {
      error: 'battlefield_levels must be between 1 and 5'
    })
  }

  if (defaults.minUses !== undefined) {
    query.minUses = parseIntQueryParam(
      searchParams,
      'min_uses',
      defaults.minUses
    )
  }

  return query
}
