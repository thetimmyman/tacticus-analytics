'use client'

import { createComponentLogger } from '@/app/lib/logging/client'
import type { GuildTokenAvailabilityRow } from '@/app/components/token-usage/types'
import type {
  DataSource,
  GuildTokensResponse,
  PlayerAvailability,
  PlayerData,
  SeededAvailability,
  StatusState,
  TokenState
} from '@/app/components/gr-availability/types'

export const logger = createComponentLogger('components.GRAvailability')

export const createEmptyStatus = <T extends string>(): StatusState<T> => ({
  type: null,
  message: ''
})

const DATA_SOURCES = ['live', 'calculated', 'default'] as const
const KNOWN_DATA_SOURCES: ReadonlySet<DataSource> = new Set(DATA_SOURCES)

export const isKnownDataSource = (value: string): value is DataSource =>
  KNOWN_DATA_SOURCES.has(value as DataSource)

const normalizeDataSource = (value: string | null | undefined): DataSource => {
  if (value === 'api' || value === 'live') return 'live'
  if (typeof value === 'string' && isKnownDataSource(value)) return value
  return 'default'
}

export const formatInterval = (seconds?: number | null): string | null => {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds))
    return null
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h === 0 && m === 0) return `${s}s`
  if (h === 0) return `${m}m ${s}s`
  return `${h}h ${m}m ${s}s`
}

export const isPlayerData = (value: unknown): value is PlayerData => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PlayerData>
  return (
    typeof candidate.player_id === 'string' &&
    typeof candidate.display_name === 'string' &&
    typeof candidate.tokens_available === 'number' &&
    typeof candidate.bombs_available === 'number' &&
    typeof candidate.api_key_is_valid === 'boolean' &&
    typeof candidate.data_source === 'string'
  )
}

export const parseGuildTokensResponse = (
  payload: unknown
): GuildTokensResponse => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Unexpected response from guild token API')
  }

  const { players, summary } = payload as {
    players?: unknown
    summary?: Record<string, number>
  }
  if (
    !Array.isArray(players) ||
    players.some((player) => !isPlayerData(player))
  ) {
    throw new Error('Invalid player data returned from guild token API')
  }

  return {
    players: players as PlayerData[],
    summary
  }
}

export const toPlayerAvailability = (
  player: PlayerData
): PlayerAvailability => {
  const tokenState: TokenState =
    player.tokens_available === 0
      ? 'empty'
      : player.tokens_available >= 3
        ? 'capped'
        : 'regenerating'

  const dataSource = normalizeDataSource(player.data_source)

  return {
    player_id: player.player_id,
    display_name: player.display_name || 'Unknown Player',
    tokens_available: player.tokens_available,
    bombs_available: player.bombs_available,
    token_state: tokenState,
    data_source: dataSource,
    has_api_key: player.api_key_is_valid,
    token_cooldown: player.token_cooldown ?? null,
    bomb_cooldown: player.bomb_cooldown ?? null,
    last_sync_at: player.last_sync_at ?? null,
    time_to_next_token: player.time_to_next_token ?? null,
    last_battle_time: player.last_battle_time ?? null,
    battles_with_damage: player.battles_with_damage ?? 0
  }
}

export const createAvailabilityKey = (guildCode: string, season: string) =>
  `${guildCode}:${season}`

export const createSeededAvailability = (
  rows: GuildTokenAvailabilityRow[] | undefined,
  guildCode: string,
  season: string
): SeededAvailability | null => {
  if (!guildCode || !season || !rows || rows.length === 0) return null

  const validRows = rows.filter(isPlayerData)
  if (validRows.length !== rows.length) return null

  return {
    key: createAvailabilityKey(guildCode, season),
    players: validRows.map(toPlayerAvailability),
    playersWithApiKeys: new Set(
      validRows
        .filter((player) => player.api_key_is_valid)
        .map((player) => player.player_id)
    )
  }
}

export const readResponseBody = async (
  response: Response
): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch (jsonError) {
      logger.error(
        { err: jsonError },
        '[GRAvailability] Failed to parse JSON response'
      )
      return null
    }
  }

  try {
    return await response.text()
  } catch (textError) {
    logger.error(
      { err: textError },
      '[GRAvailability] Failed to read text response'
    )
    return null
  }
}
