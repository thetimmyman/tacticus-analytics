import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RarityBadge } from '@/app/components/ui/RarityBadge'
import { getRarityConfig } from '@tacticus/app-core/rarity-utils'

describe('RarityBadge', () => {
  it('renders normalized rarity with metadata', () => {
    render(<RarityBadge rarity="Legendary" />)

    const badge = screen.getByText('Legendary')
    const config = getRarityConfig('Legendary')

    expect(badge).toHaveClass('rarity-badge', 'rarity-badge--legendary')
    expect(badge).toHaveAttribute('data-rarity', 'legendary')
    expect(badge).toHaveAttribute('title', config.description)
  })

  it('falls back to default styles when rarity is missing', () => {
    render(<RarityBadge rarity={null}>Custom</RarityBadge>)

    const badge = screen.getByText('Custom')
    expect(badge).toHaveClass('rarity-badge--default')
    expect(badge.getAttribute('data-rarity')).toBeNull()
  })

  it('supports compact layout and custom title', () => {
    render(
      <RarityBadge
        rarity="Epic"
        compact
        title="Custom title"
        className="extra"
      />
    )

    const badge = screen.getByText('Epic')
    expect(badge).toHaveClass('rarity-badge--compact', 'extra')
    expect(badge).toHaveAttribute('title', 'Custom title')
  })
})
