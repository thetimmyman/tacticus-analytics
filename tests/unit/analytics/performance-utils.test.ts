import { describe, it, expect } from 'vitest'
import {
  calculateStats,
  analyzeTrend,
  calculateConsistencyScore,
  detectAnomalies,
  calculateOptimalUsageTiming,
  generatePerformanceInsights,
  type PerformanceStats,
  type TrendAnalysis,
  type ConsistencyScore
} from '@/app/lib/analytics/performance-utils'

describe('Performance Analytics Utilities', () => {
  describe('calculateStats', () => {
    it('returns zeros for empty array', () => {
      const result = calculateStats([])

      expect(result.mean).toBe(0)
      expect(result.median).toBe(0)
      expect(result.standardDeviation).toBe(0)
      expect(result.variance).toBe(0)
      expect(result.coefficient_of_variation).toBe(0)
    })

    it('calculates mean correctly', () => {
      const result = calculateStats([10, 20, 30, 40, 50])

      expect(result.mean).toBe(30)
    })

    it('calculates median for odd-length array', () => {
      const result = calculateStats([10, 20, 30, 40, 50])

      expect(result.median).toBe(30)
    })

    it('calculates median for even-length array', () => {
      const result = calculateStats([10, 20, 30, 40])

      expect(result.median).toBe(25)
    })

    it('calculates variance and standard deviation', () => {
      const result = calculateStats([2, 4, 4, 4, 5, 5, 7, 9])

      expect(result.mean).toBe(5)
      expect(result.variance).toBe(4)
      expect(result.standardDeviation).toBe(2)
    })

    it('calculates coefficient of variation', () => {
      const result = calculateStats([100, 100, 100, 100])

      expect(result.coefficient_of_variation).toBe(0)
    })

    it('handles single element array', () => {
      const result = calculateStats([42])

      expect(result.mean).toBe(42)
      expect(result.median).toBe(42)
      expect(result.variance).toBe(0)
      expect(result.standardDeviation).toBe(0)
    })

    it('sorts values correctly for median calculation', () => {
      const result = calculateStats([50, 10, 30, 20, 40])

      expect(result.median).toBe(30)
    })
  })

  describe('analyzeTrend', () => {
    it('returns stable with weak confidence for insufficient data', () => {
      const result = analyzeTrend([100])

      expect(result.direction).toBe('stable')
      expect(result.strength).toBe('weak')
      expect(result.confidence).toBe(0)
    })

    it('detects improving trend', () => {
      const result = analyzeTrend([10, 20, 30, 40, 50])

      expect(result.direction).toBe('improving')
      expect(result.changeRate).toBeGreaterThan(0)
    })

    it('detects declining trend', () => {
      const result = analyzeTrend([50, 40, 30, 20, 10])

      expect(result.direction).toBe('declining')
      expect(result.changeRate).toBeLessThan(0)
    })

    it('detects stable trend with flat data', () => {
      const result = analyzeTrend([100, 100, 100, 100])

      expect(result.direction).toBe('stable')
    })

    it('identifies strong trend with perfect correlation', () => {
      const result = analyzeTrend([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      expect(result.strength).toBe('strong')
      expect(result.confidence).toBeGreaterThan(70)
    })

    it('identifies moderate trend with noisy data', () => {
      const result = analyzeTrend([10, 50, 20, 40, 30])

      expect(result.strength).toBe('moderate')
      expect(result.confidence).toBeGreaterThanOrEqual(30)
      expect(result.confidence).toBeLessThan(70)
    })

    it('uses custom time points when provided', () => {
      const values = [10, 20, 30]
      const timePoints = [0, 10, 20]
      const result = analyzeTrend(values, timePoints)

      expect(result.direction).toBe('improving')
    })
  })

  describe('calculateConsistencyScore', () => {
    it('returns poor rating with no data', () => {
      const result = calculateConsistencyScore([])

      expect(result.score).toBe(0)
      expect(result.rating).toBe('poor')
      expect(result.description).toBe('No data available')
    })

    it('returns excellent for perfectly consistent data', () => {
      const result = calculateConsistencyScore([100, 100, 100, 100, 100])

      expect(result.rating).toBe('excellent')
      expect(result.score).toBeGreaterThanOrEqual(85)
    })

    it('applies penalty for small sample sizes', () => {
      const smallSample = calculateConsistencyScore([100, 100, 100])
      const largeSample = calculateConsistencyScore([100, 100, 100, 100, 100])

      expect(smallSample.score).toBeLessThan(largeSample.score)
    })

    it('returns poor rating for highly variable data', () => {
      const result = calculateConsistencyScore([10, 100, 50, 200, 5])

      expect(result.rating).toBe('poor')
      expect(result.score).toBeLessThan(50)
    })

    it('returns good rating for moderately consistent data', () => {
      const result = calculateConsistencyScore([95, 100, 105, 98, 102])

      expect(['excellent', 'good']).toContain(result.rating)
    })

    it('includes descriptive text in description', () => {
      const result = calculateConsistencyScore([100, 100, 100, 100, 100])

      expect(result.description).toBeTruthy()
      expect(result.description.length).toBeGreaterThan(10)
    })
  })

  describe('detectAnomalies', () => {
    it('returns empty results for insufficient data', () => {
      const result = detectAnomalies([100, 200])

      expect(result.outliers).toEqual([])
      expect(result.outlierIndices).toEqual([])
      expect(result.isCurrentAnomaly).toBe(false)
    })

    it('detects obvious outliers', () => {
      const values = [100, 100, 100, 100, 100, 1000]
      const result = detectAnomalies(values)

      expect(result.outliers).toContain(1000)
      expect(result.outlierIndices).toContain(5)
      expect(result.isCurrentAnomaly).toBe(true)
    })

    it('identifies when current value is an anomaly', () => {
      const values = [100, 100, 100, 100, 100, 1000]
      const result = detectAnomalies(values)

      expect(result.isCurrentAnomaly).toBe(true)
    })

    it('does not flag normal values as anomalies', () => {
      const values = [98, 100, 102, 99, 101]
      const result = detectAnomalies(values)

      expect(result.outliers).toEqual([])
      expect(result.isCurrentAnomaly).toBe(false)
    })

    it('respects custom threshold', () => {
      const values = [100, 100, 100, 150]

      const defaultResult = detectAnomalies(values, 2)

      const strictResult = detectAnomalies(values, 1)

      expect(strictResult.outliers.length).toBeGreaterThanOrEqual(
        defaultResult.outliers.length
      )
    })

    it('returns all outlier indices', () => {
      const values = [100, 500, 100, 100, 600]
      const result = detectAnomalies(values)

      expect(result.outlierIndices.length).toBe(result.outliers.length)
    })
  })

  describe('calculateOptimalUsageTiming', () => {
    it('returns default for insufficient data', () => {
      const result = calculateOptimalUsageTiming([])

      expect(result.optimalHour).toBe(12)
      expect(result.confidence).toBe(0)
      expect(result.reasoning).toContain('Insufficient')
    })

    it('calculates optimal hour from usage history', () => {
      const usageHistory = [
        {
          timestamp: new Date('2024-01-01T14:00:00'),
          tokensUsed: 2,
          efficiency: 0.9
        },
        {
          timestamp: new Date('2024-01-02T14:00:00'),
          tokensUsed: 2,
          efficiency: 0.95
        },
        {
          timestamp: new Date('2024-01-03T14:00:00'),
          tokensUsed: 2,
          efficiency: 0.92
        },
        {
          timestamp: new Date('2024-01-04T10:00:00'),
          tokensUsed: 2,
          efficiency: 0.7
        },
        {
          timestamp: new Date('2024-01-05T10:00:00'),
          tokensUsed: 2,
          efficiency: 0.65
        }
      ]
      const result = calculateOptimalUsageTiming(usageHistory)

      expect(result.optimalHour).toBe(14)
      expect(result.confidence).toBeGreaterThan(0)
    })

    it('requires minimum samples per hour', () => {
      const usageHistory = [
        {
          timestamp: new Date('2024-01-01T09:00:00'),
          tokensUsed: 2,
          efficiency: 0.99
        },
        {
          timestamp: new Date('2024-01-02T14:00:00'),
          tokensUsed: 2,
          efficiency: 0.8
        },
        {
          timestamp: new Date('2024-01-03T14:00:00'),
          tokensUsed: 2,
          efficiency: 0.85
        },
        {
          timestamp: new Date('2024-01-04T14:00:00'),
          tokensUsed: 2,
          efficiency: 0.82
        },
        {
          timestamp: new Date('2024-01-05T15:00:00'),
          tokensUsed: 2,
          efficiency: 0.6
        }
      ]
      const result = calculateOptimalUsageTiming(usageHistory)

      // Hour 9 has 1 sample (below min).
      expect(result.optimalHour).toBe(14)
    })

    it('provides reasoning for recommendation', () => {
      const usageHistory = Array(10)
        .fill(null)
        .map((_, i) => ({
          timestamp: new Date(
            `2024-01-${String(i + 1).padStart(2, '0')}T15:00:00`
          ),
          tokensUsed: 2,
          efficiency: 0.85
        }))
      const result = calculateOptimalUsageTiming(usageHistory)

      expect(result.reasoning).toBeTruthy()
      expect(result.reasoning.length).toBeGreaterThan(0)
    })
  })

  describe('generatePerformanceInsights', () => {
    it('returns insights array', () => {
      const data = {
        damageValues: [100000, 110000, 95000, 105000, 98000],
        tokenUsage: [2, 2, 3, 2, 2],
        timeToKill: [15, 18, 16, 17, 14]
      }
      const result = generatePerformanceInsights(data)

      expect(result.insights).toBeInstanceOf(Array)
      expect(result.insights.length).toBeGreaterThan(0)
    })

    it('includes damage consistency insight', () => {
      const data = {
        damageValues: [100000, 100000, 100000],
        tokenUsage: [2, 2, 2],
        timeToKill: [15, 15, 15]
      }
      const result = generatePerformanceInsights(data)

      expect(result.insights.some((i) => i.includes('consistency'))).toBe(true)
    })

    it('includes token usage trend insight', () => {
      const data = {
        damageValues: [100000, 100000],
        tokenUsage: [2, 3],
        timeToKill: [15, 15]
      }
      const result = generatePerformanceInsights(data)

      expect(result.insights.some((i) => i.includes('Token'))).toBe(true)
    })

    it('adds recommendation for slow kill times', () => {
      const data = {
        damageValues: [50000, 60000, 55000],
        tokenUsage: [5, 6, 5],
        timeToKill: [25, 30, 28] // Above 20 minute threshold
      }
      const result = generatePerformanceInsights(data)

      expect(result.insights.some((i) => i.includes('Kill times'))).toBe(true)
      expect(result.recommendations.length).toBeGreaterThan(0)
    })

    it('flags anomaly in insights', () => {
      const data = {
        damageValues: [100000, 100000, 100000, 100000, 100000, 1000000],
        tokenUsage: [2, 2, 2, 2, 2, 2],
        timeToKill: [15, 15, 15, 15, 15, 15]
      }
      const result = generatePerformanceInsights(data)

      expect(result.insights.some((i) => i.includes('unusual'))).toBe(true)
    })

    it('sets appropriate risk levels', () => {
      const highRiskData = {
        damageValues: [100, 90, 80, 70, 60, 50, 40, 30],
        tokenUsage: [8, 7, 6, 5, 4, 3, 2, 1],
        timeToKill: [10, 12, 14, 16, 18, 20, 22, 24]
      }
      const highRiskResult = generatePerformanceInsights(highRiskData)
      expect(['medium', 'high']).toContain(highRiskResult.riskLevel)

      const lowRiskData = {
        damageValues: [100, 100, 100, 100],
        tokenUsage: [2, 2, 2, 2],
        timeToKill: [15, 15, 15, 15]
      }
      const lowRiskResult = generatePerformanceInsights(lowRiskData)
      expect(lowRiskResult.riskLevel).toBe('low')
    })
  })
})
