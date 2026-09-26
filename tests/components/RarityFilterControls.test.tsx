import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'

describe('RarityFilterControls', () => {
  it('hides when only one rarity is available', () => {
    render(
      <RarityFilterControls
        availableRarities={['Legendary']}
        selectedRarities={['Legendary']}
      />
    )

    expect(screen.queryByText('Rarity')).not.toBeInTheDocument()
  })

  it('renders sorted rarity buttons and toggles selection', () => {
    const onChange = vi.fn()
    const onRarityChange = vi.fn()
    const { container } = render(
      <RarityFilterControls
        availableRarities={['Epic', 'Legendary', 'Rare']}
        selectedRarities={['Epic']}
        onChange={onChange}
        onRarityChange={onRarityChange}
      />
    )

    const buttons = Array.from(
      container.querySelectorAll('button[data-rarity]')
    )
    const rarities = buttons.map((button) => button.getAttribute('data-rarity'))
    expect(rarities).toEqual(['Legendary', 'Epic', 'Rare'])

    fireEvent.click(buttons[0])
    expect(onChange).toHaveBeenCalledWith(['Legendary', 'Epic'])
    expect(onRarityChange).toHaveBeenCalledWith(['Legendary', 'Epic'])
  })

  it('shows reset state and resets to defaults', () => {
    const onChange = vi.fn()
    const onRarityChange = vi.fn()
    const onReset = vi.fn()

    render(
      <RarityFilterControls
        availableRarities={['Epic', 'Legendary']}
        selectedRarities={[]}
        defaultRarities={['Legendary', 'Epic']}
        onChange={onChange}
        onRarityChange={onRarityChange}
        onReset={onReset}
      />
    )

    const resetButton = screen.getByRole('button', {
      name: 'Reset rarity filters'
    })
    expect(resetButton).toBeInTheDocument()
    expect(screen.getByText('Showing defaults')).toBeInTheDocument()

    fireEvent.click(resetButton)
    expect(onChange).toHaveBeenCalledWith(['Legendary', 'Epic'])
    expect(onRarityChange).toHaveBeenCalledWith(['Legendary', 'Epic'])
    expect(onReset).toHaveBeenCalled()
  })
})
