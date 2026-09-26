export type DangerLevel = 'critical' | 'high' | 'medium' | 'low'

export interface Threat {
  ability: string
  danger: DangerLevel
  trigger: string
}

export interface Threshold {
  hpLost: number
  modifier: string
  impact: string
}

export interface Cooldown {
  ability: string
  turns: number
  notes?: string
}

export interface TacticusTableIds {
  boss: string
  prime1?: string
  prime2?: string
}

export interface Boss {
  id: string
  name: string
  wikiUrl?: string
  tacticusTableIds?: TacticusTableIds
  faction: string
  bannedFaction: string
  strain?: string
  turnLimit: number
  movement: number
  encounterMix: {
    boss: number
    crystal: number
  }
  boards: string[]
  playbook: string
  primesPlaybook?: string
  seasonRestriction?: string
  threats: Threat[]
  keyThresholds: Threshold[]
  cooldowns: Cooldown[]
  coreMechanic: string
}

export interface PlaybooksData {
  version: string
  generatedAt: string
  featureName: string
  premium: boolean
  bosses: Boss[]
}

export interface SeasonBossInfo {
  boss_type: string
  boss_name: string
  set: number
  encounter_id: number
  rarity: string
  canonical: string
  variant?: string | null
}

export interface SeasonConfigInfo {
  id: string
  index: number
  canonicals: string[]
}
