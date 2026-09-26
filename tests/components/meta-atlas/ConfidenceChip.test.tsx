import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConfidenceChip } from '@/app/(dashboard)/meta-atlas/components/ConfidenceChip'

// The >=100 / >=30 thresholds are a parity contract.

const dotClassOf = (container: HTMLElement) =>
  container.querySelector('[aria-hidden="true"]')?.className ?? ''

describe('ConfidenceChip confidence bands', () => {
  it.each([
    { attackCount: 0, band: 'Low sample size', dot: 'bg-orange-400' },
    { attackCount: 29, band: 'Low sample size', dot: 'bg-orange-400' },
    { attackCount: 30, band: 'Medium confidence', dot: 'bg-yellow-400' },
    { attackCount: 99, band: 'Medium confidence', dot: 'bg-yellow-400' },
    { attackCount: 100, band: 'High confidence', dot: 'bg-green-400' },
    { attackCount: 142, band: 'High confidence', dot: 'bg-green-400' }
  ])(
    'renders $band with $dot at attackCount $attackCount',
    ({ attackCount, band, dot }) => {
      const { container } = render(<ConfidenceChip attackCount={attackCount} />)

      expect(screen.getByTitle(`${attackCount} attacks — ${band}`)).toBeTruthy()
      expect(dotClassOf(container)).toContain(dot)
    }
  )

  it('always shows the count as visible "N atk" text, not only a tooltip', () => {
    render(<ConfidenceChip attackCount={1234} />)
    expect(screen.getByText(/1,234 atk/)).toBeTruthy()
    expect(screen.getByTitle('1234 attacks — High confidence')).toBeTruthy()
  })

  it('merges a caller className onto the chip', () => {
    const { container } = render(
      <ConfidenceChip attackCount={50} className="ml-auto" />
    )
    expect(container.firstElementChild?.className).toContain('ml-auto')
  })
})
