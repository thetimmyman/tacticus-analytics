'use client'

import { Users, Trophy } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { resolveHeroMapping, type HeroMapping } from '../utils/hero-mapping'

type HeroInfo = {
  name: string
  icon_url?: string | null
}

type TeamComparisonViewProps = {
  yourTeam: {
    heroes: HeroInfo[]
    damage: number | null
    label?: string
  } | null
  globalTeam: {
    heroes: HeroInfo[]
    damage: number | null
    label?: string
  } | null
  heroMappings: Map<string, HeroMapping>
}

function HeroCircle({
  hero,
  isYourTeam
}: {
  hero: HeroInfo
  isYourTeam: boolean
}) {
  return (
    <div
      className={`w-12 h-12 rounded-full border-2 flex items-center justify-center relative overflow-hidden group ${
        isYourTeam
          ? 'border-emerald-500 bg-[var(--card-bg)]'
          : 'border-white/20 bg-[var(--card-bg)]'
      }`}
      title={hero.name}
    >
      {isYourTeam && (
        <div className="absolute inset-0 bg-emerald-500/20 opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
      {hero.icon_url ? (
        <img
          src={hero.icon_url}
          alt={hero.name}
          className="w-10 h-10 rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className={`w-8 h-8 rounded-full border ${isYourTeam ? 'bg-slate-700 border-white/10' : 'bg-[var(--card-bg)] border-white/5'}`}
        />
      )}
    </div>
  )
}

function parseTeamComposition(
  composition: string | null | undefined,
  heroMappings: Map<string, HeroMapping>
): HeroInfo[] {
  if (!composition) return []

  const parts = composition.split(' + ')
  const heroesPart = parts[0] || ''
  const mowPart = parts[1]?.trim() || null

  const heroNames = heroesPart
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)

  if (mowPart) {
    heroNames.push(mowPart)
  }

  return heroNames.map((name) => {
    const mapping = resolveHeroMapping(name, heroMappings)
    return {
      name: mapping?.display_name || name,
      icon_url: mapping?.web_icon_url || null
    }
  })
}

export function TeamComparisonView({
  yourTeam,
  globalTeam,
  heroMappings: _heroMappings
}: TeamComparisonViewProps) {
  void _heroMappings
  const yourHeroes = yourTeam?.heroes || []
  const globalHeroes = globalTeam?.heroes || []

  const damageGap = (globalTeam?.damage || 0) - (yourTeam?.damage || 0)
  const showGap =
    yourTeam?.damage != null && globalTeam?.damage != null && damageGap > 0

  return (
    <div className="flex flex-col md:flex-row gap-8 py-4">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
            {yourTeam?.label || 'Your Team'}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {yourHeroes.length > 0
            ? yourHeroes.map((hero) => (
                <HeroCircle
                  key={`your-hero-${hero.name}`}
                  hero={hero}
                  isYourTeam
                />
              ))
            : ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'].map(
                (slotId) => (
                  <div
                    key={`placeholder-your-${slotId}`}
                    className="w-12 h-12 rounded-full border-2 border-dashed border-[var(--card-border)] bg-card/50 flex items-center justify-center"
                  >
                    <span className="text-[var(--text-secondary)] text-xs">
                      ?
                    </span>
                  </div>
                )
              )}
        </div>
        {yourTeam?.damage != null && (
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            P90:{' '}
            <span className="text-emerald-400 font-semibold">
              {formatNumber(yourTeam.damage)}
            </span>
          </div>
        )}
      </div>

      <div className="hidden md:flex items-center justify-center px-4">
        <div className="w-[1px] h-20 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
      </div>

      <div className="flex-1">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-widest">
            {globalTeam?.label || 'Global #1 Team'}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap">
          {globalHeroes.length > 0
            ? globalHeroes.map((hero) => (
                <HeroCircle
                  key={`global-hero-${hero.name}`}
                  hero={hero}
                  isYourTeam={false}
                />
              ))
            : ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'].map(
                (slotId) => (
                  <div
                    key={`placeholder-global-${slotId}`}
                    className="w-12 h-12 rounded-full border border-dashed border-[var(--card-border)] bg-card/50 flex items-center justify-center"
                  >
                    <span className="text-[var(--text-secondary)] text-xs">
                      ?
                    </span>
                  </div>
                )
              )}
        </div>
        {globalTeam?.damage != null && (
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            P90:{' '}
            <span className="text-yellow-400 font-semibold">
              {formatNumber(globalTeam.damage)}
            </span>
          </div>
        )}
      </div>

      {showGap && (
        <div className="px-6 py-4 rounded-xl bg-white/5 border border-white/10 flex flex-col justify-center min-w-[120px]">
          <span className="text-[10px] uppercase text-[var(--text-secondary)] font-bold mb-1">
            Gap
          </span>
          <span className="text-2xl font-bold text-emerald-400">
            +{formatNumber(damageGap)}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            Potential Gain
          </span>
        </div>
      )}
    </div>
  )
}

export { parseTeamComposition }
