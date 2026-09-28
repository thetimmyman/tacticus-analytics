'use client'

import { Lock, Unlock } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { StrengthState } from '@/app/lib/meta/roster-strength'
import { normalizeHeroKey } from '../utils/hero-mapping'
import type {
  HeroInfo,
  MetroTone,
  PortraitMode,
  StepInvestmentUnit,
  TeamUnitInfo
} from './upgrade-path-metro-model'

export type MetroNodeProps = {
  label: string
  damage: number | null
  locked: boolean
  composition?: string | null
  heroes?: HeroInfo[]
  requires?: string | null
  investmentUnits?: StepInvestmentUnit[]
  unitStates?: Map<string, StrengthState> | null
  availabilityLabel?: string | null
  availabilityTone?: 'available' | 'locked' | 'invest' | null
  tone?: MetroTone
  compact?: boolean
  portraitMode?: PortraitMode
  activeBadgeLabel?: string | null
  className?: string
}

export type AvailabilityTone = MetroNodeProps['availabilityTone']

const toneStyles: Record<
  string,
  {
    card: string
    label: string
    kicker: string
    icon: string
    iconRing: string
    glow: string
  }
> = {
  current: {
    card: 'border-sky-400/40 bg-sky-500/10',
    label: 'text-sky-100',
    kicker: 'text-sky-300/80',
    icon: 'text-sky-300',
    iconRing:
      'border-sky-400/50 bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)]',
    glow: 'bg-sky-400/20'
  },
  next: {
    card: 'border-emerald-400/40 bg-emerald-500/10',
    label: 'text-emerald-100',
    kicker: 'text-emerald-300/80',
    icon: 'text-emerald-300',
    iconRing:
      'border-emerald-400/50 bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)]',
    glow: 'bg-emerald-400/20'
  },
  final: {
    card: 'border-amber-400/40 bg-amber-500/10',
    label: 'text-amber-100',
    kicker: 'text-amber-300/80',
    icon: 'text-amber-300',
    iconRing:
      'border-amber-400/50 bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)]',
    glow: 'bg-amber-400/20'
  },
  step: {
    card: 'border-white/10 bg-white/5',
    label: 'text-slate-100',
    kicker: 'text-secondary-wh40k',
    icon: 'text-primary-wh40k',
    iconRing:
      'border-white/10 bg-[color-mix(in_srgb,var(--bg-secondary)_70%,transparent)]',
    glow: 'bg-slate-500/10'
  },
  locked: {
    card: 'border-card-border/70 bg-[color-mix(in_srgb,var(--bg-secondary)_70%,transparent)]',
    label: 'text-secondary-wh40k',
    kicker: 'text-secondary-wh40k',
    icon: 'text-secondary-wh40k',
    iconRing: 'border-(--card-border) bg-(--bg-secondary)',
    glow: 'bg-card/20'
  }
}

type StrengthBadgeKey = StrengthState | 'Unknown'

const strengthBadgeStyles: Record<
  StrengthBadgeKey,
  { label: string; className: string }
> = {
  Optimal: {
    label: 'Optimal',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  },
  Strong: {
    label: 'Strong',
    className: 'border-sky-500/40 bg-sky-500/10 text-sky-200'
  },
  Suitable: {
    label: 'Suitable',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-200'
  },
  Weak: {
    label: 'Weak',
    className: 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  },
  Locked: {
    label: 'Locked',
    className: 'border-slate-500/40 bg-slate-500/10 text-primary-wh40k'
  },
  Invalid: {
    label: 'Invalid',
    className: 'border-red-500/40 bg-red-500/10 text-red-200'
  },
  Unknown: {
    label: 'Unknown',
    className: 'border-(--card-border) bg-card/50 text-secondary-wh40k'
  }
}

const resolveStrengthBadge = (
  state: StrengthState | null | undefined
): { label: string; className: string } | null => {
  if (!state) return null
  const key: StrengthBadgeKey = state === 'Invalid' ? 'Unknown' : state
  return strengthBadgeStyles[key] ?? strengthBadgeStyles.Unknown
}

