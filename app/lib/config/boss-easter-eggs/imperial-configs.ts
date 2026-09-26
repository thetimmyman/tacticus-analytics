import {
  AlertTriangle,
  Brain,
  Cog,
  Cpu,
  Eye,
  Shield,
  Skull,
  Sword,
  Zap
} from 'lucide-react'
import type { BossEasterEggConfig } from './types'

export const dornConfig: BossEasterEggConfig = {
  bossName: 'Rogal Dorn',
  titleOverride: "PRAETORIAN'S TACTICAL ASSESSMENT",
  primaryColor: 'text-yellow-400',
  secondaryColor: 'text-gray-300',
  displayPattern: ['VII', 'FORTIFY', 'ENDURE'],
  visualEffects: [{ type: 'fortification', chance: 0.4, duration: 4000 }],
  translations: [
    { original: /Player/gi, translation: 'Battle-Brother' },
    { original: /Guild/gi, translation: 'Fortress-Chapter' },
    { original: /Damage/gi, translation: 'Siege Output' },
    { original: /Defense/gi, translation: 'Fortification Protocols' },
    { original: /Victory/gi, translation: 'The Wall Holds' },
    { original: /Battle/gi, translation: 'Siege Warfare' },
    { original: /Team/gi, translation: 'Siege Company' },
    { original: /Strategy/gi, translation: 'Codex Doctrine' },
    { original: /Position/gi, translation: 'Defensive Line' },
    { original: /Attack/gi, translation: 'Breach Protocol' }
  ],
  interventions: [
    {
      type: 'inspection',
      message: '🏰 The Praetorian of Terra evaluates your defenses...',
      icon: Shield,
      color: 'text-yellow-400',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'disapproval',
      message: "⚔️ Dorn's stoic gaze finds your tactics... wanting...",
      icon: Sword,
      color: 'text-gray-300',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'warning',
      message: '🛡️ Your fortifications would not hold against a gretchin...',
      icon: Shield,
      color: 'text-yellow-300',
      duration: 3800,
      glitchIntensity: 'light'
    },
    {
      type: 'ancient_wisdom',
      message: '🏗️ The Imperial Palace was built with more care...',
      icon: Brain,
      color: 'text-yellow-400',
      duration: 4200,
      glitchIntensity: 'light'
    },
    {
      type: 'tactical_override',
      message:
        '⚒️ Siege protocols activated: Your approach lacks foundation...',
      icon: Cog,
      color: 'text-gray-400',
      duration: 4600,
      glitchIntensity: 'medium'
    },
    {
      type: 'analysis',
      message: "🏰 The Phalanx's machine spirit questions your resolve...",
      icon: Cpu,
      color: 'text-yellow-500',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'disapproval',
      message: '📐 Geometric perfection absent from tactical deployment...',
      icon: Brain,
      color: 'text-gray-300',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '⚔️ Pain Glove treatment recommended for such failures...',
      icon: Skull,
      color: 'text-yellow-300',
      duration: 4400,
      glitchIntensity: 'medium'
    },
    {
      type: 'inspection',
      message: '🛡️ The Eternal Crusader judges your commitment weak...',
      icon: Shield,
      color: 'text-gray-400',
      duration: 3900,
      glitchIntensity: 'light'
    },
    {
      type: 'system_alert',
      message: '⚠️ Perturabo would exploit these obvious weaknesses...',
      icon: AlertTriangle,
      color: 'text-red-400',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '🏰 Your defensive lines crumble like sand...',
      icon: Shield,
      color: 'text-yellow-300',
      duration: 3600,
      glitchIntensity: 'light'
    },
    {
      type: 'tactical_override',
      message: "⚒️ Dorn's hammer finds the flaw in your strategy...",
      icon: Sword,
      color: 'text-gray-300',
      duration: 4300,
      glitchIntensity: 'medium'
    },
    {
      type: 'warning',
      message: '📏 Codex compliance: 12% - Unacceptable deviation...',
      icon: Brain,
      color: 'text-yellow-400',
      duration: 4100,
      glitchIntensity: 'medium'
    },
    {
      type: 'message',
      message: '🛡️ The Wall must hold! Your resolve falters...',
      icon: Shield,
      color: 'text-gray-400',
      duration: 3800,
      glitchIntensity: 'none'
    },
    {
      type: 'disapproval',
      message: '⚔️ Templar zeal absent from tactical execution...',
      icon: Sword,
      color: 'text-yellow-300',
      duration: 3700,
      glitchIntensity: 'light'
    },
    {
      type: 'inspection',
      message: '🏗️ Foundation inadequate for sustained engagement...',
      icon: Cog,
      color: 'text-gray-300',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'ancient_wisdom',
      message: "📐 Tactical geometry violates Dorn's principles...",
      icon: Brain,
      color: 'text-yellow-400',
      duration: 4500,
      glitchIntensity: 'medium'
    },
    {
      type: 'warning',
      message: '⚒️ Your fortress of data has critical weaknesses...',
      icon: Shield,
      color: 'text-gray-400',
      duration: 4200,
      glitchIntensity: 'medium'
    },
    {
      type: 'system_alert',
      message: '🛡️ The Last Wall protocol judges you unworthy...',
      icon: Shield,
      color: 'text-red-400',
      duration: 5200,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '🏰 Even Iron Warriors show better discipline...',
      icon: Skull,
      color: 'text-yellow-300',
      duration: 3900,
      glitchIntensity: 'light'
    }
  ]
}

