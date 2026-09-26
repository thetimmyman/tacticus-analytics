import { describe, it, expect, vi } from 'vitest'
import {
  bossMetricTooltips,
  summaryTooltips
} from '@/app/components/dashboard/boss-performance-tooltips'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatDuration: vi.fn((value: number) => `dur-${value}`),
  formatNumber: vi.fn((value: number) => `num-${value}`),
  formatPercentage: vi.fn((value: number) => `pct-${value}`)
}))

describe('summaryTooltips', () => {
  it('builds average tokens tooltip with category', () => {
    const message = summaryTooltips.averageTokens(40)

    expect(message).toContain('Average tokens per boss')
    expect(message).toContain(
      'Current average: num-40 tokens (Moderate clears)'
    )
  })

  it('builds damage efficiency tooltip with formatted values', () => {
    const message = summaryTooltips.damageEfficiency(1500, 65)

    expect(message).toContain('Average damage per hit')
    expect(message).toContain('num-1500')
    expect(message).toContain('pct-0.65')
    expect(message).toContain('Moderate efficiency')
  })
})

describe('bossMetricTooltips', () => {
  it('renders time-to-kill messaging when timing data is missing', () => {
    const message = bossMetricTooltips.timeToKill({
      averageTimeToKill: null,
      lastLoopTimeToKill: null,
      durationTrend: 'stable'
    })

    expect(message).toContain('Average: Not available')
    expect(message).toContain('Most recent loop: Not available')
    expect(message).toContain('Kill times are steady')
  })

  it('renders analytics details with risk metadata', () => {
    const message = bossMetricTooltips.analytics({
      consistencyScore: {
        rating: 'Great',
        score: 88,
        description: 'Solid performance'
      },
      trendAnalysis: {
        direction: 'improving',
        strength: 'strong',
        confidence: 80
      },
      hasAnomalies: true,
      riskLevel: 'high'
    })

    expect(message).toContain('Consistency: Great (88/100)')
    expect(message).toContain('Trend: improving (80% confidence)')
    expect(message).toContain('Trend strength: strong')
    expect(message).toContain('Alert: recent results look unusual')
    expect(message).toContain('Risk level: Immediate attention required')
  })

  it('returns a placeholder when no damage-per-hour data exists', () => {
    const message = bossMetricTooltips.damagePerHour({ avgDamagePerHour: null })

    expect(message).toContain('No completed runs recorded yet')
  })
})
