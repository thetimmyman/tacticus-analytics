import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  BossLevelWrapper,
  BossLevelTitle,
  BossLevelBadge
} from '@/app/components/ui/BossLevelWrapper'

describe('BossLevelWrapper', () => {
  it('renders plain wrapper for non-special rarity', () => {
    const { container } = render(
      <BossLevelWrapper rarity="Epic" className="custom">
        <span>Content</span>
      </BossLevelWrapper>
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('custom')
    expect(wrapper.className).not.toContain('mythic-section')
    expect(wrapper.className).not.toContain('diamond-section')
    expect(screen.getByText('Content')).toBeInTheDocument()
  })

  it('renders mythic wrapper with particles', () => {
    const { container } = render(
      <BossLevelWrapper rarity="Mythic" particleCount={3}>
        <span>Mythic</span>
      </BossLevelWrapper>
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('mythic-section')
    expect(container.querySelectorAll('.mythic-particle')).toHaveLength(3)
    expect(screen.getByText('Mythic')).toBeInTheDocument()
  })

  it('renders legendary wrapper without particles when disabled', () => {
    const { container } = render(
      <BossLevelWrapper rarity="Legendary" showParticles={false}>
        <span>Legendary</span>
      </BossLevelWrapper>
    )

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('diamond-section')
    expect(container.querySelectorAll('.diamond-particle')).toHaveLength(0)
  })
})

describe('BossLevelTitle', () => {
  it('adds rarity class for mythic', () => {
    const { container } = render(
      <BossLevelTitle rarity="Mythic" className="title">
        Title
      </BossLevelTitle>
    )

    const element = container.firstChild as HTMLElement
    expect(element.className).toContain('mythic-title')
    expect(element.className).toContain('title')
  })

  it('renders plain title for non-special rarity', () => {
    const { container } = render(
      <BossLevelTitle rarity="Epic" className="title">
        Title
      </BossLevelTitle>
    )

    const element = container.firstChild as HTMLElement
    expect(element.className).toBe('title')
  })
})

describe('BossLevelBadge', () => {
  it('maps level prefix to rarity badge', () => {
    const { container } = render(
      <BossLevelBadge level="M3" className="badge" />
    )

    const badge = screen.getByText('M3')
    expect(badge).toHaveClass('rarity-badge--mythic')
    expect(badge).toHaveClass('badge')
    expect(container.querySelector('[data-rarity="mythic"]')).toBeTruthy()
  })
})