export function MetroNode({
  label,
  damage,
  locked,
  composition,
  heroes,
  requires,
  investmentUnits,
  unitStates,
  availabilityLabel,
  availabilityTone,
  tone = 'step',
  compact = false,
  portraitMode = 'hidden',
  activeBadgeLabel,
  className
}: MetroNodeProps) {
  const resolvedTone = locked ? 'locked' : tone
  const fallbackStyle = toneStyles.step ?? {
    card: '',
    label: '',
    kicker: '',
    icon: '',
    iconRing: '',
    glow: ''
  }
  const style = toneStyles[resolvedTone] ?? fallbackStyle
  const showDetails = !compact
  const resolvedPortraitMode: PortraitMode = showDetails ? 'full' : portraitMode
  const showHeroes = resolvedPortraitMode !== 'hidden'
  const availabilityClass =
    availabilityTone === 'locked'
      ? 'border-slate-500/40 bg-slate-500/10 text-primary-wh40k'
      : availabilityTone === 'invest'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  const investmentKeys = new Set<string>()
  investmentUnits?.forEach((unit) => {
    const candidates = [unit.unitId, unit.displayName]
    candidates.forEach((value) => {
      if (!value) return
      const key = normalizeHeroKey(value)
      if (key) investmentKeys.add(key)
    })
  })
  const resolveUnitState = (name: string): StrengthState | null => {
    if (!unitStates) return null
    const key = normalizeHeroKey(name)
    if (!key) return 'Invalid'
    return unitStates.get(key) ?? 'Invalid'
  }
  const heroSizeClass =
    resolvedPortraitMode === 'micro'
      ? 'h-5 w-5 sm:h-6 sm:w-6'
      : resolvedPortraitMode === 'compact'
        ? 'h-6 w-6 sm:h-7 sm:w-7'
        : 'h-7 w-7 sm:h-8 sm:w-8'
  const heroGapClass =
    resolvedPortraitMode === 'micro' ? 'gap-1 sm:gap-1.5' : 'gap-1.5 sm:gap-2'
  const badgeSizeClass =
    resolvedPortraitMode === 'micro'
      ? 'text-[5px] sm:text-[6px]'
      : resolvedPortraitMode === 'compact'
        ? 'text-[6px] sm:text-[7px]'
        : 'text-[7px] sm:text-[8px]'
  const labelClass = `uppercase tracking-wide ${style.kicker} ${
    compact
      ? 'text-[9px] sm:text-[10px] truncate max-w-20'
      : 'text-[10px] sm:text-[11px]'
  }`
  const damageClass = `${style.label} font-semibold ${
    compact
      ? 'text-sm sm:text-base truncate max-w-20 mx-auto'
      : 'text-lg sm:text-xl'
  }`

  return (
    <div
      className={`relative flex flex-col items-center w-full min-w-0 ${className || ''}`}
    >
      {!locked && (
        <div
          className={`absolute -inset-2 rounded-2xl blur-xl opacity-70 ${style.glow}`}
        />
      )}
      <div
        className={`relative z-10 flex w-full flex-col items-center gap-2 rounded-2xl border ${compact ? 'px-3 py-3' : 'px-4 py-4 sm:px-5 sm:py-5'} backdrop-blur-sm sm:gap-3 ${style.card}`}
      >
        {activeBadgeLabel && showDetails && (
          <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-200">
            {activeBadgeLabel}
          </span>
        )}
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full border sm:h-12 sm:w-12 ${style.iconRing}`}
        >
          {locked ? (
            <Lock className={`h-5 w-5 sm:h-6 sm:w-6 ${style.icon}`} />
          ) : (
            <Unlock className={`h-5 w-5 sm:h-6 sm:w-6 ${style.icon}`} />
          )}
        </div>
        <div className="text-center">
          <div className={labelClass}>{label}</div>
          <div className={damageClass}>
            {damage != null ? formatNumber(Math.round(damage)) : '--'}
          </div>
          {showHeroes && heroes && heroes.length > 0 ? (
            <div
              className={`mt-2 flex flex-nowrap max-w-full overflow-hidden justify-center ${heroGapClass} sm:mt-3 ${locked ? 'opacity-70 grayscale' : ''}`}
            >
              {heroes.map((hero) => {
                const unitState = resolveUnitState(hero.name)
                const badge = resolveStrengthBadge(unitState)
                return (
                  <div
                    key={`hero-portrait-${hero.name}`}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className={`rounded-full border overflow-hidden flex items-center justify-center ${heroSizeClass} ${
                        locked
                          ? 'border-(--card-border) bg-(--bg-secondary)'
                          : investmentKeys.has(normalizeHeroKey(hero.name))
                            ? 'border-rose-400/70 bg-rose-500/10'
                            : 'border-white/20 bg-card/70'
                      }`}
                      title={
                        investmentKeys.has(normalizeHeroKey(hero.name))
                          ? `${hero.name} (Needs investment)`
                          : hero.name
                      }
                    >
                      {hero.icon_url ? (
                        <img
                          src={hero.icon_url}
                          alt={hero.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[8px] text-secondary-wh40k font-semibold sm:text-[9px]">
                          {hero.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    {badge && (
                      <span
                        className={`inline-flex items-center justify-center rounded-full border px-1 py-0.5 font-semibold leading-none whitespace-nowrap ${badgeSizeClass} ${badge.className}`}
                        title={badge.label}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : showDetails && composition ? (
            <div
              className={`mt-2 text-[10px] ${locked ? 'text-secondary-wh40k' : 'text-primary-wh40k'} truncate max-w-44 sm:text-[11px] sm:max-w-48`}
              title={composition}
            >
              {composition}
            </div>
          ) : null}
        </div>
        {showDetails && availabilityLabel && (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${availabilityClass}`}
          >
            {availabilityLabel}
          </span>
        )}
        {showDetails && locked && requires && (
          <span className="text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/20">
            Requires {requires}
          </span>
        )}
      </div>
    </div>
  )
}

