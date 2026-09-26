import {
  AlertTriangle,
  Brain,
  Cog,
  Cpu,
  Crosshair,
  Crown,
  Eye,
  Flame,
  Shield,
  Skull,
  Sword,
  Target,
  Zap
} from 'lucide-react'
import type { BossEasterEggConfig } from './types'

export const riptideConfig: BossEasterEggConfig = {
  bossName: 'XV104 Riptide',
  titleOverride: 'BATTLESUIT AI TACTICAL ANALYSIS',
  primaryColor: 'text-orange-400',
  secondaryColor: 'text-cyan-500',
  displayPattern: ['TAU', 'GREATER', 'GOOD'],
  visualEffects: [{ type: 'targeting_reticle', chance: 0.5, duration: 3500 }],
  translations: [
    { original: /Player/gi, translation: "Shas'ui" },
    { original: /Guild/gi, translation: 'Sept Coalition' },
    { original: /Damage/gi, translation: 'Plasma Output' },
    { original: /Battle/gi, translation: 'Engagement Protocol' },
    { original: /Victory/gi, translation: 'Greater Good Achieved' },
    { original: /Team/gi, translation: 'Fire Caste Warriors' },
    { original: /Defense/gi, translation: 'Shield Protocols' },
    { original: /Attack/gi, translation: 'Pulse Weaponry' },
    { original: /Strategy/gi, translation: 'Tactical Doctrine' },
    { original: /Token/gi, translation: 'Markerlight' }
  ],
  interventions: [
    {
      type: 'tactical_override',
      message: "🎯 Riptide's targeting array locks onto suboptimal patterns...",
      icon: Target,
      color: 'text-orange-400',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '⚡ Nova Reactor charging... tactical efficiency declining...',
      icon: Zap,
      color: 'text-cyan-500',
      duration: 5000,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '🤖 Earth Caste engineers disapprove of your methods...',
      icon: Cpu,
      color: 'text-orange-300',
      duration: 3500,
      glitchIntensity: 'light'
    },
    {
      type: 'tactical_override',
      message: '📡 Markerlight network reveals tactical weaknesses...',
      icon: Crosshair,
      color: 'text-cyan-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message: '🛡️ Shield generators compensating for your errors...',
      icon: Shield,
      color: 'text-orange-400',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'message',
      message: '🎯 For the Greater Good! Your strategy needs improvement...',
      icon: Target,
      color: 'text-cyan-500',
      duration: 4000,
      glitchIntensity: 'none'
    },
    {
      type: 'system_alert',
      message: '💫 Ion accelerator targeting solution acquired...',
      icon: Zap,
      color: 'text-orange-500',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '🔧 Battlesuit diagnostics indicate user incompetence...',
      icon: Cog,
      color: 'text-cyan-300',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'analysis',
      message: "📊 Mont'ka strategy analysis: Insufficient aggression...",
      icon: Cpu,
      color: 'text-orange-400',
      duration: 4100,
      glitchIntensity: 'light'
    },
    {
      type: 'tactical_override',
      message: '🎯 Kauyon patience doctrine: You lack discipline...',
      icon: Target,
      color: 'text-cyan-400',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'warning',
      message: '⚠️ Crisis Protocol: Tactical realignment required...',
      icon: AlertTriangle,
      color: 'text-orange-500',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'analysis',
      message: '🤖 AI assistance suggests 47 improvements...',
      icon: Cpu,
      color: 'text-cyan-500',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'curiosity',
      message: '🛸 Drone network reports anomalous commander behavior...',
      icon: Eye,
      color: 'text-orange-300',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'tactical_override',
      message: '💥 Heavy burst cannon critique incoming...',
      icon: Crosshair,
      color: 'text-cyan-400',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '🎯 Target priority override: Focus fire required...',
      icon: Target,
      color: 'text-orange-500',
      duration: 4600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '📡 Ethereal caste questions your commitment...',
      icon: Brain,
      color: 'text-cyan-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '🔋 Energy management protocols judge you lacking...',
      icon: Zap,
      color: 'text-orange-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'tactical_override',
      message: '🎯 Pulse weaponry efficiency: Below acceptable parameters...',
      icon: Crosshair,
      color: 'text-cyan-500',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message:
        "🛡️ Riptide's machine spirit calculates your failure probability...",
      icon: Cpu,
      color: 'text-orange-400',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '⚡ Nova charge imminent! Prepare for tactical override...',
      icon: Zap,
      color: 'text-cyan-500',
      duration: 5500,
      glitchIntensity: 'heavy'
    }
  ]
}

