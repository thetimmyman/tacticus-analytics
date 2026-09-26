'use client'

import { useEffect, useMemo } from 'react'
import { useBaseQuery } from '@/app/lib/hooks/shared'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.useGuildTokenAvailability'
)

type GuildTokenRow = {
  player_id?: unknown
  tokens_available?: unknown
  token_cooldown?: unknown
  next_token_seconds?: unknown
}

type GuildTokensResponse = {
  players?: unknown
}

type ErrorPayload = {
  error?: unknown
}

const isErrorPayload = (value: unknown): value is ErrorPayload =>
  value !== null && typeof value === 'object' && 'error' in value

async function fetchGuildTokenAvailability(args: {
  guildCode: string
  seasonNumber: string
}): Promise<GuildTokensResponse> {
  const params = new URLSearchParams()
  params.set('guild', args.guildCode)
  params.set('season', args.seasonNumber)

  const response = await fetch(`/api/guild-tokens?${params.toString()}`)
  const payload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    const message =
      isErrorPayload(payload) && payload.error != null
        ? String(payload.error)
        : 'Failed to load guild tokens'
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid guild tokens response')
  }

  return payload as GuildTokensResponse
}

export function useGuildTokenAvailability(args: {
  guildCode: string
  seasonNumber: string
  enabled: boolean
}) {
  const query = useBaseQuery({
    queryKey: ['guild-token-availability', args.guildCode, args.seasonNumber],
    queryFn: () =>
      fetchGuildTokenAvailability({
        guildCode: args.guildCode,
        seasonNumber: args.seasonNumber
      }),
    enabled: args.enabled,
    cacheDuration: 15 * 1000
  })

  const data = useMemo((): Map<
    string,
    {
      tokensAvailable: number
      tokenCooldown: string | null
      nextTokenSeconds: number | null
    }
  > => {
    const map = new Map<
      string,
      {
        tokensAvailable: number
        tokenCooldown: string | null
        nextTokenSeconds: number | null
      }
    >()
    if (!query.data) return map
    const rawPlayers = (query.data as GuildTokensResponse).players
    const players = Array.isArray(rawPlayers)
      ? (rawPlayers as GuildTokenRow[])
      : []
    players.forEach((row) => {
      const playerId = row.player_id
      const tokens = row.tokens_available
      if (typeof playerId !== 'string') return
      if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return

      const tokenCooldown =
        typeof row.token_cooldown === 'string' ? row.token_cooldown : null
      const nextTokenSecondsRaw = row.next_token_seconds
      const nextTokenSeconds =
        typeof nextTokenSecondsRaw === 'number' &&
        Number.isFinite(nextTokenSecondsRaw)
          ? Math.max(0, Math.trunc(nextTokenSecondsRaw))
          : null

      map.set(playerId, {
        tokensAvailable: Math.max(0, Math.trunc(tokens)),
        tokenCooldown,
        nextTokenSeconds
      })
    })
    return map
  }, [query.data])

  useEffect(() => {
    if (!query.error) return
    logger.warn(
      {
        guildCode: args.guildCode,
        season: args.seasonNumber,
        error:
          query.error instanceof Error
            ? query.error.message
            : String(query.error)
      },
      'Failed to fetch guild token availability'
    )
  }, [args.guildCode, args.seasonNumber, query.error])

  return {
    ...query,
    data
  }
}
