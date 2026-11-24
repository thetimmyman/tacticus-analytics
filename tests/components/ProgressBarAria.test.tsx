import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProgressBar } from '@/app/components/visualizations/ProgressBar'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatDamage: vi.fn((value: number) => `fmt-${value}`)
}))

describe('ProgressBar ARIA', () => {
  it('marks the bar as a progressbar carrying its rounded value', () => {
    render(
      <ProgressBar
        label="Boss damage"
        avgValue={63.4}
        maxValue={100}
        animate={false}
      />
    )

    const bar = screen.getByRole('progressbar', { name: 'Boss damage' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '63')
  })

  it('clamps the value at 100 when the average exceeds the maximum', () => {
    render(
      <ProgressBar label="Boss" avgValue={150} maxValue={100} animate={false} />
    )

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100'
    )
  })

  it('reports 0 when there is no maximum', () => {
    render(
      <ProgressBar label="Boss" avgValue={50} maxValue={0} animate={false} />
    )

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '0'
    )
  })
})