export const khaineConfig: BossEasterEggConfig = {
  bossName: 'Avatar of Khaine',
  titleOverride: "WAR GOD'S BURNING JUDGMENT",
  primaryColor: 'text-red-500',
  secondaryColor: 'text-orange-500',
  displayPattern: ['KHAINE', 'BLOODY', 'HANDED'],
  visualEffects: [
    { type: 'flame_border', chance: 0.5, duration: 4000 },
    { type: 'blood_drip', chance: 0.3, duration: 3000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Mon-keigh' },
    { original: /Guild/gi, translation: 'Warhost' },
    { original: /Damage/gi, translation: "Wailing Doom's Fury" },
    { original: /Battle/gi, translation: 'Dance of Death' },
    { original: /Victory/gi, translation: "Khaine's Will" },
    { original: /Team/gi, translation: 'Aspect Warriors' },
    { original: /Strategy/gi, translation: 'War Mask' },
    { original: /Defense/gi, translation: 'Molten Aegis' },
    { original: /Attack/gi, translation: 'Blood-Handed Strike' },
    { original: /Token/gi, translation: "Warrior's Blood" }
  ],
  interventions: [
    {
      type: 'ancient_wisdom',
      message: '🔥 The Bloody-Handed God stirs... Your doom approaches...',
      icon: Flame,
      color: 'text-red-500',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '⚔️ The Wailing Doom thirsts for inferior tactics...',
      icon: Sword,
      color: 'text-orange-500',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: "💀 Khaine's rage burns through your pathetic defenses...",
      icon: Skull,
      color: 'text-red-600',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '🔥 Young Aspect Warrior blood fuels ancient fury...',
      icon: Flame,
      color: 'text-orange-400',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'inspection',
      message: "⚡ The Avatar's molten form judges you unworthy...",
      icon: Eye,
      color: 'text-red-400',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'disapproval',
      message: '🗡️ Your clumsy mon-keigh tactics amuse the War God...',
      icon: Sword,
      color: 'text-orange-500',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '🔥 The Hand of Khaine reaches for your soul...',
      icon: Flame,
      color: 'text-red-500',
      duration: 4600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'analysis',
      message: '💥 Eldar superiority demonstrated in every movement...',
      icon: Brain,
      color: 'text-orange-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'ancient_wisdom',
      message: '⚔️ Ten thousand years of war mock your inexperience...',
      icon: Sword,
      color: 'text-red-400',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '🔥 The Shrine of Khaine burns with disappointment...',
      icon: Flame,
      color: 'text-orange-500',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '⚠️ Your primitive mind cannot comprehend perfection...',
      icon: AlertTriangle,
      color: 'text-red-500',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: "💀 The Avatar's footsteps herald your annihilation...",
      icon: Skull,
      color: 'text-orange-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'tactical_override',
      message: '🗡️ The Wailing Doom shifts forms to counter weakness...',
      icon: Sword,
      color: 'text-red-400',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: '🔥 Molten metal flows where strategy should be...',
      icon: Flame,
      color: 'text-orange-500',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'data_corruption',
      message: '⚡ Psychic flames reveal your tactical poverty...',
      icon: Zap,
      color: 'text-red-500',
      duration: 5400,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: "💥 Khaine's fury cannot be contained by data...",
      icon: Flame,
      color: 'text-orange-400',
      duration: 4700,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '⚔️ The War in Heaven was won with better tactics...',
      icon: Sword,
      color: 'text-red-400',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: "🔥 Your courage melts before the Avatar's gaze...",
      icon: Eye,
      color: 'text-orange-500',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '💀 Even Slaanesh shows more discipline...',
      icon: Skull,
      color: 'text-red-500',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '🗡️ The Bloody-Handed God demands better sacrifices...',
      icon: Sword,
      color: 'text-orange-500',
      duration: 5600,
      glitchIntensity: 'heavy'
    }
  ]
}

export const szarekhConfig: BossEasterEggConfig = {
  bossName: 'Szarekh',
  titleOverride: "SILENT KING'S ETERNAL JUDGMENT",
  primaryColor: 'text-green-400',
  secondaryColor: 'text-emerald-500',
  displayPattern: ['ETERNAL', 'SILENT', 'KING'],
  visualEffects: [
    { type: 'gauss_flayer', chance: 0.45, duration: 3000 },
    { type: 'scarab_swarm', chance: 0.35, duration: 4000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Primitive' },
    { original: /Guild/gi, translation: 'Lesser Dynasty' },
    { original: /Technology/gi, translation: 'Inferior Constructs' },
    { original: /Time/gi, translation: 'Irrelevant Measurement' },
    { original: /Victory/gi, translation: 'Inevitable Outcome' },
    { original: /Battle/gi, translation: 'Harvest Protocol' },
    { original: /Team/gi, translation: 'Canoptek Swarm' },
    { original: /Defense/gi, translation: 'Living Metal' },
    { original: /Death/gi, translation: 'Temporary Inconvenience' },
    { original: /Strategy/gi, translation: 'Dynasty Protocols' }
  ],
  interventions: [
    {
      type: 'ancient_wisdom',
      message: '👑 The Silent King observes... and finds you wanting...',
      icon: Crown,
      color: 'text-green-400',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '⚡ Sixty million years of experience judge your tactics...',
      icon: Zap,
      color: 'text-emerald-500',
      duration: 4800,
      glitchIntensity: 'light'
    },
    {
      type: 'inspection',
      message: '💀 Your organic limitations amuse the Triarch...',
      icon: Skull,
      color: 'text-green-300',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: "🤖 C'tan technology renders your efforts meaningless...",
      icon: Cpu,
      color: 'text-emerald-400',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: "⏳ Time itself bends to Szarekh's will...",
      icon: Brain,
      color: 'text-green-400',
      duration: 4600,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '👑 The last Silent King pities your ignorance...',
      icon: Crown,
      color: 'text-emerald-500',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'analysis',
      message: '⚡ Quantum calculations predict your failure...',
      icon: Cpu,
      color: 'text-green-300',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'tactical_override',
      message: '🏛️ Dynasty protocols override primitive thinking...',
      icon: Brain,
      color: 'text-emerald-400',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: '💀 Your brief existence cannot comprehend eternity...',
      icon: Skull,
      color: 'text-green-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'warning',
      message: '⚠️ Biotransference would improve your performance...',
      icon: AlertTriangle,
      color: 'text-emerald-500',
      duration: 4700,
      glitchIntensity: 'heavy'
    },
    {
      type: 'inspection',
      message: '🤖 Living metal adapts faster than your thoughts...',
      icon: Cpu,
      color: 'text-green-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'disapproval',
      message: '👑 The Triarch Praetorians enforce better discipline...',
      icon: Crown,
      color: 'text-emerald-400',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: '⏳ Chronometric manipulation detected... you already lost...',
      icon: Zap,
      color: 'text-green-400',
      duration: 5400,
      glitchIntensity: 'heavy'
    },
    {
      type: 'tactical_override',
      message: '⚡ Gauss technology strips away weak strategies...',
      icon: Crosshair,
      color: 'text-emerald-500',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: '💀 Even in death, we surpass your living mediocrity...',
      icon: Skull,
      color: 'text-green-300',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '🏛️ The Great Sleep was more productive than this...',
      icon: Brain,
      color: 'text-emerald-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'analysis',
      message: '🤖 Canoptek constructs show superior tactics...',
      icon: Cpu,
      color: 'text-green-400',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: "👑 Szarekh's regret: Wasting time on primitives...",
      icon: Crown,
      color: 'text-emerald-500',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: '⏳ Your civilization will fall before mastering this...',
      icon: Brain,
      color: 'text-green-300',
      duration: 4900,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: "⚡ The Silent King's judgment: Unworthy of preservation...",
      icon: Zap,
      color: 'text-emerald-500',
      duration: 5800,
      glitchIntensity: 'heavy'
    }
  ]
}

export const ghazghkullConfig: BossEasterEggConfig = {
  bossName: 'Ghazghkull',
  titleOverride: 'WAAAGH! ENERGY OVERLOAD',
  primaryColor: 'text-green-500',
  secondaryColor: 'text-yellow-500',
  displayPattern: ['WAAAGH!', 'DAKKA!', 'KRUMP!'],
  visualEffects: [
    { type: 'waaagh_energy', chance: 0.5, duration: 3500 },
    { type: 'dakka_holes', chance: 0.4, duration: 4000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Puny Git' },
    { original: /Guild/gi, translation: 'Mob' },
    { original: /Strategy/gi, translation: 'Kunning Plan' },
    { original: /Damage/gi, translation: 'Dakka Output' },
    { original: /Victory/gi, translation: 'Proper WAAAGH!' },
    { original: /Battle/gi, translation: "Krumpin' Time" },
    { original: /Team/gi, translation: 'Da Boyz' },
    { original: /Defense/gi, translation: 'Ard Armor' },
    { original: /Resources/gi, translation: 'Teef' },
    { original: /Score/gi, translation: 'Skullz Collected' }
  ],
  interventions: [
    {
      type: 'waaagh_energy',
      message: "💀 WAAAAAAGH! GHAZGHKULL IZ WATCHIN' YA!",
      icon: Skull,
      color: 'text-green-500',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'warning',
      message: '🔫 NOT ENUFF DAKKA! NEED MORE DAKKA!',
      icon: Crosshair,
      color: 'text-yellow-500',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '⚔️ YER TACKTIKS IZ WEAKER DAN A GROT!',
      icon: Sword,
      color: 'text-green-400',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'waaagh_energy',
      message: '💥 DA BOSS FINKS YER PLAN IZ RUBBISH!',
      icon: Flame,
      color: 'text-yellow-400',
      duration: 4500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'system_alert',
      message: "🦴 GORK AN' MORK ARE LAFFIN' AT YA!",
      icon: Skull,
      color: 'text-green-500',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'waaagh_energy',
      message: "⚡ GREEN IZ BEST! YER STRATEGY AIN'T GREEN!",
      icon: Zap,
      color: 'text-yellow-500',
      duration: 4000,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '💀 MAG URUK THRAKA KRUMPS BETTER PLANS!',
      icon: Skull,
      color: 'text-green-400',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '🔧 EVEN DA MEKBOYZ FINK YER STUPID!',
      icon: Cog,
      color: 'text-yellow-400',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'waaagh_energy',
      message: "⚔️ BRUTAL BUT KUNNING? NAH, JUS' WEAK!",
      icon: Sword,
      color: 'text-green-500',
      duration: 4600,
      glitchIntensity: 'heavy'
    },
    {
      type: 'tactical_override',
      message: "💥 NEEDS MORE KRUMPIN'! ALWAYS MORE!",
      icon: Flame,
      color: 'text-yellow-500',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '⚠️ WARNING: INSUFFICIENT WAAAGH ENERGY!',
      icon: AlertTriangle,
      color: 'text-green-400',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: "🦴 YER SKULL AIN'T WORTH COLLECTIN'!",
      icon: Skull,
      color: 'text-yellow-400',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'waaagh_energy',
      message: '🔫 DAKKA DAKKA DAKKA! (STILL NOT ENUFF!)',
      icon: Crosshair,
      color: 'text-green-500',
      duration: 4800,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '⚡ DA GREAT GREEN PROPHET SEES YER FAIL!',
      icon: Brain,
      color: 'text-yellow-500',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'disapproval',
      message: '💀 EVEN YARRICK FIGHTS BETTER DAN DIS!',
      icon: Skull,
      color: 'text-green-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '🔧 TELLYPORTA MALFUNCTION: YER FAULT!',
      icon: Cog,
      color: 'text-yellow-400',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'waaagh_energy',
      message: '⚔️ POWER KLAW REACHES FOR YER WEAK PLANS!',
      icon: Sword,
      color: 'text-green-500',
      duration: 4700,
      glitchIntensity: 'heavy'
    },
    {
      type: 'tactical_override',
      message: '💥 GOFF BRUTALITY BEATS YER FINKING!',
      icon: Flame,
      color: 'text-yellow-500',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message: "🦴 DA BEAST WUZ BIGGER! SO'Z HIS BRAIN!",
      icon: Brain,
      color: 'text-green-400',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'waaagh_energy',
      message: '💀 WAAAGH! GHAZGHKULL THRAKA IS DA BEST!',
      icon: Skull,
      color: 'text-yellow-500',
      duration: 6000,
      glitchIntensity: 'heavy'
    }
  ]
}
