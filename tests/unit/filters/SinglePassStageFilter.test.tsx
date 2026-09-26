import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  SinglePassStageFilter,
  summariseStages
} from '@/app/components/filters/SinglePassStageFilter'

afterEach(cleanup)

describe('summariseStages', () => {
  it('collapses a contiguous run to a range', () => {
    expect(summariseStages(['L1', 'L2', 'L3'])).toBe('L1–L3')
  })

  it('lists short runs rather than inventing a range', () => {
    expect(summariseStages(['L1'])).toBe('L1')
    expect(summariseStages(['L1', 'L2'])).toBe('L1, L2')
  })

  it('lists rather than ranges when the run has a gap', () => {
    expect(summariseStages(['L1', 'L2', 'L4'])).toBe('L1, L2, L4')
  })

  it('lists rather than ranges when the run spans rarities', () => {
    expect(summariseStages(['L4', 'L5', 'M1'])).toBe('L4, L5, M1')
  })

  it('is order-insensitive for the range endpoints', () => {
    expect(summariseStages(['L3', 'L1', 'L2'])).toBe('L1–L3')
  })

  it('does not call a duplicated tier a range', () => {
    // Spans-equals-count would wrongly accept this; the check is pairwise.
    expect(summariseStages(['L1', 'L1', 'L3'])).toBe('L1, L1, L3')
  })

  it('leaves non-numeric tiers listed', () => {
    expect(summariseStages(['Lx', 'Ly', 'Lz'])).toBe('Lx, Ly, Lz')
  })

  it('returns an empty string for no stages', () => {
    expect(summariseStages([])).toBe('')
  })
})

describe('SinglePassStageFilter', () => {
  it('renders nothing when the guild has no single-pass stages', () => {
    const { container } = render(
      <SinglePassStageFilter
        singlePassStages={[]}
        included={false}
        onChange={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('survives an unwired caller instead of crashing the page', () => {
    const { container } = render(
      // @ts-expect-error — deliberately omitting the required prop
      <SinglePassStageFilter included={false} onChange={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('reports the hidden stages and starts off', () => {
    render(
      <SinglePassStageFilter
        singlePassStages={['L1', 'L2', 'L3']}
        included={false}
        onChange={vi.fn()}
      />
    )
    const pill = screen.getByRole('button')
    expect(pill).toHaveAttribute('aria-pressed', 'false')
    expect(pill.textContent).toContain('L1–L3')
  })

  it('toggles on and back off', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <SinglePassStageFilter
        singlePassStages={['L1', 'L2', 'L3']}
        included={false}
        onChange={onChange}
      />
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(
      <SinglePassStageFilter
        singlePassStages={['L1', 'L2', 'L3']}
        included
        onChange={onChange}
      />
    )
    const pill = screen.getByRole('button')
    expect(pill).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pill)
    expect(onChange).toHaveBeenLastCalledWith(false)
  })
})
