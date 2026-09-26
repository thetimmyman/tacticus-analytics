import type { PerformanceSummary } from './performance.types'
import type {
  SeasonTokenPlayer,
  SeasonTokenStats,
  TokenContext
} from './tokens.types'
import type {
  TokenRatioMaps,
  TokenWeightingMode
} from './performance-calculations.types'

function normalizeDisplayName(name?: string | null): string {
  return name?.trim().toLowerCase() ?? ''
}

export interface TokenRatioParticipant {
  playerId?: string | null
  displayName?: string | null
  value: number
}

const DEFAULT_RATIO_FALLBACK = 1

export function clampTokenRatio(
  value: number,
  fallback = DEFAULT_RATIO_FALLBACK
): number {
  if (!Number.isFinite(value)) return fallback
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function applyTokenWeightingPercent(
  weightedAveragePercent: number,
  ratio: number
): number {
  const clampedRatio = clampTokenRatio(ratio)
  const weightedAverageDecimal = weightedAveragePercent / 100
  const factoredDecimal = (1 + weightedAverageDecimal) * clampedRatio - 1
  return factoredDecimal * 100
}

export function getTokenRatioForIdentifiers(
  tokenRatios: Map<string, number> | undefined,
  playerId?: string | null,
  displayName?: string | null,
  fallback = DEFAULT_RATIO_FALLBACK
): number {
  if (!tokenRatios || tokenRatios.size === 0) return fallback

  if (playerId) {
    const trimmedId = playerId.trim()
    if (trimmedId.length > 0) {
      const ratioById = tokenRatios.get(trimmedId)
      if (typeof ratioById === 'number') {
        return clampTokenRatio(ratioById, fallback)
      }
    }
  }

  const normalizedName = normalizeDisplayName(displayName)
  if (normalizedName) {
    const ratioByName = tokenRatios.get(normalizedName)
    if (typeof ratioByName === 'number') {
      return clampTokenRatio(ratioByName, fallback)
    }
  }

  return fallback
}

export function getTokenRatioForSummary(
  summary: PerformanceSummary,
  tokenRatios: Map<string, number> | undefined
): number {
  return getTokenRatioForIdentifiers(
    tokenRatios,
    summary.playerId,
    summary.displayName
  )
}

export function deriveParticipationShareRatiosFromParticipants(
  participants: TokenRatioParticipant[],
  mode: TokenWeightingMode
): Map<string, number> {
  const ratios = new Map<string, number>()
  if (participants.length === 0) return ratios

  let highestValue = 0
  let totalValue = 0
  let participantCount = 0

  participants.forEach((participant) => {
    const total =
      typeof participant.value === 'number' && participant.value > 0
        ? participant.value
        : 0
    if (total > highestValue) highestValue = total
    totalValue += total
    participantCount += 1
  })

  const averageValue = participantCount > 0 ? totalValue / participantCount : 0

  if (mode === 'max' && highestValue <= 0) return ratios
  if (mode === 'average' && averageValue <= 0) return ratios

  participants.forEach((participant) => {
    const total =
      typeof participant.value === 'number' && participant.value > 0
        ? participant.value
        : 0
    const ratio =
      mode === 'average'
        ? averageValue > 0
          ? clampTokenRatio(total / averageValue, 0)
          : 0
        : highestValue > 0 && total > 0
          ? clampTokenRatio(total / highestValue, 0)
          : 0

    if (participant.playerId) {
      const trimmed = participant.playerId.trim()
      if (trimmed.length > 0) {
        ratios.set(trimmed, ratio)
      }
    }

    const normalized = normalizeDisplayName(participant.displayName)
    if (normalized) {
      ratios.set(normalized, ratio)
    }
  })

  return ratios
}

export function deriveParticipationShareRatiosFromSummaries(
  summaries: PerformanceSummary[],
  mode: TokenWeightingMode
): Map<string, number> {
  const participants: TokenRatioParticipant[] = summaries.map((summary) => ({
    playerId: summary.playerId,
    displayName: summary.displayName,
    value: typeof summary.total_battles === 'number' ? summary.total_battles : 0
  }))

  return deriveParticipationShareRatiosFromParticipants(participants, mode)
}

export function buildTokenRatioMapsFromStats(
  stats: SeasonTokenStats[],
  allowedContexts: TokenContext[] = ['guild']
): TokenRatioMaps {
  const allowed = new Set(
    allowedContexts.map((context) => context.toLowerCase())
  )
  const maps: TokenRatioMaps = {
    max: new Map(),
    average: new Map()
  }

  stats
    .filter((entry) => {
      if (!entry?.context) return false
      return allowed.has(entry.context.toLowerCase())
    })
    .forEach((entry) => {
      const players = entry.players ?? []
      if (players.length === 0) return

      const totalSpent = players.reduce(
        (sum, player) => sum + extractTokensSpent(player),
        0
      )
      const averageSpent = players.length > 0 ? totalSpent / players.length : 0

      players.forEach((player) => {
        const maxRatio = computeRatio(
          player.tokens_spent,
          player.tokens_possible
        )
        const spent = extractTokensSpent(player)
        const averageRatio =
          averageSpent > 0
            ? clampTokenRatio(spent / averageSpent, 0)
            : spent > 0
              ? 1
              : 0

        applyPlayerRatio(maps.max, player, maxRatio)
        applyPlayerRatio(maps.average, player, averageRatio)
      })
    })

  return maps
}

export function mergeTokenRatioMap(
  primary: Map<string, number>,
  fallback: Map<string, number>
): Map<string, number> {
  const merged = new Map(primary)
  fallback.forEach((value, key) => {
    if (!merged.has(key)) {
      merged.set(key, value)
    }
  })
  return merged
}

export function extractTokensSpent(
  player: SeasonTokenPlayer | undefined
): number {
  if (!player) return 0
  if (typeof player.tokens_spent === 'number' && player.tokens_spent >= 0)
    return player.tokens_spent
  const ratio =
    typeof player.ratio_spent === 'number' ? player.ratio_spent : null
  const possible =
    typeof player.tokens_possible === 'number' ? player.tokens_possible : 0
  return ratio !== null && possible > 0
    ? clampTokenRatio(ratio, 0) * possible
    : 0
}

export function computeRatio(
  spent?: number | null,
  possible?: number | null
): number {
  if (
    typeof spent !== 'number' ||
    typeof possible !== 'number' ||
    possible <= 0
  )
    return 0
  return clampTokenRatio(spent / possible, 0)
}

function applyPlayerRatio(
  map: Map<string, number>,
  player: SeasonTokenPlayer,
  ratio: number
) {
  if (player.player_id) {
    const trimmed = player.player_id.trim()
    if (trimmed.length > 0) {
      map.set(trimmed, ratio)
    }
  }
  const normalized = normalizeDisplayName(player.display_name)
  if (normalized) {
    map.set(normalized, ratio)
  }
}
