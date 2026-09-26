import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ActivityFilterBar, {
  applyActivityFilters,
  DEFAULT_FILTERS,
  type ActivityFilters
} from '@/app/(dashboard)/wars/_components/ActivityFilterBar'
import type { RecentAttempt } from '@/app/(dashboard)/wars/_types'

/** Keyed on raw `zone_type`: the three Frontline zones share one localized name. */
const attempt = (id: string, zoneType: string): RecentAttempt => ({
  id,
  attacker: { name: `Attacker ${id}`, guildTag: 'ATK' },
  defender: { name: `Defender ${id}`, guildTag: 'DEF' },
  attackerUnits: [],
  defenderUnits: [],
  zoneType,
  score: 1000,
  kills: 1,
  buffLevel: 0,
  time: '2026-08-01T12:00:00Z',
  isGuildMember: true,
  isPerfect: false,
  isFailed: false
})

const attempts: RecentAttempt[] = [
  attempt('a1', 'Trenches1'),
  attempt('a2', 'Trenches2'),
  attempt('a3', 'Trenches3'),
  attempt('a4', 'ComsStation'),
  attempt('a5', 'Trenches2')
]

const filters = (
  overrides: Partial<ActivityFilters> = {}
): ActivityFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides
})

describe('applyActivityFilters — zone axis', () => {
  it("the 'all' sentinel keeps every attempt", () => {
    expect(applyActivityFilters(attempts, DEFAULT_FILTERS)).toHaveLength(5)
    expect(DEFAULT_FILTERS.selectedZone).toBe('all')
    expect(attempts.some((a) => a.zoneType === 'all')).toBe(false)
  })

  it('keeps the three Frontlines in separate buckets', () => {
    expect(
      applyActivityFilters(
        attempts,
        filters({ selectedZone: 'Trenches1' })
      ).map((a) => a.id)
    ).toEqual(['a1'])
    expect(
      applyActivityFilters(
        attempts,
        filters({ selectedZone: 'Trenches2' })
      ).map((a) => a.id)
    ).toEqual(['a2', 'a5'])
    expect(
      applyActivityFilters(
        attempts,
        filters({ selectedZone: 'Trenches3' })
      ).map((a) => a.id)
    ).toEqual(['a3'])
  })

  it('does not match a display name (the option VALUE is a raw zone_type)', () => {
    expect(
      applyActivityFilters(
        attempts,
        filters({ selectedZone: 'Left Frontline' })
      )
    ).toEqual([])
    expect(
      applyActivityFilters(attempts, filters({ selectedZone: 'Vox-Station' }))
    ).toEqual([])
  })

  it('composes with the player search', () => {
    const result = applyActivityFilters(
      attempts,
      filters({ selectedZone: 'Trenches2', playerSearch: 'a5' })
    )
    expect(result.map((a) => a.id)).toEqual(['a5'])
  })
})

describe('ActivityFilterBar', () => {
  it('offers the three Frontlines as three distinct options', () => {
    render(
      <ActivityFilterBar
        filters={DEFAULT_FILTERS}
        onChange={vi.fn()}
        attempts={attempts}
      />
    )

    const options = screen
      .getAllByRole('option')
      .map((o) => [(o as HTMLOptionElement).value, o.textContent])

    expect(options).toEqual([
      ['all', 'All zones'],
      ['Trenches1', 'Left Frontline'],
      ['Trenches2', 'Mid Frontline'],
      ['Trenches3', 'Right Frontline'],
      ['ComsStation', 'Vox-Station']
    ])
    expect(options).toHaveLength(5)
  })

  it('emits the raw zone_type as the selected value, not the label', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ActivityFilterBar
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        attempts={attempts}
      />
    )

    await user.selectOptions(screen.getByRole('combobox'), 'Trenches3')

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedZone: 'Trenches3' })
    )
  })

  it("restores the 'all' sentinel when filters are cleared", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ActivityFilterBar
        filters={filters({ selectedZone: 'Trenches1' })}
        onChange={onChange}
        attempts={attempts}
      />
    )

    await user.click(screen.getByRole('button', { name: /Clear \(1\)/ }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selectedZone: 'all' })
    )
  })

  it('hides the zone dropdown when no attempt carries a zone', () => {
    render(
      <ActivityFilterBar
        filters={DEFAULT_FILTERS}
        onChange={vi.fn()}
        attempts={[]}
      />
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
