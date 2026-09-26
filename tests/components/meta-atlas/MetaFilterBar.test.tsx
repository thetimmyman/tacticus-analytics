import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(dashboard)/meta-atlas/components/BossSearchCombobox', () => ({
  BossSearchCombobox: () => <div data-testid="boss-search" />
}))

import { MetaFilterBar } from '@/app/(dashboard)/meta-atlas/components/MetaFilterBar'

const callbacks = {
  onBossFilterChange: vi.fn(),
  onToggleShowAll: vi.fn(),
  onToggleRaritySet: vi.fn(),
  onSelectAllRaritySets: vi.fn(),
  onClearRaritySets: vi.fn(),
  onToggleMetaTeam: vi.fn(),
  onClearMetaTeams: vi.fn()
}

const baseProps = {
  bossFilter: '',
  showAllBosses: false,
  raritySets: ['L1', 'M1'],
  selectedRaritySets: new Set(['L1', 'M1']),
  metaTeams: ['Admech', 'Orkz'],
  selectedMetaTeams: new Set<string>(),
  displayBossCount: 2,
  currentSeason: '106',
  ...callbacks
}

describe('MetaFilterBar', () => {
  beforeEach(() => {
    Object.values(callbacks).forEach((callback) => callback.mockReset())
  })

  it('keeps default filters behind an operable disclosure', () => {
    render(<MetaFilterBar {...baseProps} />)

    const disclosure = screen.getByRole('button', { name: 'Filters' })
    const panel = document.getElementById('meta-filter-panel')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.className).toContain('min-h-11')
    expect(panel?.className).toContain('hidden')

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.className).not.toContain('hidden')
  })

  it('exposes filter selection state and 44px touch targets', () => {
    render(
      <MetaFilterBar
        {...baseProps}
        selectedRaritySets={new Set(['L1'])}
        selectedMetaTeams={new Set(['Admech'])}
      />
    )

    const l1 = screen.getByRole('button', { name: 'L1' })
    const m1 = screen.getByRole('button', { name: 'M1' })
    const admech = screen.getByRole('button', { name: 'Admech' })
    const orkz = screen.getByRole('button', { name: 'Orkz' })

    expect(l1.getAttribute('aria-pressed')).toBe('true')
    expect(m1.getAttribute('aria-pressed')).toBe('false')
    expect(admech.getAttribute('aria-pressed')).toBe('true')
    expect(orkz.getAttribute('aria-pressed')).toBe('false')
    ;[l1, m1, admech, orkz].forEach((button) =>
      expect(button.className).toContain('min-h-11 min-w-11')
    )

    fireEvent.click(m1)
    fireEvent.click(orkz)
    expect(callbacks.onToggleRaritySet).toHaveBeenCalledWith('M1')
    expect(callbacks.onToggleMetaTeam).toHaveBeenCalledWith('Orkz')
  })

  it('treats an equal-size selection outside the current rarity universe as active', () => {
    render(
      <MetaFilterBar
        {...baseProps}
        raritySets={['L5']}
        selectedRaritySets={new Set(['M5'])}
      />
    )

    const disclosure = screen.getByRole('button', { name: /Filters/ })
    const panel = document.getElementById('meta-filter-panel')
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(disclosure.textContent).toContain('1')
    expect(panel?.className).not.toContain('hidden')
    expect(
      screen.getByRole('button', { name: 'L5' }).getAttribute('aria-pressed')
    ).toBe('false')
    expect(screen.getByRole('button', { name: 'Select All' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    expect(screen.getByText(/M5/)).toBeTruthy()
  })

  it('keeps Select All visible and actionable after Clear empties the selection', () => {
    const { rerender } = render(<MetaFilterBar {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(callbacks.onClearRaritySets).toHaveBeenCalledOnce()

    rerender(
      <MetaFilterBar {...baseProps} selectedRaritySets={new Set<string>()} />
    )

    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
    const selectAll = screen.getByRole('button', { name: 'Select All' })
    fireEvent.click(selectAll)
    expect(callbacks.onSelectAllRaritySets).toHaveBeenCalledOnce()
  })
})