type MobileTeamNodeProps = {
  label: string
  damage: number | null
  units: TeamUnitInfo[]
  unitStates?: Map<string, StrengthState> | null
  swapKeys?: Set<string> | null
  swapTone?: 'remove' | 'add' | null
}

const hasUnitKeyMatch = (unit: TeamUnitInfo, keys: Set<string>): boolean => {
  const candidates = [unit.unitId, unit.displayName]
  return candidates.some((value) => {
    if (!value) return false
    const key = normalizeHeroKey(value)
    return key ? keys.has(key) : false
  })
}

export function _MobileTeamNode({
  label,
  damage,
  units,
  unitStates,
  swapKeys,
  swapTone
}: MobileTeamNodeProps) {
  const resolveUnitState = (unit: TeamUnitInfo): StrengthState | null => {
    if (!unitStates) return null
    const key = normalizeHeroKey(unit.unitId || unit.displayName)
    if (!key) return 'Invalid'
    return unitStates.get(key) ?? 'Invalid'
  }
  const swapClass =
    swapTone === 'remove'
      ? 'border-rose-400/70 bg-rose-500/10'
      : 'border-emerald-400/70 bg-emerald-500/10'

  return (
    <div className="rounded-xl border border-white/10 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] px-3 py-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-secondary-wh40k">
        <span>{label}</span>
        <span className="text-emerald-200">
          {damage != null ? formatNumber(Math.round(damage)) : '--'}
        </span>
      </div>
      {units.length > 0 ? (
        <div className="mt-2 grid grid-cols-6 gap-1.5">
          {units.map((unit) => {
            const unitState = resolveUnitState(unit)
            const badge = resolveStrengthBadge(unitState)
            const isSwap = swapKeys ? hasUnitKeyMatch(unit, swapKeys) : false
            const borderClass = isSwap
              ? swapClass
              : 'border-white/20 bg-card/70'

            return (
              <div
                key={`mobile-unit-${unit.unitId || unit.displayName}`}
                className="flex flex-col items-center gap-1"
              >
                <div
                  className={`h-7 w-7 rounded-full border overflow-hidden flex items-center justify-center ${borderClass}`}
                  title={unit.displayName}
                >
                  {unit.iconUrl ? (
                    <img
                      src={unit.iconUrl}
                      alt={unit.displayName}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="text-[8px] text-secondary-wh40k font-semibold">
                      {unit.displayName.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                {badge && (
                  <span
                    className={`inline-flex items-center justify-center rounded-full border px-1 py-0.5 text-[7px] font-semibold leading-none whitespace-nowrap ${badge.className}`}
                    title={badge.label}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-secondary-wh40k">
          No team data available.
        </div>
      )}
    </div>
  )
}
