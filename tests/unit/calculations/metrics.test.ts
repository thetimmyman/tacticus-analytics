import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryMessage: vi.fn(),
  isSentryEnabled: vi.fn(() => true)
}))

const loadMetrics = async () => import('@/app/lib/calculations/metrics')

describe('calculation metrics', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('summarizes metrics by calculation and source', async () => {
    const metrics = await loadMetrics()
    metrics.recordCalculationMetric({
      id: 'calc',
      source: 'test',
      durationMs: 100,
      success: true
    })
    metrics.recordCalculationMetric({
      id: 'calc',
      source: 'test',
      durationMs: 200,
      success: false
    })

    const summaries = metrics.summarizeMetrics()
    expect(summaries).toHaveLength(1)
    const summary = summaries[0]
    expect(summary.count).toBe(2)
    expect(summary.successRate).toBe(0.5)
    expect(summary.p50).toBeCloseTo(150)
    expect(summary.p95).toBeCloseTo(195)
    expect(summary.p99).toBeCloseTo(199)
    expect(summary.max).toBe(200)
    expect(summary.lastDuration).toBe(200)
  })

  it('filters summaries by time window', async () => {
    const metrics = await loadMetrics()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(2000)

    metrics.recordCalculationMetric({
      id: 'calc',
      source: 'test',
      durationMs: 100,
      success: true,
      timestamp: 1000
    })
    metrics.recordCalculationMetric({
      id: 'calc',
      source: 'test',
      durationMs: 300,
      success: true,
      timestamp: 1700
    })

    const summaries = metrics.summarizeMetrics(500)
    nowSpy.mockRestore()

    expect(summaries).toHaveLength(1)
    expect(summaries[0].count).toBe(1)
  })

  it('returns slow calculations in descending order', async () => {
    const metrics = await loadMetrics()

    metrics.recordCalculationMetric({
      id: 'calc-a',
      source: 'test',
      durationMs: 10,
      success: true
    })
    metrics.recordCalculationMetric({
      id: 'calc-b',
      source: 'test',
      durationMs: 300,
      success: true
    })
    metrics.recordCalculationMetric({
      id: 'calc-c',
      source: 'test',
      durationMs: 120,
      success: true
    })

    const slow = metrics.getSlowCalculations(2)
    expect(slow.map((entry) => entry.durationMs)).toEqual([300, 120])
  })
})
