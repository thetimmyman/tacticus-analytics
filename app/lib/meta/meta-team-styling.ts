// Keyed by MetaBadgeLabel so TypeScript flags a key missing after meta-team-names.ts changes.

import type { MetaBadgeLabel } from './meta-team-names'

type StylingMap = Record<MetaBadgeLabel, string>

const META_TEAM_BASE_COLORS: StylingMap = {
  Admech: 'bg-red-600/20 text-red-400 border-red-600/30',
  Battlesuits: 'bg-white/90 text-red-600 border-black/50',
  Custodes: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  'Double Howl': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  Forcasmo: 'bg-emerald-800/20 text-emerald-400 border-emerald-800/30',
  Lavstodes: 'bg-black/80 text-pink-400 border-pink-500/50',
  "Neuro / Z'Kar": 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Orkz: 'bg-green-500/20 text-green-400 border-green-500/30',
  Abaddon: 'bg-black/80 text-amber-400 border-red-500/50',
  Helbrecht: 'bg-black/80 text-white border-white/40',
  Atlacoya: 'bg-amber-500/20 text-blue-400 border-blue-500/40',
  Other: 'bg-gray-400/20 text-gray-300 border-gray-500/30'
}

const META_TEAM_SELECTED_COLORS: StylingMap = {
  Admech: 'bg-red-600/40 text-red-300 border-red-400',
  Battlesuits: 'bg-white text-red-500 border-black',
  Custodes: 'bg-amber-500/40 text-amber-200 border-amber-400',
  'Double Howl': 'bg-slate-500/40 text-slate-200 border-slate-300',
  Forcasmo: 'bg-emerald-800/40 text-emerald-300 border-emerald-600',
  Lavstodes: 'bg-black text-pink-300 border-pink-500',
  "Neuro / Z'Kar": 'bg-purple-600/40 text-purple-300 border-purple-400',
  Orkz: 'bg-green-500/40 text-green-300 border-green-400',
  Abaddon: 'bg-black text-amber-300 border-red-500',
  Helbrecht: 'bg-black text-white border-white',
  Atlacoya: 'bg-amber-500/40 text-blue-300 border-blue-400',
  Other: 'bg-gray-400/40 text-gray-200 border-gray-300'
}

const DEFAULT_BASE_COLOR = META_TEAM_BASE_COLORS.Other
const DEFAULT_SELECTED_COLOR = META_TEAM_SELECTED_COLORS.Other

function resolveColor(teamName: string, isSelected: boolean): string {
  const map = isSelected ? META_TEAM_SELECTED_COLORS : META_TEAM_BASE_COLORS
  const fallback = isSelected ? DEFAULT_SELECTED_COLOR : DEFAULT_BASE_COLOR
  return (map as Record<string, string>)[teamName] ?? fallback
}

export function getMetaTeamBadgeClasses(
  teamName: string,
  isSelected: boolean
): string {
  const interactiveClasses = isSelected
    ? 'ring-2 ring-offset-1 ring-offset-slate-900'
    : 'hover:opacity-80'
  return `${resolveColor(teamName, isSelected)} ${interactiveClasses}`
}

export function getMetaTeamColorClasses(
  teamName: string,
  isSelected: boolean
): string {
  return resolveColor(teamName, isSelected)
}
