'use client'

import { useRef, useState } from 'react'
import type { MouseEvent, TouchEvent } from 'react'
import type { RosterInputEntry } from '@/app/lib/meta/roster-input'
import {
  buildRosterLookup,
  evaluateStrengthState,
  type HeroRequirement,
  type StrengthState,
  type StrengthThresholds
} from '@/app/lib/meta/roster-strength'
import type { UpgradeStep } from '@/app/lib/meta/types'
import { parseTeamComposition } from './TeamComparisonView'
import { normalizeHeroKey, type HeroMapping } from '../utils/hero-mapping'
import {
  parseTeamUnits,
  type MetroTone,
  type PortraitMode,
  type StepInvestmentUnit,
  type StepStrengthInfo,
  type TeamUnitInfo
} from './upgrade-path-metro-model'
import { MetroNode, type AvailabilityTone } from './UpgradePathMetroNode'
import { StepDelta } from './UpgradePathMetroConnectors'

type UpgradePathMetroProps = {
  currentTeam?: string | null
  targetTeam?: string | null
  currentDamage?: number | null
  targetDamage?: number | null
  steps: UpgradeStep[]
  currentLabel?: string
  defaultActiveIndex?: number
  activeBadgeLabel?: string | null
  heroMappings?: Map<string, HeroMapping>
  rosterEntries?: RosterInputEntry[]
  strengthThresholds?: StrengthThresholds | null
  heroOverrides?: Map<string, HeroRequirement>
  overrideMetaTeam?: string | null
}

