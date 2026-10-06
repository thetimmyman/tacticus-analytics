import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.playerstats.hooks.data-fetchers.fetchTokenAvailability'
)
import type { TokenAvailability } from '@/app/components/playerstats/types'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'

export interface FetchTokenAvailabilityParams {
  playerName: string
  guildCode: string
  season: string
  selectedGuild: string
  userRole: string
  effectiveClusterCode: string
}

type TokensPlayer = {
  display_name: string
  tokens_available?: number
  bombs_available?: number
  data_source?: string
  burned_tokens?: number | null
  time_over_cap_seconds?: number | null
  token_next_in_seconds?: number | null
  next_bomb_seconds?: number | null
  tokens_used?: number
  max_possible?: number
}

function normalizeDataSource(
  value: string | null | undefined
): 'live' | 'calculated' | 'default' {
  if (value === 'api' || value === 'live') return 'live'
  if (value === 'calculated') return 'calculated'
  return 'default'
}

export async function fetchTokenAvailability(
  params: FetchTokenAvailabilityParams
): Promise<TokenAvailability | null> {
  const {
    playerName,
    guildCode,
    season,
    selectedGuild,
    userRole,
    effectiveClusterCode
  } = params

  if (!playerName || !guildCode || !season) return null
  if (!canManageHeraldRole(userRole)) return null

  try {
    const normalizedSelectionGuild = (selectedGuild || '').trim().toUpperCase()
    const normalizedGuildCode = guildCode?.trim().toUpperCase?.() ?? ''
    const isOwnGuild =
      normalizedGuildCode.length > 0 &&
      normalizedGuildCode === normalizedSelectionGuild
    const hasValidCluster = Boolean(
      effectiveClusterCode && effectiveClusterCode !== ''
    )
    const canAccessGuild =
      isOwnGuild ||
      userRole === 'leader' ||
      (userRole === 'officer' && hasValidCluster)

    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        {
          playerName,
          guildCode,
          season,
          isOwnGuild,
          normalizedSelectionGuild,
          normalizedGuildCode,
          userRole,
          effectiveClusterCode,
          hasValidCluster,
          canAccessGuild
        },
        'Token availability access check'
      )
    }

    if (!canAccessGuild) {
      return null
    }

    const response = await fetch(
      `/api/guild-tokens?guild=${guildCode}&season=${season}`,
      {
        credentials: 'include'
      }
    )

    if (!response.ok) {
      if (!isOwnGuild) {
        return null
      }
      logger.error({ status: response.status }, 'Failed to fetch token data')
      if (process.env.NODE_ENV === 'development') {
        try {
          const errorPayload = await response.json()
          console.warn('Guild tokens fetch failed', {
            status: response.status,
            error: errorPayload?.error ?? errorPayload
          })
        } catch {
          console.warn('Guild tokens fetch failed', { status: response.status })
        }
      }
      return null
    }

    const result = await response.json()
    if (process.env.NODE_ENV === 'development') {
      console.debug('Guild tokens response', {
        playerCount: result.players?.length ?? 0,
        keys: result.players ? Object.keys(result.players[0] ?? {}) : []
      })
    }

    const playerData = result.players?.find(
      (p: TokensPlayer) => p.display_name === playerName
    )

    if (playerData) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('Token availability match', {
          tokens: playerData.tokens_available,
          bombs: playerData.bombs_available,
          dataSource: playerData.data_source
        })
      }
      const tokensAvailable = playerData.tokens_available ?? 0
      return {
        tokens: tokensAvailable,
        bombs: playerData.bombs_available || 0,
        dataSource: normalizeDataSource(playerData.data_source),
        burnedTokens: playerData.burned_tokens ?? null,
        timeOverCapSeconds: playerData.time_over_cap_seconds ?? null,
        tokensUsed: playerData.tokens_used ?? null,
        maxPossible: playerData.max_possible ?? null,
        nextTokenSeconds: playerData.token_next_in_seconds ?? null,
        // Remaining 18h cooldown; null once the bomb is in hand, which is the paused-clock
        // signal, so never coerce it to 0.
        nextBombSeconds: playerData.next_bomb_seconds ?? null,
        fetchedAtMs: Date.now()
      }
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        {
          playerName,
          availablePlayerCount: (result.players || []).length
        },
        'Token availability data not found for player'
      )
    }
    return null
  } catch (error) {
    if (guildCode !== selectedGuild) {
      return null
    }
    logger.error({ err: error }, 'Error fetching token availability:')
    if (process.env.NODE_ENV === 'development') {
      console.warn('Guild tokens fetch threw error', error)
    }
    return null
  }
}
