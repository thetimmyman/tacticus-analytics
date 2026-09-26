import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BossDistributionChart from '@/app/components/token-usage/BossDistributionChart'

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@tacticus/app-core/formatters', () => ({
  formatPercentage: (value: number) => `${Math.round(value * 100)}%`
}))

describe('BossDistributionChart', () => {
  it('renders distribution bars and formats boss names', () => {
    const data = [
      {
        bossName: 'L4 Tyrant',
        tokenCount: 10,
        percentage: 50,
        color: '#ff0000'
      },
      { bossName: 'Boss Two', tokenCount: 5, percentage: 25, color: '#00ff00' },
      {
        bossName: 'Boss Three',
        tokenCount: 5,
        percentage: 25,
        color: '#0000ff'
      },
      { bossName: 'Boss Four', tokenCount: 1, percentage: 5, color: '#cccccc' },
      { bossName: 'Boss Five', tokenCount: 1, percentage: 4, color: '#aaaaaa' },
      { bossName: 'Boss Six', tokenCount: 1, percentage: 3, color: '#bbbbbb' },
      { bossName: 'Boss Seven', tokenCount: 1, percentage: 2, color: '#dddddd' }
    ]

    const { container } = render(
      <BossDistributionChart bossDistribution={data} />
    )

    const barSegments = container.querySelectorAll('div[style*="width:"]')
    expect(barSegments).toHaveLength(data.length)
    expect(barSegments[0]).toHaveStyle({ width: '50%' })

    const tyrantLabel = screen.getByText('Tyrant')
    expect(tyrantLabel).toBeInTheDocument()
    expect(tyrantLabel.parentElement).toHaveTextContent(/Tyrant\s*:\s*50%/)
    expect(screen.queryByText('Boss Seven')).not.toBeInTheDocument()
  })
})
