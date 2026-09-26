export interface BattleEntry {
  Guild: string
  Season: string
  displayName: string
  userId?: string
  Name?: string // Boss name (optional as some queries may not include it)
  damageDealt: number
  damageType: 'Battle' | 'Bomb'
  remainingHp: number
  maxHp: number // Boss max HP for sweep detection
  tier: number
  set: string | number
  loopIndex: number
  encounterId: number
  encounterIndex?: number
  rarity: string
  startedOn: string
  completedOn: string
}

export interface TokenUsagePlayer {
  display_name: string
  tokens_used: number
  max_possible_tokens: number
  battles_fought: number
  first_token_time?: string
}

export interface SetWinner {
  set: number
  rarity: 'Legendary' | 'Mythic'
  levelString: string // L1-L5 or M1-M5
  bossName: string // Boss name for display
  gold: string
  goldValue?: number
  silver: string
  silverValue?: number
  bronze: string
  bronzeValue?: number
  mostDamage: string
  mostDamageValue?: number
  sideBoss1: string
  sideBoss1Value?: number
  sideBoss2: string
  sideBoss2Value?: number
  biggestHit: string
  biggestHitValue?: number
}

export interface PlayerPoints {
  displayName: string
  totalPoints: number
  avgDamagePerHit: number
  tokenCount: number
  sweeps: number
  oneShots: number
  bombsUsed: number
  crashes: number
  firstTokenTime?: string
  awards: {
    goldMedals: number
    silverMedals: number
    bronzeMedals: number
    mostDamageAwards: number
    sideBossWins: number
    biggestHitAwards: number
    topKiller: boolean
    bestBomber: boolean
    sideBoss1Wins?: number
    sideBoss2Wins?: number
  }
  breakdown: string[]
}

export interface SeasonResults {
  topKiller?: { player: string; value: number }
  bestBomber?: { player: string; value: number }
  worstBomb?: { player: string; value: number }
  almostHadHim?: { player: string; boss: string; hpLeft: number }
  firstToken: { player: string; time: string }
  lastToken: { player: string; time: string }
  tokenEfficiency: { player: string; ratio: number }
  mostDamage: { player: string; damage: number }
  bombMaster: { player: string; bombs: number }
  legendarySlayer: { player: string; kills: number }
  sideBossSlayer: { player: string; kills: number }
  mostImproved: { player: string; improvementPct: number }
}

export interface PlayerStats {
  [key: string]: {
    totalDamage: number
    tokenCount: number
    firstTokenTime?: string
    bombCount?: number
    legendaryKills?: number
    sideBossKills?: number
    avgDamagePerToken?: number
  }
}
