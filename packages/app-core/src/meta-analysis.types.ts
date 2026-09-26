export interface TeamComposition {
  compositionKey: string
  compositionDisplay: string
  heroNames: string[]

  // Same format as the battle log.
  heroDetails?: string | null
  machineOfWarDetails?: string | null

  battlesCount: number
  minDamage: number
  maxDamage: number
  avgDamage: number
  medianDamage: number

  standardDeviation: number
  coefficientOfVariation: number
  stabilityScore: number
  stabilityRank: 'High' | 'Medium' | 'Low'

  playerCount: number
  guildCount: number
  playerNames: string[]
  guildCodes: string[]

  rarity: string
  set: number
  season: string

  category?: string // Single category (for backward compatibility)
  categories?: string[] // Multiple categories (new)
}

export interface RecommendedTeam {
  rarity: string
  set: number
  levelString: string
  bossName: string
  composition: TeamComposition
  rank: number
}
