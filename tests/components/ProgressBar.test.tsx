import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ProgressBar,
  StackedProgressBar
} from '@/app/components/visualizations/ProgressBar'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatDamage: vi.fn((value: number) => `fmt-${value}`)
}))

describe('ProgressBar', () => {
  it('renders labels, formatted values, and percentage', () => {
    render(
      <ProgressBar
        label="Average Damage"
        sublabel="Season 1"
        avgValue={50}
        maxValue={100}
      />
    )

    expect(screen.getByText('Average Damage')).toBeInTheDocument()
    expect(screen.getByText('Season 1')).toBeInTheDocument()
    expect(screen.getByText('AVG: fmt-50')).toBeInTheDocument()
    expect(screen.getByText('MAX: fmt-100')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('renders vsCluster annotations for positive and negative values', () => {
    const { rerender } = render(
      <ProgressBar
        label="Damage"
        avgValue={50}
        maxValue={100}
        vsClusterPercent={12}
      />
    )

    const positive = screen.getByText(/vsCluster \+12%/)
    expect(positive).toHaveClass('text-green-400')

    rerender(
      <ProgressBar
        label="Damage"
        avgValue={50}
        maxValue={100}
        vsClusterPercent={-8}
      />
    )

    const negative = screen.getByText(/vsCluster -8%/)
    expect(negative).toHaveClass('text-red-400')
  })

  it('hides percentage when below threshold or disabled', () => {
    const { rerender } = render(
      <ProgressBar label="Damage" avgValue={4} maxValue={100} />
    )

    expect(screen.queryByText('4%')).toBeNull()

    rerender(
      <ProgressBar
        label="Damage"
        avgValue={50}
        maxValue={100}
        showPercentage={false}
      />
    )

    expect(screen.queryByText('50%')).toBeNull()
  })
})

describe('StackedProgressBar', () => {
  const segments = [
    { label: 'Alpha', value: 60, color: 'green' as const },
    { label: 'Beta', value: 40, color: 'red' as const }
  ]

  it('renders segment summary and total', () => {
    render(
      <StackedProgressBar
        label="Distribution"
        segments={segments}
        total={100}
      />
    )

    expect(screen.getByText('Distribution')).toBeInTheDocument()
    expect(screen.getByText('Total: 100')).toBeInTheDocument()
    expect(screen.getAllByText('Alpha: 60')).toHaveLength(2)
    expect(screen.getAllByText('Beta: 40')).toHaveLength(2)
  })

  it('hides segment labels inside the bar when disabled', () => {
    render(
      <StackedProgressBar
        label="Distribution"
        segments={segments}
        total={100}
        showLabels={false}
      />
    )

    expect(screen.getAllByText('Alpha: 60')).toHaveLength(1)
    expect(screen.getAllByText('Beta: 40')).toHaveLength(1)
  })
})
