import { LucideIcon } from 'lucide-react'

export type InterventionType =
  | 'message'
  | 'glitch'
  | 'warning'
  | 'inspection'
  | 'analysis'
  | 'disapproval'
  | 'curiosity'
  | 'ancient_wisdom'
  | 'system_alert'
  | 'data_corruption'
  | 'psychic_vision'
  | 'tactical_override'
  | 'biomass_hunger'
  | 'waaagh_energy'

export interface BossIntervention {
  type: InterventionType
  message: string
  icon: LucideIcon
  color: string
  duration: number
  glitchIntensity: 'none' | 'light' | 'medium' | 'heavy'
}

export interface BossTranslation {
  original: RegExp
  translation: string
}

export type VisualEffectType =
  | 'targeting_reticle' // T'au - crosshair overlay
  | 'servo_skull' // Mechanicus - floating repair bot
  | 'binary_rain' // Mechanicus - falling binary code
  | 'poison_cloud' // Nurgle - toxic gas spreading
  | 'psychic_eye' // Tzeentch - third eye overlay
  | 'warp_flames' // Tzeentch - purple/blue flames
  | 'waaagh_energy' // Orks - green energy burst
  | 'dakka_holes' // Orks - bullet holes appearing
  | 'gauss_flayer' // Necrons - green energy beams
  | 'scarab_swarm' // Necrons - tiny scarabs
  | 'blood_drip' // Khaine - blood/molten metal
  | 'flame_border' // Khaine - fire around edges
  | 'bio_tendrils' // Tyranids - organic tendrils
  | 'acid_splatter' // Tyranids - corrosive effect
  | 'fortification' // Imperial Fists - shield overlay

export interface VisualEffect {
  type: VisualEffectType
  chance: number // 0-1, probability of triggering
  duration: number // ms
}

export interface BossEasterEggConfig {
  bossName: string
  titleOverride: string
  primaryColor: string
  secondaryColor: string
  displayPattern: string[] // shown at the popup bottom, e.g. binary codes
  visualEffects: VisualEffect[]
  translations: BossTranslation[]
  interventions: BossIntervention[]
}
