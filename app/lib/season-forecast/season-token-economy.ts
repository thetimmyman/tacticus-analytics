// One population and per-player cap, so used + remaining never exceeds members × seasonMaxTokens.

export interface PlayerTokenEconomyInput {
  bank: number
  /** Battle attacks this season (not the lookback window). */
  usedThisSeason: number
  recentBattleCount: number
  playerId?: string
  displayName?: string
}

/** PRIVACY: rows identify members; scope to the caller's row (outlook-player-scope.ts) for members. */
export interface PlayerTokenPaceRow {
  playerId: string
  displayName: string
  tokensUsed: number
  /** min(seasonMax - used, bank + regenToEnd) */
  tokensRemaining: number
  projectedWaste: number
  atCapRisk: boolean
}

export interface SeasonTokenAggregates {
  memberCount: number
  tokensUsed: number
  tokensRemaining: number
  projectedWaste: number
  playersAtCapRisk: number
}

export interface SeasonTokenEconomyResult extends SeasonTokenAggregates {
  players: PlayerTokenPaceRow[]
}

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0)

/** rateWindowDays must be min(lookback, season age); a fixed 30 days would fabricate waste. */
export function computeSeasonTokenAggregates(args: {
  players: PlayerTokenEconomyInput[]
  regenToEnd: number
  daysRemaining: number
  rateWindowDays: number
  seasonMaxTokens: number
  regenPerDay: number
}): SeasonTokenEconomyResult {
  const regenToEnd = Math.max(0, Math.floor(args.regenToEnd))
  const daysRemaining = nonNeg(args.daysRemaining)
  const rateWindowDays = args.rateWindowDays > 0 ? args.rateWindowDays : 1
  const seasonMax = Math.max(0, args.seasonMaxTokens)
  const regenPerDay = nonNeg(args.regenPerDay)

  let tokensUsed = 0
  let tokensRemaining = 0
  let projectedWaste = 0
  let playersAtCapRisk = 0
  const rows: PlayerTokenPaceRow[] = []

  for (const p of args.players) {
    const used = Math.max(0, Math.floor(p.usedThisSeason))
    const bank = nonNeg(p.bank)
    tokensUsed += used

    const capRoom = Math.max(0, seasonMax - used)
    const spendable = Math.min(bank + regenToEnd, capRoom)
    tokensRemaining += spendable

    const realizableRegen = Math.min(regenToEnd, capRoom)
    const ratePerDay = nonNeg(p.recentBattleCount) / rateWindowDays
    const wasteRatePerDay = Math.max(0, regenPerDay - ratePerDay)
    const waste = Math.min(realizableRegen, wasteRatePerDay * daysRemaining)
    projectedWaste += waste
    if (waste >= 1) playersAtCapRisk += 1

    rows.push({
      playerId: p.playerId ?? '',
      displayName: p.displayName ?? '',
      tokensUsed: used,
      tokensRemaining: spendable,
      projectedWaste: waste,
      atCapRisk: waste >= 1
    })
  }

  return {
    memberCount: args.players.length,
    tokensUsed,
    tokensRemaining: Math.round(tokensRemaining),
    projectedWaste: Math.round(projectedWaste),
    playersAtCapRisk,
    players: rows
  }
}
