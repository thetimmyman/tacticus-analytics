'use client'

import clsx from 'clsx'
import { Skull } from 'lucide-react'
import { Badge, Card, CardContent } from '@tacticus/ui-kit'
import type { Unit } from '../_types'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'

/** Compact K/M/B at >= COMPACT_K_THRESHOLD; below it locale formatting is invariant. */
const BILLION = 1_000_000_000
const MILLION = 1_000_000
const COMPACT_K_THRESHOLD = 10_000
const KILO = 1_000

export const formatNumber = (value: number): string => {
  const abs = Math.abs(value)
  if (abs >= BILLION)
    return `${(value / BILLION).toFixed(1).replace(/\.0$/, '')}B`
  if (abs >= MILLION)
    return `${(value / MILLION).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= COMPACT_K_THRESHOLD)
    return `${(value / KILO).toFixed(1).replace(/\.0$/, '')}K`
  // eslint-disable-next-line no-restricted-syntax -- toLocaleString used only for values < COMPACT_K_THRESHOLD where output is locale-invariant
  return value.toLocaleString()
}

export const formatPercent = (value: number): string => `${Math.round(value)}%`

export const getRateTone = (value: number, high = 70, low = 50): string => {
  if (value >= high) return 'text-green-400'
  if (value < low) return 'text-red-400'
  return 'text-yellow-400'
}

/**
 * Shared by UnitRow and ActivityTable so they agree. `remainingHp` > 0 alive, <= 0 dead; null = dead;
 * undefined = no data. A unit without HP is dead once any teammate has after-HP (matches `summarizeUnits`).
 */
const hasAfterHp = (unit: Unit): boolean => typeof unit.remainingHp === 'number'

const isAliveByHp = (unit: Unit): boolean =>
  typeof unit.remainingHp === 'number' && unit.remainingHp > 0

/** An explicit 0 counts. */
export function anyUnitHasHpAfter(units: Unit[]): boolean {
  return units.some(hasAfterHp)
}

export function hasHpEvidence(units: Unit[]): boolean {
  return units.some((u) => hasAfterHp(u) || u.remainingHp === null)
}

export function isUnitDefeatedByHp(
  unit: Unit,
  anyHasHpAfter: boolean
): boolean {
  if (hasAfterHp(unit)) return !isAliveByHp(unit)
  if (unit.remainingHp === null) return true
  return anyHasHpAfter
}

/** Null when the row has no HP data to infer from. */
export function countDefeatedUnits(units: Unit[]): number | null {
  if (units.length === 0 || !hasHpEvidence(units)) return null
  const anyHasHpAfter = anyUnitHasHpAfter(units)
  return units.filter((u) => isUnitDefeatedByHp(u, anyHasHpAfter)).length
}

export function UnitPortrait({
  unit,
  size = 'md',
  isDefeated = false,
  className
}: {
  unit: Unit
  size?: 'sm' | 'md' | 'lg'
  isDefeated?: boolean
  className?: string
}) {
  const sizeClasses = {
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-12 w-12 text-sm'
  }

  const hasHpBar =
    typeof unit.startingHp === 'number' &&
    unit.startingHp > 0 &&
    typeof unit.remainingHp === 'number' &&
    unit.remainingHp > 0 &&
    !isDefeated
  const hpPct = hasHpBar
    ? Math.max(0, Math.min(100, (unit.remainingHp! / unit.startingHp!) * 100))
    : 0
  // The game never reports attacker starting HP, so show absolute remaining HP instead of a percent.
  const hasRemainingOnly =
    !isDefeated &&
    !hasHpBar &&
    typeof unit.remainingHp === 'number' &&
    unit.remainingHp > 0
  const tooltipSuffix = isDefeated
    ? ' · Dead'
    : hasHpBar
      ? ` · ${unit.remainingHp}/${unit.startingHp} HP`
      : hasRemainingOnly
        ? ` · ${unit.remainingHp} HP left`
        : ''

  const circleClasses = clsx(
    sizeClasses[size],
    'rounded-full border border-(--border) flex items-center justify-center font-semibold uppercase overflow-hidden relative',
    isDefeated ? 'opacity-40 grayscale' : 'text-primary-wh40k'
  )

  const circle = unit.portraitUrl ? (
    <div
      className={circleClasses}
      style={{
        backgroundImage: `linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0.1)), url('${unit.portraitUrl}')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
      title={`${unit.name}${tooltipSuffix}`}
      role="img"
      aria-label={unit.name}
    >
      {isDefeated && (
        <Skull className="absolute h-4 w-4 text-[color-mix(in_srgb,var(--text-primary)_80%,transparent)] drop-shadow-xs" />
      )}
      <span className="sr-only">{unit.name}</span>
    </div>
  ) : (
    <div
      className={clsx(
        circleClasses,
        'bg-linear-to-br from-[color-mix(in_srgb,var(--accent)_20%,transparent)] to-[color-mix(in_srgb,var(--primary)_40%,transparent)]'
      )}
      title={`${unit.name}${tooltipSuffix}`}
    >
      {isDefeated ? (
        <Skull className="h-3 w-3 text-current" />
      ) : (
        <span>{unit.shortCode}</span>
      )}
    </div>
  )

  return (
    <div className={clsx('relative', className)}>
      {circle}
      {hasHpBar && (
        /* HP bar below the circle, 120% wide to extend past the icon edges. */
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-[120%] h-1.5 rounded-full bg-gray-700/70 overflow-hidden">
          <div
            className="h-full rounded-full bg-green-400"
            style={{ width: `${hpPct}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function UnitRow({
  units,
  size = 'md',
  defeatedUnitIds,
  allDefeated = false
}: {
  units: Unit[]
  size?: 'sm' | 'md' | 'lg'
  defeatedUnitIds?: string[]
  /** E.g. defenders on a successful attack. */
  allDefeated?: boolean
}) {
  const anyHasHpAfter = anyUnitHasHpAfter(units)

  return (
    <div className="flex items-center gap-1.5">
      {units.map((unit) => {
        const defeatedById = defeatedUnitIds?.includes(unit.id) ?? false
        const defeatedByHp = isUnitDefeatedByHp(unit, anyHasHpAfter)
        return (
          <UnitPortrait
            key={unit.id}
            unit={unit}
            size={size}
            isDefeated={allDefeated || defeatedById || defeatedByHp}
          />
        )
      })}
    </div>
  )
}

export function StatCard({
  label,
  value,
  tone,
  hint,
  tooltip
}: {
  label: string
  value: string
  tone?: string
  hint?: string
  tooltip?: string
}) {
  return (
    <Card className="border-(--border) bg-(--bg-primary)" title={tooltip}>
      <CardContent className="p-5 space-y-2">
        <div className="text-xs font-semibold text-secondary-wh40k uppercase tracking-wide">
          {label}
        </div>
        <div
          className={clsx('text-2xl font-bold', tone || 'text-primary-wh40k')}
        >
          {value}
        </div>
        {hint && <div className="text-xs text-(--text-tertiary)">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export function ScoreComparison({
  leftLabel,
  rightLabel,
  leftScore,
  rightScore,
  caption,
  captionTitle
}: {
  leftLabel: string
  rightLabel: string
  leftScore: number
  rightScore: number
  caption?: string
  captionTitle?: string
}) {
  const hasMounted = useHasMounted()
  const total = leftScore + rightScore
  const leftPercent = total > 0 ? (leftScore / total) * 100 : 50
  const rightPercent = 100 - leftPercent

  return (
    <Card className="border-(--border) bg-(--bg-primary)">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between text-sm text-secondary-wh40k">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
        <div className="h-3 rounded-full bg-(--bg-secondary) overflow-hidden border border-(--border)">
          <div
            className="h-full bg-linear-to-r from-emerald-400/70 to-emerald-500/40"
            style={{ width: `${leftPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-emerald-400">
            {hasMounted ? formatNumber(leftScore) : String(leftScore)} (
            {Math.round(leftPercent)}%)
          </span>
          <span className="font-semibold text-secondary-wh40k">
            {hasMounted ? formatNumber(rightScore) : String(rightScore)} (
            {Math.round(rightPercent)}%)
          </span>
        </div>
        {caption && (
          <div
            className="text-center text-xs text-(--text-tertiary)"
            title={captionTitle}
          >
            {caption}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function RateBadge({
  label,
  value,
  high = 70,
  low = 50
}: {
  label: string
  value: number
  high?: number
  low?: number
}) {
  const tone = getRateTone(value, high, low)
  const border =
    value >= high
      ? 'border-green-500/40'
      : value < low
        ? 'border-red-500/40'
        : 'border-yellow-500/40'
  return (
    <Badge className={clsx('bg-transparent', border, tone)}>
      {label}: {formatPercent(value)}
    </Badge>
  )
}
