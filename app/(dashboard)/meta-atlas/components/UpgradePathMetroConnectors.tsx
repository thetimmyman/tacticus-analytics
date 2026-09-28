'use client'

import { ArrowDown, ArrowRight, Minus, Plus } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { UpgradeStep } from '@/app/lib/meta/types'
import type { HeroMapping } from '../utils/hero-mapping'
import {
  inferSwapUnits,
  resolveSwapUnits,
  type SwapUnitInfo
} from './upgrade-path-metro-model'

function SwapUnitBadge({
  unit,
  variant
}: {
  unit: SwapUnitInfo
  variant: 'add' | 'remove'
}) {
  const isAdd = variant === 'add'
  const overlayClass = isAdd ? 'bg-emerald-500/30' : 'bg-rose-500/30'
  const ringClass = isAdd ? 'border-emerald-400/50' : 'border-rose-400/50'
  const badgeClass = isAdd
    ? 'bg-emerald-500 text-white'
    : 'bg-rose-500 text-white'
  const Icon = isAdd ? Plus : Minus

  return (
    <div className="relative h-8 w-8" title={unit.name}>
      <div
        className={`relative h-8 w-8 rounded-full border ${ringClass} bg-(--bg-secondary) overflow-hidden`}
      >
        {unit.icon_url ? (
          <img
            src={unit.icon_url}
            alt={unit.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] text-secondary-wh40k font-semibold">
            {unit.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className={`absolute inset-0 ${overlayClass}`} />
      </div>
      <div
        className={`absolute -bottom-1 -right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full ${badgeClass}`}
      >
        <Icon className="h-2.5 w-2.5" />
      </div>
    </div>
  )
}

export function StepDelta({
  step,
  heroMappings,
  compact
}: {
  step: UpgradeStep
  heroMappings?: Map<string, HeroMapping>
  compact?: boolean
}) {
  const rawSwapOut = (step.swap_out || step.swapped_out || '').trim()
  const rawSwapIn = (step.swap_in || step.swapped_in || '').trim()
  const inferred =
    !rawSwapOut || !rawSwapIn
      ? inferSwapUnits(step.from_team, step.to_team)
      : { swapOut: [] as string[], swapIn: [] as string[] }
  const swapOut = rawSwapOut || inferred.swapOut.join(', ')
  const swapIn = rawSwapIn || inferred.swapIn.join(', ')
  const gainValue =
    typeof step.damage_gain === 'number'
      ? step.damage_gain
      : typeof step.damage_increase === 'number'
        ? step.damage_increase
        : 0
  const roundedGain = Math.round(gainValue)
  const gainLabel = `${roundedGain >= 0 ? '+' : '-'}${formatNumber(Math.abs(roundedGain))}`
  const isLocked = step.is_owned === false
  const badgeClass = isLocked
    ? 'border-slate-500/40 bg-slate-500/10 text-primary-wh40k'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  const removeUnits = resolveSwapUnits(swapOut, heroMappings)
  const addUnits = resolveSwapUnits(swapIn, heroMappings)

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold ${badgeClass}`}
      >
        {gainLabel}
      </span>
      {compact ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {removeUnits.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {removeUnits.map((unit) => (
                <SwapUnitBadge
                  key={`delta-remove-${unit.name}`}
                  unit={unit}
                  variant="remove"
                />
              ))}
            </div>
          )}
          {removeUnits.length > 0 && addUnits.length > 0 && (
            <ArrowRight className="h-3 w-3 text-secondary-wh40k" />
          )}
          {addUnits.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              {addUnits.map((unit) => (
                <SwapUnitBadge
                  key={`delta-add-${unit.name}`}
                  unit={unit}
                  variant="add"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function StepConnector({
  step,
  heroMappings
}: {
  step: UpgradeStep
  heroMappings?: Map<string, HeroMapping>
}) {
  const rawSwapOut = (step.swap_out || step.swapped_out || '').trim()
  const rawSwapIn = (step.swap_in || step.swapped_in || '').trim()
  const inferred =
    !rawSwapOut || !rawSwapIn
      ? inferSwapUnits(step.from_team, step.to_team)
      : { swapOut: [] as string[], swapIn: [] as string[] }
  const swapOut = rawSwapOut || inferred.swapOut.join(', ')
  const swapIn = rawSwapIn || inferred.swapIn.join(', ')
  const gainValue =
    typeof step.damage_gain === 'number'
      ? step.damage_gain
      : typeof step.damage_increase === 'number'
        ? step.damage_increase
        : 0
  const roundedGain = Math.round(gainValue)
  const gainLabel = `${roundedGain >= 0 ? '+' : '-'}${formatNumber(Math.abs(roundedGain))}`
  const isLocked = step.is_owned === false
  const lineClass = isLocked
    ? 'from-slate-500/10 via-slate-400/70 to-slate-500/10'
    : 'from-emerald-500/10 via-emerald-400/70 to-emerald-500/10'
  const badgeClass = isLocked
    ? 'border-slate-500/40 bg-slate-500/10 text-primary-wh40k'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  const lineGlow = isLocked
    ? 'shadow-[0_0_12px_rgba(148,163,184,0.25)]'
    : 'shadow-[0_0_12px_rgba(16,185,129,0.25)]'
  const arrowRing = isLocked
    ? 'border-slate-500/40 text-primary-wh40k'
    : 'border-emerald-500/40 text-emerald-300'
  const removeUnits = resolveSwapUnits(swapOut, heroMappings)
  const addUnits = resolveSwapUnits(swapIn, heroMappings)
  const showSwapUnits = removeUnits.length > 0 || addUnits.length > 0

  return (
    <div className="group relative flex flex-col items-center gap-2 min-w-14 sm:min-w-18">
      <div
        className={`relative h-1.5 w-16 rounded-full bg-linear-to-r sm:h-2 sm:w-20 ${lineClass} ${lineGlow}`}
      >
        <div
          className={`absolute -top-2 left-1/2 -translate-x-1/2 flex h-6 w-6 items-center justify-center rounded-full border bg-(--bg-secondary) sm:h-7 sm:w-7 ${arrowRing}`}
        >
          <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        </div>
      </div>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold sm:text-[10px] ${badgeClass}`}
      >
        {gainLabel}
      </span>
      {showSwapUnits && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {removeUnits.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {removeUnits.map((unit) => (
                <SwapUnitBadge
                  key={`connector-remove-${unit.name}`}
                  unit={unit}
                  variant="remove"
                />
              ))}
            </div>
          )}
          {removeUnits.length > 0 && addUnits.length > 0 && (
            <ArrowRight className="h-3 w-3 text-secondary-wh40k" />
          )}
          {addUnits.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {addUnits.map((unit) => (
                <SwapUnitBadge
                  key={`connector-add-${unit.name}`}
                  unit={unit}
                  variant="add"
                />
              ))}
            </div>
          )}
        </div>
      )}
      {(swapOut || swapIn) && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-(--bg-secondary) px-2 py-1 text-[10px] text-primary-wh40k opacity-0 shadow-lg transition-opacity sm:-top-14 group-hover:opacity-100">
          <span className="text-red-400">{swapOut || 'Unknown'}</span>
          <ArrowRight className="inline-block h-3 w-3 text-secondary-wh40k mx-1" />
          <span className="text-emerald-300">{swapIn || 'Unknown'}</span>
        </div>
      )}
    </div>
  )
}

