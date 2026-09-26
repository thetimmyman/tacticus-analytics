import {
  AlertTriangle,
  Brain,
  Bug,
  Crosshair,
  Eye,
  Flame,
  Shield,
  Skull,
  Sword,
  Zap
} from 'lucide-react'
import type { BossEasterEggConfig } from './types'

export const screamerKillerConfig: BossEasterEggConfig = {
  bossName: 'Screamer-Killer',
  titleOverride: 'CARNIFEX HUNTING PROTOCOLS',
  primaryColor: 'text-purple-400',
  secondaryColor: 'text-green-500',
  displayPattern: ['CONSUME', 'ADAPT', 'EVOLVE'],
  visualEffects: [
    { type: 'bio_tendrils', chance: 0.4, duration: 3500 },
    { type: 'acid_splatter', chance: 0.3, duration: 2500 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Biomass' },
    { original: /Guild/gi, translation: 'Brood Cluster' },
    { original: /Damage/gi, translation: 'Bio-Plasma Discharge' },
    { original: /Team/gi, translation: 'Synaptic Web' },
    { original: /Victory/gi, translation: 'Successful Consumption' },
    { original: /Battle/gi, translation: 'Feeding Frenzy' },
    { original: /Health/gi, translation: 'Biomass Integrity' },
    { original: /Strategy/gi, translation: 'Hunting Pattern' },
    { original: /Defense/gi, translation: 'Chitin Plating' },
    { original: /Resources/gi, translation: 'Genetic Material' }
  ],
  interventions: [
    {
      type: 'biomass_hunger',
      message: '🦾 *SCREEEEEEEEE* The hunter awakens...',
      icon: Bug,
      color: 'text-purple-400',
      duration: 4500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: '💀 Biomass detected... Assimilation probability: HIGH...',
      icon: Skull,
      color: 'text-green-500',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message: '🧬 Hive Mind analyzes your genetic potential...',
      icon: Brain,
      color: 'text-purple-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '⚡ Bio-plasma charging... Your defenses mean nothing...',
      icon: Zap,
      color: 'text-green-400',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'biomass_hunger',
      message: '🦴 Scything talons sharpen against your weak tactics...',
      icon: Sword,
      color: 'text-purple-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'data_corruption',
      message: '🧠 Synaptic interference detected in command structure...',
      icon: Brain,
      color: 'text-green-500',
      duration: 4600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: '💥 The ululating shriek disrupts tactical cohesion...',
      icon: Skull,
      color: 'text-purple-500',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'inspection',
      message: '🦾 Carnifex variant assesses prey vulnerability...',
      icon: Eye,
      color: 'text-green-400',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'biomass_hunger',
      message: '🧬 Evolution in progress... Adapting to your patterns...',
      icon: Brain,
      color: 'text-purple-300',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '⚠️ Shadow in the Warp blocks strategic thinking...',
      icon: AlertTriangle,
      color: 'text-green-500',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'biomass_hunger',
      message: '💀 Your biomass will feed the swarm...',
      icon: Skull,
      color: 'text-purple-400',
      duration: 3900,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message: '🦴 Chitin plates deflect your pathetic strategies...',
      icon: Shield,
      color: 'text-green-400',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '⚡ Bio-electric discharge imminent...',
      icon: Zap,
      color: 'text-purple-500',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'curiosity',
      message: '🧠 The Hive Mind finds your resistance... amusing...',
      icon: Brain,
      color: 'text-green-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'biomass_hunger',
      message: '🦾 Screamer-Killer metabolism accelerating...',
      icon: Bug,
      color: 'text-purple-400',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'tactical_override',
      message: '💥 Devastating charge pattern calculated...',
      icon: Crosshair,
      color: 'text-green-500',
      duration: 4500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'analysis',
      message: '🧬 Genetic material catalogued for absorption...',
      icon: Brain,
      color: 'text-purple-300',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'biomass_hunger',
      message: '🦴 Your tactical bones will be dissolved...',
      icon: Skull,
      color: 'text-green-400',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '⚡ Bio-plasma temperature exceeding safe limits...',
      icon: Zap,
      color: 'text-purple-500',
      duration: 5300,
      glitchIntensity: 'heavy'
    },
    {
      type: 'biomass_hunger',
      message: '💀 *SCREEEEEEEEE* FEED... KILL... REPEAT...',
      icon: Bug,
      color: 'text-green-500',
      duration: 6000,
      glitchIntensity: 'heavy'
    }
  ]
}

export const hiveTyrantConfig: BossEasterEggConfig = {
  bossName: 'Hive Tyrant',
  titleOverride: 'SYNAPTIC DOMINANCE ASSERTED',
  primaryColor: 'text-purple-500',
  secondaryColor: 'text-pink-500',
  displayPattern: ['SYNAPSE', 'DEVOUR', 'SWARM'],
  visualEffects: [
    { type: 'bio_tendrils', chance: 0.4, duration: 3500 },
    { type: 'psychic_eye', chance: 0.35, duration: 3000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Lesser Organism' },
    { original: /Guild/gi, translation: 'Prey Cluster' },
    { original: /Command/gi, translation: 'Synaptic Override' },
    { original: /Strategy/gi, translation: 'Feeding Pattern' },
    { original: /Data/gi, translation: 'Genetic Information' },
    { original: /Team/gi, translation: 'Brood Swarm' },
    { original: /Victory/gi, translation: 'Consumption Complete' },
    { original: /Defense/gi, translation: 'Carapace Armor' },
    { original: /Attack/gi, translation: 'Bio-Weapon Strike' },
    { original: /Resources/gi, translation: 'Biomass Reserves' }
  ],
  interventions: [
    {
      type: 'psychic_vision',
      message: "🧠 The Hive Tyrant's will dominates your thoughts...",
      icon: Brain,
      color: 'text-purple-500',
      duration: 4500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'inspection',
      message: '👁️ Four eyes see through your pathetic deceptions...',
      icon: Eye,
      color: 'text-pink-500',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '⚡ Psychic scream shatters tactical coherence...',
      icon: Zap,
      color: 'text-purple-600',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'tactical_override',
      message: '🦾 Bonesword and lash whip correct your errors...',
      icon: Sword,
      color: 'text-pink-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message: '🧬 Superior organism analyzes inferior tactics...',
      icon: Brain,
      color: 'text-purple-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'biomass_hunger',
      message: '💀 The swarm responds to a true commander...',
      icon: Skull,
      color: 'text-pink-500',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'data_corruption',
      message: '🧠 Synaptic web overrides your command structure...',
      icon: Brain,
      color: 'text-purple-500',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '⚔️ Millennia of warfare experience judges you...',
      icon: Sword,
      color: 'text-pink-400',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'psychic_vision',
      message: '👁️ The Tyrant sees all possible futures... you lose...',
      icon: Eye,
      color: 'text-purple-600',
      duration: 4800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: '⚡ Warp blast incoming! Tactical shields failing...',
      icon: Zap,
      color: 'text-pink-500',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '🦾 Your strategies crumble before tyranid intellect...',
      icon: Brain,
      color: 'text-purple-400',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'analysis',
      message: '🧬 Genetic superiority demonstrated conclusively...',
      icon: Bug,
      color: 'text-pink-400',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: "💥 The Tyrant's roar disrupts all coordination...",
      icon: Skull,
      color: 'text-purple-500',
      duration: 5600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'psychic_vision',
      message: '🧠 Shadow in the Warp consumes strategic thought...',
      icon: Brain,
      color: 'text-pink-500',
      duration: 4600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'tactical_override',
      message: '⚔️ Dual boneswords carve through weak plans...',
      icon: Sword,
      color: 'text-purple-400',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'inspection',
      message: '👁️ Tactical precognition reveals your every move...',
      icon: Eye,
      color: 'text-pink-400',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'biomass_hunger',
      message: '⚡ Catalyst spreads through your failing ranks...',
      icon: Zap,
      color: 'text-purple-500',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'warning',
      message: '🦾 The Tyrant advances... resistance is futile...',
      icon: Bug,
      color: 'text-pink-500',
      duration: 4700,
      glitchIntensity: 'heavy'
    },
    {
      type: 'analysis',
      message: '🧬 Your tactical genes will improve the swarm...',
      icon: Brain,
      color: 'text-purple-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: "💀 Bow before the Hive Mind's chosen...",
      icon: Skull,
      color: 'text-pink-500',
      duration: 5800,
      glitchIntensity: 'heavy'
    }
  ]
}

export const tervigonConfig: BossEasterEggConfig = {
  bossName: 'Tervigon',
  titleOverride: "BROOD MOTHER'S SPAWNING RAGE",
  primaryColor: 'text-purple-400',
  secondaryColor: 'text-red-500',
  displayPattern: ['SPAWN', 'BREED', 'MULTIPLY'],
  visualEffects: [
    { type: 'bio_tendrils', chance: 0.45, duration: 4000 },
    { type: 'acid_splatter', chance: 0.35, duration: 3000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Spawning Material' },
    { original: /Guild/gi, translation: 'Digestion Pool' },
    { original: /Units/gi, translation: 'Brood Spawn' },
    { original: /Resources/gi, translation: 'Biomass Reserves' },
    { original: /Victory/gi, translation: 'Successful Birthing' },
    { original: /Battle/gi, translation: 'Spawning Cycle' },
    { original: /Team/gi, translation: 'Termagant Swarm' },
    { original: /Strategy/gi, translation: 'Gestation Pattern' },
    { original: /Death/gi, translation: 'Biomass Recycling' },
    { original: /Score/gi, translation: 'Offspring Count' }
  ],
  interventions: [
    {
      type: 'biomass_hunger',
      message: '🥚 The brood mother stirs... spawning imminent...',
      icon: Bug,
      color: 'text-purple-400',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'tactical_override',
      message: '🦗 Termagants gestate faster than your thoughts...',
      icon: Bug,
      color: 'text-red-500',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'biomass_hunger',
      message: '💀 Your biomass will feed the next generation...',
      icon: Skull,
      color: 'text-purple-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'analysis',
      message: '🧬 Spawning sacs pulse with disapproval...',
      icon: Brain,
      color: 'text-red-400',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '⚡ Maternal fury exceeds tactical parameters...',
      icon: Zap,
      color: 'text-purple-500',
      duration: 4600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'biomass_hunger',
      message: '🥚 Endless broods mock your finite resources...',
      icon: Bug,
      color: 'text-red-500',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'tactical_override',
      message: '🦗 The swarm multiplies... you cannot keep pace...',
      icon: Bug,
      color: 'text-purple-400',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '💥 Birth-scream disrupts tactical coordination...',
      icon: Skull,
      color: 'text-red-600',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'analysis',
      message: '🧬 Genetic templates improve on your failures...',
      icon: Brain,
      color: 'text-purple-300',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '⚠️ Spawning rate accelerating beyond control...',
      icon: AlertTriangle,
      color: 'text-red-500',
      duration: 4800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'biomass_hunger',
      message: "💀 The Tervigon's children hunger for weakness...",
      icon: Skull,
      color: 'text-purple-400',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'tactical_override',
      message: '🥚 Gestation complete: Your doom emerges...',
      icon: Bug,
      color: 'text-red-400',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '🦗 Termagant swarm evaluates prey quality: Poor...',
      icon: Bug,
      color: 'text-purple-300',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: '⚡ Toxic miasma clouds strategic thinking...',
      icon: Zap,
      color: 'text-red-500',
      duration: 5400,
      glitchIntensity: 'heavy'
    },
    {
      type: 'psychic_vision',
      message: '🧬 Brood telepathy overwhelms command structure...',
      icon: Brain,
      color: 'text-purple-500',
      duration: 4700,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: "💥 The mother's rage protects her children...",
      icon: Flame,
      color: 'text-red-600',
      duration: 4300,
      glitchIntensity: 'heavy'
    },
    {
      type: 'biomass_hunger',
      message: '🥚 Spawning cycle synchronized with your errors...',
      icon: Bug,
      color: 'text-purple-400',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '🦗 Even gaunts show better tactical sense...',
      icon: Bug,
      color: 'text-red-400',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'biomass_hunger',
      message: '💀 Your defeat will feed ten thousand young...',
      icon: Skull,
      color: 'text-purple-500',
      duration: 4600,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '🧬 The Tervigon births your replacement...',
      icon: Brain,
      color: 'text-red-500',
      duration: 5800,
      glitchIntensity: 'heavy'
    }
  ]
}
