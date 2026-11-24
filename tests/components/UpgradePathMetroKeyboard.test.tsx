import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UpgradePathMetro } from '@/app/(dashboard)/meta-atlas/components/UpgradePathMetro'
import { METRO_FIXTURE_PROPS } from '@/app/components/ui/upgrade-path-metro.fixture'

// Both layouts render in the DOM (CSS swaps them), so every step card
// appears once per layout.
const STATES = METRO_FIXTURE_PROPS.steps.length + 1

function renderMetro() {
  render(<UpgradePathMetro {...METRO_FIXTURE_PROPS} defaultActiveIndex={1} />)
  return screen.getAllByRole('button')
}

const activeCards = (cards: HTMLElement[]) =>
  cards.filter((card) => card.getAttribute('aria-current') === 'step')

describe('UpgradePathMetro step cards: keyboard access', () => {
  it('exposes every step card as a focusable button in both layouts', () => {
    const cards = renderMetro()
    expect(cards).toHaveLength(STATES * 2)
    for (const card of cards) {
      expect(card.tabIndex).toBe(0)
    }
  })

  it('marks the active card with aria-current="step"', () => {
    const cards = renderMetro()
    expect(activeCards(cards)).toEqual([cards[1], cards[STATES + 1]])
  })

  it('activates a step card on Enter', () => {
    const cards = renderMetro()
    const target = cards[STATES - 1]!
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(activeCards(cards)).toEqual([target, cards[2 * STATES - 1]])
  })

  it('activates a step card on Space', () => {
    const cards = renderMetro()
    const target = cards[0]!
    fireEvent.keyDown(target, { key: ' ' })
    expect(activeCards(cards)).toEqual([target, cards[STATES]])
  })

  it('keeps mouse selection working', () => {
    const cards = renderMetro()
    const target = cards[STATES + 2]!
    fireEvent.click(target)
    expect(activeCards(cards)).toEqual([cards[2], target])
  })
})
