// Explicit `remainingHp: 0` is death evidence, matching `summarizeUnits`.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Unit } from '@/app/(dashboard)/wars/_types'
import {
  anyUnitHasHpAfter,
  countDefeatedUnits,
  hasHpEvidence,
  isUnitDefeatedByHp,
  UnitRow
} from '@/app/(dashboard)/wars/_components/war-shared'

const unit = (id: string, remainingHp?: number | null): Unit => ({
  id,
  name: id,
  shortCode: id.slice(0, 2).toUpperCase(),
  ...(remainingHp === undefined ? {} : { remainingHp })
})

const skullCount = (container: HTMLElement): number =>
  container.querySelectorAll('svg.lucide-skull').length

describe('hasHpEvidence', () => {
  it('treats an explicit zero as HP evidence', () => {
    expect(hasHpEvidence([unit('a', 0), unit('b', 0)])).toBe(true)
  })

  it('still finds evidence in positive HP and explicit nulls', () => {
    expect(hasHpEvidence([unit('a', 500)])).toBe(true)
    expect(hasHpEvidence([unit('a', null)])).toBe(true)
  })

  it('finds no evidence when every unit lacks HP data', () => {
    expect(hasHpEvidence([unit('a'), unit('b')])).toBe(false)
    expect(hasHpEvidence([])).toBe(false)
  })
})

describe('anyUnitHasHpAfter', () => {
  it('counts an explicit zero as after-HP data', () => {
    expect(anyUnitHasHpAfter([unit('a', 0), unit('b')])).toBe(true)
  })

  it('does not count nulls or absent HP as after-HP data', () => {
    expect(anyUnitHasHpAfter([unit('a', null), unit('b')])).toBe(false)
  })
})

describe('isUnitDefeatedByHp', () => {
  it('marks a unit with zero after-HP as defeated', () => {
    expect(isUnitDefeatedByHp(unit('a', 0), true)).toBe(true)
    expect(isUnitDefeatedByHp(unit('a', 0), false)).toBe(true)
  })

  it('keeps a unit with positive after-HP alive', () => {
    expect(isUnitDefeatedByHp(unit('a', 250), true)).toBe(false)
  })

  it('marks an explicit null as defeated and an unknown as inferable only', () => {
    expect(isUnitDefeatedByHp(unit('a', null), false)).toBe(true)
    expect(isUnitDefeatedByHp(unit('a'), true)).toBe(true)
    expect(isUnitDefeatedByHp(unit('a'), false)).toBe(false)
  })
})

describe('countDefeatedUnits', () => {
  it('counts every attacker when all report explicit zero HP', () => {
    // Null would render Deaths as '—'.
    expect(countDefeatedUnits([unit('a', 0), unit('b', 0), unit('c', 0)])).toBe(
      3
    )
  })

  it('counts only the nonpositive units on a mixed zero/positive row', () => {
    expect(
      countDefeatedUnits([unit('a', 0), unit('b', 1200), unit('c', 0)])
    ).toBe(2)
  })

  it('counts units missing HP as dead once a teammate reports zero HP', () => {
    // Any after-HP means the feed reports per unit, so an omission is a death.
    expect(countDefeatedUnits([unit('a', 0), unit('b')])).toBe(2)
  })

  it('returns null when the row carries no HP data at all', () => {
    expect(countDefeatedUnits([unit('a'), unit('b')])).toBeNull()
    expect(countDefeatedUnits([])).toBeNull()
  })

  it('still counts survivors and omissions on positive-HP rows', () => {
    expect(countDefeatedUnits([unit('a', 900), unit('b'), unit('c')])).toBe(2)
  })
})

describe('UnitRow skulls', () => {
  it('draws a skull for every unit when all report explicit zero HP', () => {
    const { container } = render(
      <UnitRow units={[unit('a', 0), unit('b', 0)]} />
    )
    expect(skullCount(container)).toBe(2)
  })

  it('skulls only the zero-HP units on a mixed row', () => {
    const { container } = render(
      <UnitRow units={[unit('a', 0), unit('b', 1200)]} />
    )
    expect(skullCount(container)).toBe(1)
    expect(screen.getByTitle('b · 1200 HP left')).toBeTruthy()
  })

  it('draws no skulls when no unit carries HP data', () => {
    const { container } = render(<UnitRow units={[unit('a'), unit('b')]} />)
    expect(skullCount(container)).toBe(0)
  })
})
