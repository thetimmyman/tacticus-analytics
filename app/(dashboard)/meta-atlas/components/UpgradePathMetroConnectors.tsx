'use client'

import { ArrowRight, Minus, Plus } from 'lucide-react'
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
