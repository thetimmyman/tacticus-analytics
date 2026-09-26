import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  StarDisplay,
  StarCount,
  StarDisplayFromCount,
  getRarityTierFromStars,
  getStarsFromProgressionIndex
} from '@/app/components/StarDisplay'

describe('StarDisplay helpers', () => {
  it('maps progression indices to star counts with caps', () => {
    expect(getStarsFromProgressionIndex(-1)).toBe(0)
    expect(getStarsFromProgressionIndex(3)).toBe(2)
    expect(getStarsFromProgressionIndex(19)).toBe(14)
    expect(getStarsFromProgressionIndex(20)).toBe(13)
  })

  it('derives rarity tiers from star counts', () => {
    expect(getRarityTierFromStars(14)).toBe('mythic-winged')
    expect(getRarityTierFromStars(12)).toBe('mythic')
    expect(getRarityTierFromStars(9)).toBe('legendary')
    expect(getRarityTierFromStars(3)).toBe('uncommon')
  })
})

describe('StarDisplay', () => {
  it('renders placeholder when there are no stars', () => {
    render(<StarDisplay progressionIndex={0} />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders mythic winged graphic with label when enabled', () => {
    render(<StarDisplay progressionIndex={19} showLabel size="md" />)

    expect(screen.getByLabelText('Mythic Winged')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })

  it('renders stars from an explicit count', () => {
    render(<StarDisplayFromCount stars={5} showLabel />)

    expect(screen.getByTitle('5 Stars')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders numeric star count for StarCount', () => {
    const { rerender } = render(<StarCount progressionIndex={0} />)

    expect(screen.getByText('-')).toBeInTheDocument()

    rerender(<StarCount progressionIndex={17} />)
    expect(screen.getByText('12')).toBeInTheDocument()
  })
})
