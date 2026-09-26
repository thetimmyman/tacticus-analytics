import {
  AlertTriangle,
  Brain,
  Bug,
  Cloud,
  Eye,
  Flame,
  Shield,
  Skull,
  Sparkles,
  Sword,
  Zap
} from 'lucide-react'
import type { BossEasterEggConfig } from './types'

export const magnusConfig: BossEasterEggConfig = {
  bossName: 'Magnus the Red',
  titleOverride: "CRIMSON KING'S PSYCHIC INTERFERENCE",
  primaryColor: 'text-blue-400',
  secondaryColor: 'text-purple-500',
  displayPattern: ['IX', 'TZEENTCH', 'CHANGE'],
  visualEffects: [
    { type: 'psychic_eye', chance: 0.4, duration: 3000 },
    { type: 'warp_flames', chance: 0.3, duration: 4000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Acolyte of Change' },
    { original: /Guild/gi, translation: 'Cabal of Sorcerers' },
    { original: /Damage/gi, translation: 'Psychic Devastation' },
    { original: /Battle/gi, translation: 'Ritual of Destruction' },
    { original: /Victory/gi, translation: "Tzeentch's Will" },
    { original: /Data/gi, translation: 'Forbidden Knowledge' },
    { original: /Team/gi, translation: 'Rubric Marines' },
    { original: /Strategy/gi, translation: 'Sorcerous Schemes' },
    { original: /Token/gi, translation: 'Warp Essence' },
    { original: /Score/gi, translation: 'Psychic Resonance' }
  ],
  interventions: [
    {
      type: 'psychic_vision',
      message: "The Crimson King's third eye opens... watching your tactics...",
      icon: Eye,
      color: 'text-blue-400',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'data_corruption',
      message: "🔮 Warp energies surge! Reality bends to Magnus's will...",
      icon: Sparkles,
      color: 'text-purple-500',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '📖 The Book of Magnus whispers corrections to your strategy...',
      icon: Brain,
      color: 'text-blue-300',
      duration: 4500,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '🌀 Tzeentch laughs at your predictable patterns...',
      icon: AlertTriangle,
      color: 'text-purple-400',
      duration: 3500,
      glitchIntensity: 'medium'
    },
    {
      type: 'psychic_vision',
      message: '⚡ Psychic feedback! Your mind touches the Great Ocean...',
      icon: Zap,
      color: 'text-blue-500',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'curiosity',
      message: '🧿 The Cyclopean Giant finds your approach... amusing...',
      icon: Eye,
      color: 'text-purple-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: '🔥 Sorcerous flames reveal hidden truths in your data...',
      icon: Flame,
      color: 'text-blue-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message: '💫 The Logos Maxima calculates infinite possibilities...',
      icon: Brain,
      color: 'text-purple-400',
      duration: 4600,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: "🌟 Prospero's ghost haunts your calculations...",
      icon: Skull,
      color: 'text-blue-300',
      duration: 5000,
      glitchIntensity: 'light'
    },
    {
      type: 'psychic_vision',
      message: '📜 Ancient Prosperine battle-cants echo through time...',
      icon: Brain,
      color: 'text-purple-500',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: 'WARNING: Warp storm detected in tactical algorithms...',
      icon: AlertTriangle,
      color: 'text-red-400',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'data_corruption',
      message: '🎭 The Changer of Ways manipulates probability itself...',
      icon: Sparkles,
      color: 'text-purple-400',
      duration: 4800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'psychic_vision',
      message: '🔮 Your future unfolds in nine different timelines...',
      icon: Eye,
      color: 'text-blue-400',
      duration: 5200,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '💀 The Rubric Marines judge your efficiency... poorly...',
      icon: Skull,
      color: 'text-purple-300',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '✨ Psychic spoor detected! Magnus knows your thoughts...',
      icon: Brain,
      color: 'text-blue-500',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'curiosity',
      message: '🌌 The Planet of Sorcerers aligns with your objectives...',
      icon: Sparkles,
      color: 'text-purple-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: "📚 The Black Library's forbidden texts corrupt your screen...",
      icon: Skull,
      color: 'text-blue-400',
      duration: 5600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'psychic_vision',
      message: "⚡ Ahriman's cabal interferes with your calculations...",
      icon: Zap,
      color: 'text-purple-500',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: "🔥 The Crimson King's wrath burns through the data streams...",
      icon: Flame,
      color: 'text-red-500',
      duration: 5800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '🧙 All is dust... including your tactical superiority...',
      icon: Skull,
      color: 'text-purple-300',
      duration: 4700,
      glitchIntensity: 'medium'
    }
  ]
}

export const mortarionConfig: BossEasterEggConfig = {
  bossName: 'Mortarion',
  titleOverride: "DEATH LORD'S PESTILENT JUDGMENT",
  primaryColor: 'text-green-600',
  secondaryColor: 'text-yellow-600',
  displayPattern: ['XIV', 'NURGLE', 'DECAY'],
  visualEffects: [{ type: 'poison_cloud', chance: 0.5, duration: 5000 }],
  translations: [
    { original: /Player/gi, translation: 'Plague Bearer' },
    { original: /Guild/gi, translation: 'Vectorium' },
    { original: /Damage/gi, translation: 'Contagion Spread' },
    { original: /Battle/gi, translation: 'Plague War' },
    { original: /Victory/gi, translation: "Nurgle's Gift" },
    { original: /Health/gi, translation: 'Decay Resistance' },
    { original: /Team/gi, translation: 'Plague Marines' },
    { original: /Defense/gi, translation: 'Disgustingly Resilient' },
    { original: /Attack/gi, translation: "Silence's Reaping" },
    { original: /Death/gi, translation: "Nurgle's Garden" },
    { original: /Strategy/gi, translation: 'Doctrine of Decay' },
    { original: /Resources/gi, translation: 'Pestilent Blessings' },
    { original: /Token/gi, translation: 'Plague Token' },
    { original: /Score/gi, translation: 'Infection Rate' }
  ],
  interventions: [
    {
      type: 'data_corruption',
      message: "☠️ The Pale King's toxic presence corrupts your data...",
      icon: Skull,
      color: 'text-green-600',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: "🦠 Nurgle's diseases spread through your tactics...",
      icon: Bug,
      color: 'text-yellow-600',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: '⚰️ Death comes for all... especially your strategies...',
      icon: Skull,
      color: 'text-green-500',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '💀 The Prince of Decay finds your efforts... pathetic...',
      icon: Skull,
      color: 'text-yellow-500',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '☣️ WARNING: Destroyer Hive swarms overwhelm defenses...',
      icon: AlertTriangle,
      color: 'text-green-600',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'data_corruption',
      message: '🌫️ Toxic fog of Barbarus clouds your judgment...',
      icon: Cloud,
      color: 'text-yellow-600',
      duration: 4800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'inspection',
      message: '🔬 The Death Lord counts the diseases in your code...',
      icon: Eye,
      color: 'text-green-500',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '⚔️ Silence reaps through your weak formations...',
      icon: Sword,
      color: 'text-yellow-500',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: "🏺 Mortarion's bitter hatred fuels his contempt...",
      icon: Brain,
      color: 'text-green-600',
      duration: 4600,
      glitchIntensity: 'medium'
    },
    {
      type: 'data_corruption',
      message: '🦟 Plague flies carry your failures to Nurgle...',
      icon: Bug,
      color: 'text-yellow-600',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '💨 Your endurance pales before Death Guard resilience...',
      icon: Shield,
      color: 'text-green-500',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '☠️ The Terminus Est brings inevitable doom...',
      icon: Skull,
      color: 'text-yellow-500',
      duration: 5800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: '🧪 Phosphex weapons dissolve your tactical foundation...',
      icon: Flame,
      color: 'text-green-600',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: '⏳ Seven plagues, seven failures, seven deaths...',
      icon: Brain,
      color: 'text-yellow-600',
      duration: 4700,
      glitchIntensity: 'medium'
    },
    {
      type: 'inspection',
      message: "👁️ Grandfather Nurgle watches through Mortarion's eyes...",
      icon: Eye,
      color: 'text-green-500',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: "🌱 Your data rots in Nurgle's Garden...",
      icon: Bug,
      color: 'text-yellow-500',
      duration: 5400,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '⚰️ Even Typhus shows more tactical acumen...',
      icon: Skull,
      color: 'text-green-600',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '💀 The Death Shroud advance... resistance is futile...',
      icon: Shield,
      color: 'text-yellow-600',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: "🎭 The witch's son remembers every betrayal...",
      icon: Brain,
      color: 'text-green-500',
      duration: 4900,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '☣️ CRITICAL: Contagion protocols override all systems...',
      icon: AlertTriangle,
      color: 'text-yellow-600',
      duration: 6000,
      glitchIntensity: 'heavy'
    }
  ]
}