export function MobileSwapConnector({
  step,
  heroMappings
}: {
  step: UpgradeStep
  heroMappings?: Map<string, HeroMapping>
}) {
  const rawSwapOut = (step.swap_out || step.swapped_out || '').trim()
  const rawSwapIn = (step.swap_in || step.swapped_in || '').trim()
  const inferred =
    !rawSwapOut || !rawSwapIn
      ? inferSwapUnits(step.from_team, step.to_team)
      : { swapOut: [] as string[], swapIn: [] as string[] }
  const swapOut = rawSwapOut || inferred.swapOut.join(', ')
  const swapIn = rawSwapIn || inferred.swapIn.join(', ')
  const removeUnits = resolveSwapUnits(swapOut, heroMappings)
  const addUnits = resolveSwapUnits(swapIn, heroMappings)

  if (removeUnits.length === 0 && addUnits.length === 0) return null

  return (
    <div className="flex flex-col items-center gap-2 py-1">
      {removeUnits.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {removeUnits.map((unit) => (
            <SwapUnitBadge
              key={`mobile-remove-${unit.name}`}
              unit={unit}
              variant="remove"
            />
          ))}
        </div>
      )}
      <ArrowDown className="h-4 w-4 text-secondary-wh40k" />
      {addUnits.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {addUnits.map((unit) => (
            <SwapUnitBadge
              key={`mobile-add-${unit.name}`}
              unit={unit}
              variant="add"
            />
          ))}
        </div>
      )}
    </div>
  )
}
