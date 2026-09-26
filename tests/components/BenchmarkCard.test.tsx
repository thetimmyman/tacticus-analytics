import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BenchmarkCard } from '@/app/components/ui/BenchmarkCard'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatNumber: (value: number) => `fmt-${value}`
}))

describe('BenchmarkCard', () => {
  const benchmark = {
    damage_avg: 500,
    damage_p75: 700,
    damage_p90: 900,
    damage_max: 1000,
    attack_count: 42,
    team_composition: 'Alpha Team',
    meta_team: 'Meta Squad'
  }

  it('renders fallback when benchmark is missing', () => {
    render(<BenchmarkCard benchmark={null} />)

    expect(screen.getByText('No benchmark data available')).toBeInTheDocument()
  })

  it('shows upgrade prompt when not premium', () => {
    render(<BenchmarkCard benchmark={benchmark} showTeamInfo />)

    expect(screen.getByText('Team Composition')).toBeInTheDocument()
    expect(screen.getByText('Alpha Team')).toBeInTheDocument()
    expect(screen.getByText('Meta Squad')).toBeInTheDocument()
    expect(screen.getByText(/Upgrade to Premium/)).toBeInTheDocument()
    expect(screen.queryByText('75th Percentile')).toBeNull()
  })

  it('renders percentile details for premium users', () => {
    render(
      <BenchmarkCard
        benchmark={benchmark}
        userDamage={900}
        isPremium
        showTeamInfo
      />
    )

    expect(screen.getAllByText('fmt-900')).toHaveLength(2)
    expect(screen.getByText('Top 10% - Excellent')).toBeInTheDocument()
    expect(screen.getByText('+80% vs average')).toBeInTheDocument()
    expect(screen.getByText('75th Percentile')).toBeInTheDocument()
    expect(screen.getByText('90th Percentile')).toBeInTheDocument()
    expect(screen.getByText('Max Recorded')).toBeInTheDocument()
    expect(screen.getByText(/fmt-42/)).toBeInTheDocument()
  })
})