export function UpgradePathMetro({
  currentTeam,
  targetTeam,
  currentDamage,
  targetDamage,
  steps,
  currentLabel,
  defaultActiveIndex,
  activeBadgeLabel,
  heroMappings,
  rosterEntries,
  strengthThresholds,
  heroOverrides,
  overrideMetaTeam
}: UpgradePathMetroProps) {
  const safeSteps = Array.isArray(steps) ? steps : []
  const hasTargetNode = Boolean(targetTeam || targetDamage != null)
  const shouldShowFallback = hasTargetNode && !safeSteps.length
  const fallbackDelta =
    currentDamage != null && targetDamage != null
      ? targetDamage - currentDamage
      : 0
  const fallbackSteps: UpgradeStep[] = shouldShowFallback
    ? [
        {
          step_index: 1,
          from_team: currentTeam ?? '',
          to_team: targetTeam ?? currentTeam ?? '',
          swapped_out: '',
          swapped_in: '',
          swap_out: '',
          swap_in: '',
          damage_increase: fallbackDelta,
          damage_gain: fallbackDelta,
          percent_increase: 0,
          new_damage_p90: targetDamage ?? currentDamage ?? 0,
          meta_team: null,
          is_owned: null,
          next_node_id: ''
        }
      ]
    : []
  const displaySteps = safeSteps.length > 0 ? safeSteps : fallbackSteps

  const rosterLookup = buildRosterLookup(rosterEntries)
  const hasHeroOverrides = Boolean(heroOverrides && heroOverrides.size > 0)
  const resolvedOverrideKey = overrideMetaTeam
    ? normalizeHeroKey(overrideMetaTeam)
    : null
  const resolvedThresholds =
    strengthThresholds && strengthThresholds.source !== 'none'
      ? strengthThresholds
      : null
  const canScoreStrength = Boolean(
    rosterLookup.hasEntries && (resolvedThresholds || hasHeroOverrides)
  )

  const buildStrengthInfo = (
    composition: string | null | undefined,
    metaTeam?: string | null
  ): StepStrengthInfo | null => {
    if (!composition || !canScoreStrength) return null
    const units = parseTeamUnits(composition, heroMappings)
    if (units.length === 0) return null
    const unitStates = new Map<string, StrengthState>()
    const needsInvestment: StepInvestmentUnit[] = []
    const lockedUnits: StepInvestmentUnit[] = []
    const useOverrides =
      hasHeroOverrides &&
      (!resolvedOverrideKey ||
        !metaTeam ||
        normalizeHeroKey(metaTeam) === resolvedOverrideKey)
    const resolveHeroOverride = (unit: TeamUnitInfo) => {
      if (!useOverrides || !heroOverrides) return null
      const candidates = [unit.unitId, unit.displayName]
      for (const value of candidates) {
        if (!value) continue
        const key = normalizeHeroKey(value)
        if (!key) continue
        const override = heroOverrides.get(key)
        if (override) return override
      }
      return null
    }

    units.forEach((unit) => {
      const rosterEntry =
        rosterLookup.find(unit.unitId) ?? rosterLookup.find(unit.displayName)
      let state: StrengthState
      if (!rosterEntry) {
        state = 'Locked'
        lockedUnits.push({ ...unit, state })
      } else {
        const heroOverride = resolveHeroOverride(unit)
        state =
          evaluateStrengthState(
            rosterEntry.raw,
            resolvedThresholds,
            heroOverride
          ) ?? 'Invalid'
        if (state === 'Weak' || state === 'Invalid') {
          needsInvestment.push({ ...unit, state })
        }
      }

      const keys = [unit.unitId, unit.displayName]
      keys.forEach((value) => {
        if (!value) return
        const key = normalizeHeroKey(value)
        if (key) unitStates.set(key, state)
      })
    })

    return { unitStates, needsInvestment, lockedUnits }
  }

  const baselineTeam = currentTeam ?? displaySteps[0]?.from_team ?? null
  const inferredBaselineDamage =
    displaySteps[0]?.new_damage_p90 != null &&
    displaySteps[0]?.damage_increase != null
      ? displaySteps[0].new_damage_p90 - displaySteps[0].damage_increase
      : null
  const baselineDamage = currentDamage ?? inferredBaselineDamage ?? null

  type ProgressionState = {
    key: string
    label: string
    composition: string | null
    damage: number | null
    step: UpgradeStep | null
    isFinal: boolean
  }

  const states: ProgressionState[] = []
  if (baselineTeam) {
    states.push({
      key: 'baseline',
      label: currentLabel || 'Current Team',
      composition: baselineTeam,
      damage: baselineDamage,
      step: null,
      isFinal: displaySteps.length === 0
    })
  }

  displaySteps.forEach((step, index) => {
    const isFinal = index === displaySteps.length - 1
    const stepComposition = isFinal ? targetTeam || step.to_team : step.to_team
    states.push({
      key: `${step.step_index}-${index}`,
      label: isFinal ? 'Optimal' : `Step ${index + 1}`,
      composition: stepComposition || null,
      damage: step.new_damage_p90 ?? targetDamage ?? null,
      step,
      isFinal
    })
  })

  const stateStrengthMap = new Map<number, StepStrengthInfo>()
  if (canScoreStrength) {
    states.forEach((state, index) => {
      const strengthInfo = buildStrengthInfo(
        state.composition,
        state.step?.meta_team ?? overrideMetaTeam ?? null
      )
      if (strengthInfo) {
        stateStrengthMap.set(index, strengthInfo)
      }
    })
  }
  const resolvePortraitMode = (index: number): PortraitMode => {
    if (index === resolvedActiveIndex) return 'full'
    const distance = Math.abs(index - resolvedActiveIndex)
    if (states.length <= 5) {
      return 'compact'
    }
    if (states.length <= 7) {
      return distance <= 1 ? 'compact' : 'micro'
    }
    if (states.length <= 9) {
      return distance <= 1 ? 'micro' : 'hidden'
    }
    return 'hidden'
  }

  const hasOwnershipInfo = displaySteps.some((step) => step.is_owned !== null)
  const nextBestIndex = displaySteps.findIndex((step) => {
    if (hasOwnershipInfo && step.is_owned !== true) return false
    if (currentDamage != null && step.new_damage_p90 != null) {
      return step.new_damage_p90 > currentDamage
    }
    return true
  })
  const baselineOffset = baselineTeam ? 1 : 0
  const autoActiveIndex =
    nextBestIndex >= 0 ? nextBestIndex + baselineOffset : 0
  const clampIndex = (value: number) =>
    Math.max(0, Math.min(value, states.length - 1))
  const initialActiveIndex = clampIndex(defaultActiveIndex ?? autoActiveIndex)
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex)
  const [hasActiveSelection, setHasActiveSelection] = useState(false)
  const resolvedActiveIndex = hasActiveSelection
    ? activeIndex
    : initialActiveIndex

  const desktopRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Array<HTMLDivElement | null>>([])
  const touchStartRef = useRef<number | null>(null)

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!desktopRef.current || states.length <= 1) return
    let nearestIndex = resolvedActiveIndex
    let nearestDistance = Number.POSITIVE_INFINITY
    cardRefs.current.forEach((node, index) => {
      if (!node) return
      const rect = node.getBoundingClientRect()
      const center = rect.left + rect.width / 2
      const distance = Math.abs(event.clientX - center)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    })
    const nextIndex = clampIndex(nearestIndex)
    if (nextIndex !== resolvedActiveIndex) {
      setHasActiveSelection(true)
      setActiveIndex(nextIndex)
    }
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStartRef.current = event.touches[0]?.clientY ?? null
  }

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStartRef.current == null) return
    const endY = event.changedTouches[0]?.clientY ?? null
    if (endY == null) return
    const delta = endY - touchStartRef.current
    if (Math.abs(delta) > 35) {
      const nextIndex = clampIndex(
        delta > 0 ? resolvedActiveIndex - 1 : resolvedActiveIndex + 1
      )
      setHasActiveSelection(true)
      setActiveIndex(nextIndex)
    }
    touchStartRef.current = null
  }

  const resolveHeroes = (composition?: string | null) =>
    heroMappings && composition
      ? parseTeamComposition(composition, heroMappings)
      : []
  const resolveStateMeta = (state: ProgressionState, index: number) => {
    const strengthInfo = stateStrengthMap.get(index)
    const lockedUnits = strengthInfo?.lockedUnits ?? []
    const investmentUnits = strengthInfo?.needsInvestment ?? []
    const unitStates = strengthInfo?.unitStates ?? null
    const hasLockedUnits = lockedUnits.length > 0
    const hasInvestments = investmentUnits.length > 0
    const isLocked = hasLockedUnits || state.step?.is_owned === false
    const requires = hasLockedUnits
      ? lockedUnits.map((unit) => unit.displayName).join(', ')
      : isLocked
        ? state.step?.swap_in || state.step?.swapped_in
        : null
    const availabilityLabel = hasLockedUnits
      ? 'Locked'
      : hasInvestments
        ? 'Needs Investment'
        : state.step?.is_owned === true
          ? 'Available Now'
          : state.step?.is_owned === false
            ? 'Locked'
            : null
    const availabilityTone: AvailabilityTone = hasLockedUnits
      ? 'locked'
      : hasInvestments
        ? 'invest'
        : state.step?.is_owned === true
          ? 'available'
          : state.step?.is_owned === false
            ? 'locked'
            : null
    let tone: MetroTone = state.isFinal
      ? 'final'
      : index === 0
        ? 'current'
        : 'step'
    if (index === resolvedActiveIndex && !state.isFinal && index !== 0) {
      tone = 'next'
    }
    return {
      availabilityLabel,
      availabilityTone,
      investmentUnits,
      unitStates,
      isLocked,
      requires,
      tone
    }
  }

  if (displaySteps.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-[var(--text-secondary)]">
        No upgrade path available.
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="sm:hidden">
        <div
          className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-950/80 via-slate-900/70 to-slate-950/80 px-3 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.35)] space-y-3"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {states.map((state, index) => {
            const isActive = index === resolvedActiveIndex
            const meta = resolveStateMeta(state, index)
            return (
              <div
                key={`mobile-${state.key}`}
                className={`transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-60'}`}
                onClick={() => {
                  setHasActiveSelection(true)
                  setActiveIndex(index)
                }}
              >
                {state.step && (
                  <div className="flex items-center justify-center pb-2">
                    <StepDelta
                      step={state.step}
                      heroMappings={heroMappings}
                      compact={!isActive}
                    />
                  </div>
                )}
                <MetroNode
                  label={state.label}
                  damage={state.damage}
                  locked={meta.isLocked}
                  composition={state.composition}
                  heroes={resolveHeroes(state.composition)}
                  requires={meta.requires}
                  investmentUnits={meta.investmentUnits}
                  unitStates={meta.unitStates}
                  availabilityLabel={meta.availabilityLabel}
                  availabilityTone={meta.availabilityTone}
                  tone={meta.tone}
                  compact={!isActive}
                  portraitMode={resolvePortraitMode(index)}
                  activeBadgeLabel={
                    isActive ? (activeBadgeLabel ?? null) : null
                  }
                />
              </div>
            )
          })}
        </div>
      </div>
      <div className="relative hidden sm:block">
        <div className="relative min-w-full rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-slate-950/80 via-slate-900/70 to-slate-950/80 px-4 py-5 shadow-[0_12px_30px_rgba(0,0,0,0.35)] sm:px-10 sm:py-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_50%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(56,189,248,0.12),transparent_55%)]" />
          <div
            ref={desktopRef}
            onMouseMove={handleMouseMove}
            className="relative z-10 flex w-full items-end gap-3 pb-2"
          >
            {states.map((state, index) => {
              const isActive = index === resolvedActiveIndex
              const distance = Math.abs(index - resolvedActiveIndex)
              const meta = resolveStateMeta(state, index)
              const flexGrow = isActive ? 2.6 : distance === 1 ? 1.3 : 1
              const opacityClass = isActive
                ? 'opacity-100'
                : distance === 1
                  ? 'opacity-85'
                  : 'opacity-60'
              const scaleClass = isActive
                ? 'scale-[1.02]'
                : distance === 1
                  ? 'scale-[0.99]'
                  : 'scale-[0.97]'
              const zClass = isActive ? 'z-10' : 'z-0'
              return (
                <div
                  key={`desktop-${state.key}`}
                  ref={(node) => {
                    cardRefs.current[index] = node
                  }}
                  style={{ flexGrow, flexBasis: 0 }}
                  className={`flex min-w-0 flex-col items-center gap-2 origin-bottom cursor-pointer transition-[flex-grow,opacity,transform] duration-500 ease-out ${opacityClass} ${scaleClass} ${zClass}`}
                  onClick={() => {
                    setHasActiveSelection(true)
                    setActiveIndex(index)
                  }}
                >
                  {state.step && (
                    <StepDelta
                      step={state.step}
                      heroMappings={heroMappings}
                      compact={!isActive}
                    />
                  )}
                  <MetroNode
                    label={state.label}
                    damage={state.damage}
                    locked={meta.isLocked}
                    composition={state.composition}
                    heroes={resolveHeroes(state.composition)}
                    requires={meta.requires}
                    investmentUnits={meta.investmentUnits}
                    unitStates={meta.unitStates}
                    availabilityLabel={meta.availabilityLabel}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    availabilityTone={meta.availabilityTone as any}
                    tone={meta.tone}
                    compact={!isActive}
                    portraitMode={resolvePortraitMode(index)}
                    activeBadgeLabel={
                      isActive ? (activeBadgeLabel ?? null) : null
                    }
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
