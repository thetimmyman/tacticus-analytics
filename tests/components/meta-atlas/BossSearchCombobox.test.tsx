import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BossSearchCombobox } from '@/app/(dashboard)/meta-atlas/components/BossSearchCombobox'

const avatar = {
  boss_type: 'avatar',
  boss_name: 'Avatar'
}

describe('BossSearchCombobox', () => {
  it('keeps the mobile search, icon controls, and option rows at 44px', () => {
    render(
      <BossSearchCombobox
        bosses={[avatar]}
        currentSeasonBosses={[avatar]}
        allBosses={['avatar']}
        selectedBoss="avatar"
        onSelectBoss={vi.fn()}
        searchValue="Avatar"
        onSearchChange={vi.fn()}
        showAllBosses={false}
        onToggleShowAll={vi.fn()}
        currentSeason="106"
      />
    )

    const input = screen.getByRole('combobox', { name: 'Search bosses' })
    const clear = screen.getByRole('button', { name: 'Clear boss search' })
    const disclosure = screen.getByRole('button', {
      name: 'Open boss options'
    })

    expect(input.className).toContain('min-h-11')
    expect(input.className).toContain('pr-24')
    ;[clear, disclosure].forEach((button) => {
      expect(button.className).toContain('min-h-11')
      expect(button.className).toContain('min-w-11')
    })

    fireEvent.focus(input)
    const option = screen.getByRole('option', { name: /Avatar Current/ })
    expect(option.className).toContain('min-h-11')

    const showAll = screen.getByRole('checkbox', {
      name: /Show all seasons/
    })
    expect(showAll.closest('label')?.className).toContain('min-h-11')
  })

  it('opens onto the first option and selects it with the keyboard', () => {
    const onSelectBoss = vi.fn()
    const onSearchChange = vi.fn()
    render(
      <BossSearchCombobox
        bosses={[avatar]}
        currentSeasonBosses={[avatar]}
        allBosses={['avatar']}
        selectedBoss={null}
        onSelectBoss={onSelectBoss}
        searchValue=""
        onSearchChange={onSearchChange}
        showAllBosses={false}
        onToggleShowAll={vi.fn()}
        currentSeason="106"
      />
    )

    const input = screen.getByRole('combobox', { name: 'Search bosses' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')

    fireEvent.keyDown(input, { key: 'ArrowDown' })

    const listbox = screen.getByRole('listbox', { name: 'Boss options' })
    const option = screen.getByRole('option', { name: /Avatar Current/ })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectBoss).toHaveBeenCalledWith('avatar')
    expect(onSearchChange).toHaveBeenCalledWith('Avatar')
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
})
