import type {
  DataSource,
  RpcTokenUsageRow,
  TokenAvailabilityRow,
  TokenAvailabilityData,
  RpcTokenData,
  BattleDataRow,
  PlayerStats,
  TokensByRarity
} from './types'
import { isMainBossEncounter, isPrimeEncounter } from '@/app/lib/config'

function normalizeDataSource(value: string | null | undefined): DataSource {
  if (value === 'api' || value === 'live') return 'live'
  if (value === 'calculated') return 'calculated'
  return 'default'
}

function normalizePlayerId(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

export function formatShortDuration(
  seconds: number | null | undefined
): string | null {
  if (seconds === null || seconds === undefined) return null
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

// Re-exported from app/lib/calculations/token-burn (shared with the Discord bot).
import { cappedAvailable } from '@/app/lib/calculations/token-burn'
export {
  TOKEN_AVAILABLE_CAP,
  MAX_POSSIBLE_HARD_CAP,
  cappedAvailable,
  calculateBurnedTokens,
  computeGuildMaxPossibleTokens
} from '@/app/lib/calculations/token-burn'

export function parseRpcTokenRow(
  row: RpcTokenUsageRow
): { nameKey: string; data: RpcTokenData } | null {
  const nameKey = (row.display_name || row.displayName || '')
    .trim()
    .toUpperCase()
  if (!nameKey) return null
  const playerId = normalizePlayerId(row.player_id ?? row.user_id)

  return {
    nameKey,
    data: {
      playerId,
      displayName: nameKey,
      tokens: Number(row.tokens_used ?? 0),
      bossTokens: Number(row.boss_tokens ?? 0),
      primeTokens: Number(row.prime_tokens ?? 0),
      maxPossible: Number(row.max_possible ?? 0),
      tokensAvailable:
        row.tokens_available !== undefined
          ? Number(row.tokens_available)
          : undefined,
      tokenNextSeconds: row.token_next_in_seconds ?? null,
      bombsAvailable:
        row.bombs_available_live !== undefined
          ? Number(row.bombs_available_live)
          : Number(row.bombs_available ?? 0),
      bombNextSeconds: row.bomb_next_in_seconds ?? null,
      burnedTokens: row.burned_tokens ?? null,
      timeOverCapSeconds: row.time_over_cap_seconds ?? null
    }
  }
}

export function parseAvailabilityRow(
  row: TokenAvailabilityRow
): { nameKey: string; data: TokenAvailabilityData } | null {
  const nameKey = (row.display_name || '').trim().toUpperCase()
  if (!nameKey) return null
  const playerId = normalizePlayerId(row.player_id)

  // Keep null/undefined for "no data" so the chart merge's `??` falls back; 0 is real.
  const liveBombs =
    row.bombs_available_live != null ? Number(row.bombs_available_live) : null
  const fallbackBombs =
    row.bombs_available != null ? Number(row.bombs_available) : null
  return {
    nameKey,
    data: {
      playerId,
      displayName: nameKey,
      tokensAvailable:
        row.tokens_available != null ? Number(row.tokens_available) : undefined,
      tokenNextSeconds: row.token_next_in_seconds ?? null,
      bombsAvailable: liveBombs ?? fallbackBombs ?? undefined,
      bombNextSeconds: row.bomb_next_in_seconds ?? null,
      burnedTokens: row.burned_tokens ?? null,
      timeOverCapSeconds: row.time_over_cap_seconds ?? null,
      dataSource: normalizeDataSource(row.data_source)
    }
  }
}

export function processHistoricalData(
  historicalData: BattleDataRow[]
): Record<string, number> {
  const historicalStats: Record<string, Record<string, number>> = {}

  historicalData.forEach((d) => {
    if (!d.userId) return
    const userStats =
      historicalStats[d.userId] ?? (historicalStats[d.userId] = {})
    const current = userStats[d.Season] ?? 0
    userStats[d.Season] = current + 1
  })

  const playerHistoricalAvgs: Record<string, number> = {}
  Object.entries(historicalStats).forEach(([player, seasons]) => {
    if (Object.keys(seasons).length === 5) {
      playerHistoricalAvgs[player] =
        Object.values(seasons).reduce((sum, t) => sum + t, 0) / 5
    }
  })

  return playerHistoricalAvgs
}

export function processBattleData(battleData: BattleDataRow[]): {
  playerStats: Record<string, PlayerStats>
  bossTokens: Record<string, number>
  totalTokensUsed: number
} {
  const playerStats: Record<string, PlayerStats> = {}
  const bossTokens: Record<string, number> = {}
  let totalTokensUsed = 0

  battleData.forEach((d) => {
    const playerId = d.userId
    const playerName = d.displayName
    if (!playerId || !playerName) return

    if (!playerStats[playerId]) {
      playerStats[playerId] = {
        displayName: playerName,
        tokens: 0,
        bossTokens: 0,
        primeTokens: 0,
        totalDamage: 0,
        loops: new Set(),
        tokensByRarity: createEmptyTokensByRarity()
      }
    }

    playerStats[playerId].tokens += 1
    playerStats[playerId].totalDamage += d.damageDealt || 0
    playerStats[playerId].loops.add(d.loopIndex || 0)

    const rarity = (d.rarity || 'Common').toLowerCase()
    if (rarity in playerStats[playerId].tokensByRarity) {
      playerStats[playerId].tokensByRarity[rarity as keyof TokensByRarity] += 1
    }

    const isMainBoss = isMainBossEncounter(d.encounterId)
    if (isMainBoss) playerStats[playerId].bossTokens += 1
    else if (isPrimeEncounter(d.encounterId))
      playerStats[playerId].primeTokens += 1

    const bossKey = isMainBoss ? d.Name || 'Unknown' : 'Primes'
    bossTokens[bossKey] = (bossTokens[bossKey] || 0) + 1
    totalTokensUsed += 1
  })

  return { playerStats, bossTokens, totalTokensUsed }
}

export function createEmptyTokensByRarity(): TokensByRarity {
  return { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0, mythic: 0 }
}

export function calculateTotalStats(
  players: {
    totalTokens: number
    tokensAvailable?: number
    bombsAvailable?: number
  }[],
  rpcTotals: Map<string, RpcTokenData>,
  totalTokensUsed: number
): {
  totalTokens: number
  maxTokens: number
  averageUsage: number
  tokensAvailableAvg: number
  bombsAvailableCount: number
} {
  const maxPlayerTokens = Math.max(0, ...players.map((p) => p.totalTokens))
  const avgUsage =
    players.length > 0
      ? players.reduce((sum, p) => sum + p.totalTokens, 0) / players.length
      : 0
  const tokensAvailableAvg =
    players.length > 0
      ? players.reduce(
          (sum, p) => sum + cappedAvailable(p.tokensAvailable),
          0
        ) / players.length
      : 0
  const bombsAvailableCount = players.reduce(
    (sum, p) => sum + ((p.bombsAvailable ?? 0) > 0 ? 1 : 0),
    0
  )

  return {
    totalTokens:
      rpcTotals.size > 0
        ? Array.from(rpcTotals.values()).reduce((sum, r) => sum + r.tokens, 0)
        : totalTokensUsed,
    maxTokens: maxPlayerTokens,
    averageUsage: avgUsage,
    tokensAvailableAvg,
    bombsAvailableCount
  }
}