export const cawlConfig: BossEasterEggConfig = {
  bossName: 'Belisarius Cawl',
  titleOverride: 'ARCHMAGOS CAWL',
  primaryColor: 'text-[var(--accent)]',
  secondaryColor: 'text-red-400',
  displayPattern: ['01001111', '01001101', '01001110', '01001001'], // OMNI in binary
  visualEffects: [
    { type: 'servo_skull', chance: 0.4, duration: 5000 },
    { type: 'binary_rain', chance: 0.35, duration: 4000 }
  ],
  translations: [
    { original: /Player/gi, translation: 'Adept' },
    { original: /Guild/gi, translation: 'Forge-Sect' },
    { original: /Damage/gi, translation: 'Sacred Output' },
    { original: /Battle/gi, translation: 'Engagement Protocol' },
    { original: /Victory/gi, translation: "Omnissiah's Blessing" },
    { original: /Loading/gi, translation: 'Communing with Machine Spirit' },
    { original: /Error/gi, translation: 'Heretical Disruption' },
    { original: /Success/gi, translation: 'Protocol Sanctified' },
    { original: /Data/gi, translation: 'Sacred Knowledge' },
    { original: /Statistics/gi, translation: 'Holy Calculations' },
    { original: /Performance/gi, translation: 'Efficiency Metrics' },
    { original: /Team/gi, translation: 'Servo-Skull Squadron' },
    { original: /Boss/gi, translation: 'Primary Target Designation' },
    { original: /Health/gi, translation: 'Structural Integrity' },
    { original: /Attack/gi, translation: 'Sacred Ordinance' },
    { original: /Strategy/gi, translation: 'Battle-Cant Protocol' },
    { original: /Formation/gi, translation: 'Sacred Geometry' },
    { original: /Equipment/gi, translation: 'Blessed Instruments' },
    { original: /Weapon/gi, translation: 'Sanctified Tool' },
    { original: /Shield/gi, translation: 'Aegis Protocol' },
    { original: /Level/gi, translation: 'Sanctification Tier' },
    { original: /Rank/gi, translation: 'Hierarchical Classification' },
    { original: /Score/gi, translation: 'Merit Designation' },
    { original: /Server/gi, translation: 'Sacred Cogitator' },
    { original: /Database/gi, translation: 'Memory Vault' },
    { original: /Network/gi, translation: 'Noospheric Grid' },
    { original: /Connection/gi, translation: 'Machine Spirit Link' },
    { original: /Update/gi, translation: 'Blessed Reconfiguration' },
    { original: /Save/gi, translation: 'Sanctify in Memory Banks' },
    { original: /Delete/gi, translation: 'Consign to Digital Pyre' }
  ],
  interventions: [
    {
      type: 'inspection',
      message:
        '🔧 The Archmagos examines your tactical choices with visible disappointment',
      icon: Cog,
      color: 'text-red-400',
      duration: 3500,
      glitchIntensity: 'none'
    },
    {
      type: 'disapproval',
      message: '⚙️ Your efficiency falls 47.3% below Mechanicus standards',
      icon: Cog,
      color: 'text-yellow-400',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'message',
      message:
        '🤖 Belisarius Cawl is calculating 10,000 ways to improve your strategy',
      icon: Cpu,
      color: 'text-[var(--accent)]',
      duration: 3000,
      glitchIntensity: 'none'
    },
    {
      type: 'curiosity',
      message: "👁️ The Omnissiah's chosen observes your primitive algorithms",
      icon: Eye,
      color: 'text-green-400',
      duration: 3500,
      glitchIntensity: 'light'
    },
    {
      type: 'warning',
      message: '⚠️ WARNING: Flesh-brain inefficiency detected',
      icon: AlertTriangle,
      color: 'text-red-500',
      duration: 3000,
      glitchIntensity: 'medium'
    },
    {
      type: 'glitch',
      message: '⚡ CRITICAL: Machine spirits rejecting your command protocols',
      icon: Zap,
      color: 'text-yellow-500',
      duration: 4500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'system_alert',
      message:
        '🔴 ALERT: Non-optimal patterns triggering Archmagos intervention',
      icon: AlertTriangle,
      color: 'text-red-600',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'ancient_wisdom',
      message: '📖 10,000 years of knowledge judges your tactics insufficient',
      icon: Brain,
      color: 'text-[var(--accent)]',
      duration: 4000,
      glitchIntensity: 'light'
    },
    {
      type: 'analysis',
      message: '🔬 Noospheric analysis reveals 823 tactical errors',
      icon: Brain,
      color: 'text-green-400',
      duration: 3800,
      glitchIntensity: 'medium'
    },
    {
      type: 'ancient_wisdom',
      message:
        "⚙️ The Omnissiah whispers: 'Your methodology lacks divine inspiration'",
      icon: Cpu,
      color: 'text-[var(--accent)]',
      duration: 5000,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: '💾 Cawl temporarily merges consciousness with your data...',
      icon: Zap,
      color: 'text-green-400',
      duration: 4000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'system_alert',
      message: '🔋 ARCHMAGOS INTERFACE: Direct neural link established',
      icon: Brain,
      color: 'text-[var(--accent)]',
      duration: 5500,
      glitchIntensity: 'heavy'
    },
    {
      type: 'disapproval',
      message: '💀 Even servitors show more tactical acumen',
      icon: Skull,
      color: 'text-red-500',
      duration: 3200,
      glitchIntensity: 'light'
    },
    {
      type: 'data_corruption',
      message: "⚡ Cawl's consciousness overrides display parameters...",
      icon: Zap,
      color: 'text-green-500',
      duration: 5000,
      glitchIntensity: 'heavy'
    },
    {
      type: 'curiosity',
      message: "🔍 Fascinating... You've discovered new depths of inefficiency",
      icon: Eye,
      color: 'text-yellow-400',
      duration: 3900,
      glitchIntensity: 'light'
    }
  ]
}
