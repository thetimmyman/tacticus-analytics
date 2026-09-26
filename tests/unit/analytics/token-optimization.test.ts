import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getOptimalUsageTiming,
  generateTokenEfficiencyInsights,
  calculateOptimalWindows,
  type OptimalUsageSuggestion
} from '@/app/lib/analytics/token-optimization'

describe('Token Usage Optimization Utilities', () => {
  describe('getOptimalUsageTiming', () => {
    let mockDate: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      mockDate = vi.spyOn(Date.prototype, 'getHours').mockReturnValue(14)
    })

    afterEach(() => {
      mockDate.mockRestore()
    })

    describe('full tokens', () => {
      it('recommends immediate use when tokens are full', () => {
        const result = getOptimalUsageTiming({
          current: 3,
          max: 3,
          nextInSeconds: null,
          type: 'generic'
        })

        expect(result.recommendedTime).toBe('NOW')
        expect(result.urgency).toBe('high')
        expect(result.confidence).toBeGreaterThanOrEqual(90)
        expect(result.reasoning).toContain('waste')
      })
    })

    describe('empty tokens', () => {
      it('recommends waiting when tokens are empty', () => {
        const result = getOptimalUsageTiming({
          current: 0,
          max: 3,
          nextInSeconds: 7200, // 2 hours
          type: 'generic'
        })

        expect(result.urgency).toBe('low')
        expect(result.reasoning).toContain('wait')
        expect(result.hoursUntilOptimal).toBeGreaterThan(0)
      })

      it('uses nextInSeconds to calculate wait time', () => {
        const result = getOptimalUsageTiming({
          current: 0,
          max: 3,
          nextInSeconds: 10800, // 3 hours
          type: 'generic'
        })

        expect(result.hoursUntilOptimal).toBe(3)
      })

      it('defaults to 8 hours when nextInSeconds is null', () => {
        const result = getOptimalUsageTiming({
          current: 0,
          max: 3,
          nextInSeconds: null,
          type: 'generic'
        })

        expect(result.hoursUntilOptimal).toBe(8)
      })
    })

    describe('Guild Raid tokens', () => {
      it('recommends prime time (6-10 PM) during evening hours', () => {
        mockDate.mockReturnValue(19) // 7 PM

        const result = getOptimalUsageTiming({
          current: 2,
          max: 3,
          nextInSeconds: null,
          type: 'guild raid'
        })

        expect(result.recommendedTime).toBe('NOW')
        expect(result.reasoning).toContain('Prime time')
      })

      it('suggests waiting until prime time during day hours', () => {
        mockDate.mockReturnValue(10) // 10 AM

        const result = getOptimalUsageTiming({
          current: 2,
          max: 3,
          nextInSeconds: null,
          type: 'guild raid'
        })

        expect(result.hoursUntilOptimal).toBe(8) // 18 - 10 = 8 hours
        expect(result.reasoning).toContain('6 PM')
      })

      it('suggests using soon late at night to avoid waste', () => {
        mockDate.mockReturnValue(23) // 11 PM

        const result = getOptimalUsageTiming({
          current: 2,
          max: 3,
          nextInSeconds: null,
          type: 'guild raid'
        })

        expect(result.recommendedTime).toBe('Soon')
        expect(result.reasoning).toContain('reset')
      })

      it('suggests waiting for more tokens when low', () => {
        mockDate.mockReturnValue(19)

        const result = getOptimalUsageTiming({
          current: 1,
          max: 3,
          nextInSeconds: null,
          type: 'guild raid'
        })

        expect(result.urgency).toBe('low')
        expect(result.reasoning).toContain('accumulate')
      })
    })

    describe('Arena tokens', () => {
      it('recommends off-peak hours for better opponents', () => {
        mockDate.mockReturnValue(14) // 2 PM - off-peak

        const result = getOptimalUsageTiming({
          current: 10,
          max: 12,
          nextInSeconds: null,
          type: 'arena'
        })

        expect(result.recommendedTime).toBe('NOW')
        expect(result.reasoning).toContain('Off-peak')
      })

      it('suggests waiting during peak hours', () => {
        mockDate.mockReturnValue(19) // 7 PM - peak

        const result = getOptimalUsageTiming({
          current: 10,
          max: 12,
          nextInSeconds: null,
          type: 'arena'
        })

        expect(result.urgency).toBe('low')
        expect(result.reasoning).toContain('Peak')
      })

      it('warns when near capacity', () => {
        mockDate.mockReturnValue(8) // Morning

        const result = getOptimalUsageTiming({
          current: 9,
          max: 10,
          nextInSeconds: null,
          type: 'arena'
        })

        expect(result.urgency).toBe('medium')
        expect(result.reasoning).toContain('capacity')
      })
    })

    describe('Bomb tokens', () => {
      it('recommends using bombs during prime time', () => {
        mockDate.mockReturnValue(20) // 8 PM

        const result = getOptimalUsageTiming({
          current: 1,
          max: 2,
          nextInSeconds: null,
          type: 'bomb'
        })

        expect(result.recommendedTime).toBe('NOW')
        expect(result.urgency).toBe('high')
      })

      it('recommends waiting when not optimal time', () => {
        mockDate.mockReturnValue(10) // 10 AM

        const result = getOptimalUsageTiming({
          current: 1,
          max: 2,
          nextInSeconds: null,
          type: 'bomb'
        })

        expect(result.urgency).toBe('medium')
        expect(result.reasoning).toContain('valuable')
      })

      it('suggests near-reset usage', () => {
        mockDate.mockReturnValue(7) // Near 8 AM reset

        const result = getOptimalUsageTiming({
          current: 1,
          max: 2,
          nextInSeconds: null,
          type: 'bomb'
        })

        expect(result.recommendedTime).toBe('NOW')
        expect(result.reasoning).toContain('reset')
      })

      it('suggests waiting when no bombs available', () => {
        const result = getOptimalUsageTiming({
          current: 0,
          max: 2,
          nextInSeconds: 28800, // 8 hours
          type: 'bomb'
        })

        expect(result.hoursUntilOptimal).toBe(8)
        expect(result.reasoning).toContain('No tokens')
      })
    })

    describe('Onslaught tokens', () => {
      it('recommends focus hours for challenging content', () => {
        mockDate.mockReturnValue(14) // 2 PM - good focus time

        const result = getOptimalUsageTiming({
          current: 2,
          max: 3,
          nextInSeconds: null,
          type: 'onslaught'
        })

        expect(result.recommendedTime).toBe('NOW')
        expect(result.reasoning).toContain('focus')
      })

      it('suggests waiting for focus hours', () => {
        mockDate.mockReturnValue(8) // Early morning

        const result = getOptimalUsageTiming({
          current: 2,
          max: 3,
          nextInSeconds: null,
          type: 'onslaught'
        })

        expect(result.urgency).toBe('medium')
        expect(result.hoursUntilOptimal).toBe(2)
      })

      it('suggests accumulating when tokens low', () => {
        const result = getOptimalUsageTiming({
          current: 1,
          max: 3,
          nextInSeconds: null,
          type: 'onslaught'
        })

        expect(result.urgency).toBe('low')
        expect(result.reasoning).toContain('Accumulate')
      })
    })

    describe('Generic tokens', () => {
      it('warns when near capacity', () => {
        const result = getOptimalUsageTiming({
          current: 9,
          max: 10,
          nextInSeconds: null,
          type: 'unknown'
        })

        expect(result.urgency).toBe('medium')
        expect(result.reasoning).toContain('waste')
      })

      it('suggests convenience use at half capacity', () => {
        const result = getOptimalUsageTiming({
          current: 5,
          max: 10,
          nextInSeconds: null,
          type: 'unknown'
        })

        expect(result.urgency).toBe('low')
        expect(result.reasoning).toContain('convenient')
      })

      it('suggests waiting when low', () => {
        const result = getOptimalUsageTiming({
          current: 2,
          max: 10,
          nextInSeconds: null,
          type: 'unknown'
        })

        expect(result.hoursUntilOptimal).toBe(4)
        expect(result.reasoning).toContain('Low')
      })
    })
  })

  describe('generateTokenEfficiencyInsights', () => {
    it('returns insights for empty token array', () => {
      const result = generateTokenEfficiencyInsights([])

      expect(result.overallEfficiency).toBe(0)
      expect(result.wastedTokens).toBe(0)
      expect(result.recommendations).toEqual([
        'Overall low token availability - plan activities around refresh times'
      ])
      expect(result.urgentActions).toEqual([])
    })

    it('identifies full tokens as urgent actions', () => {
      const result = generateTokenEfficiencyInsights([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null },
        { type: 'Arena', current: 10, max: 10, nextInSeconds: null }
      ])

      expect(result.wastedTokens).toBe(2)
      expect(result.urgentActions).toHaveLength(2)
      expect(result.urgentActions.some((a) => a.includes('Raid'))).toBe(true)
      expect(result.urgentActions.some((a) => a.includes('Arena'))).toBe(true)
    })

    it('adds recommendations for nearly full tokens', () => {
      const result = generateTokenEfficiencyInsights([
        { type: 'Raid', current: 8, max: 10, nextInSeconds: null }
      ])

      expect(
        result.recommendations.some((r) => r.includes('nearly full'))
      ).toBe(true)
    })

    it('adds recommendations for empty tokens', () => {
      const result = generateTokenEfficiencyInsights([
        { type: 'Bomb', current: 0, max: 1, nextInSeconds: 28800 }
      ])

      expect(result.recommendations.some((r) => r.includes('empty'))).toBe(true)
    })

    it('calculates overall efficiency percentage', () => {
      const result = generateTokenEfficiencyInsights([
        { type: 'Raid', current: 1, max: 2, nextInSeconds: null },
        { type: 'Arena', current: 5, max: 10, nextInSeconds: null }
      ])

      expect(result.overallEfficiency).toBe(50)
    })

    it('adds general recommendation for low availability', () => {
      const result = generateTokenEfficiencyInsights([
        { type: 'Raid', current: 0, max: 3, nextInSeconds: null },
        { type: 'Arena', current: 1, max: 10, nextInSeconds: null }
      ])

      expect(
        result.recommendations.some((r) => r.includes('plan activities'))
      ).toBe(true)
    })

    it('adds recommendation for high availability', () => {
      const result = generateTokenEfficiencyInsights([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null },
        { type: 'Arena', current: 9, max: 10, nextInSeconds: null }
      ])

      expect(
        result.recommendations.some((r) => r.includes('active gameplay'))
      ).toBe(true)
    })
  })

  describe('calculateOptimalWindows', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T14:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns array of optimal windows', () => {
      const result = calculateOptimalWindows([
        { type: 'Raid', current: 2, max: 3, nextInSeconds: null },
        { type: 'Arena', current: 5, max: 10, nextInSeconds: null }
      ])

      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('Raid')
      expect(result[1].type).toBe('Arena')
    })

    it('includes windowStart and windowEnd dates', () => {
      const result = calculateOptimalWindows([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null }
      ])

      expect(result[0].windowStart).toBeInstanceOf(Date)
      expect(result[0].windowEnd).toBeInstanceOf(Date)
    })

    it('sets 2-hour window duration', () => {
      const result = calculateOptimalWindows([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null }
      ])

      const windowDuration =
        result[0].windowEnd.getTime() - result[0].windowStart.getTime()
      expect(windowDuration).toBe(2 * 60 * 60 * 1000) // 2 hours in ms
    })

    it('includes confidence from suggestion', () => {
      const result = calculateOptimalWindows([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null }
      ])

      expect(result[0].confidence).toBeGreaterThan(0)
    })

    it('includes reasoning from suggestion', () => {
      const result = calculateOptimalWindows([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null }
      ])

      expect(result[0].reason).toBeTruthy()
      expect(result[0].reason.length).toBeGreaterThan(0)
    })

    it('calculates window start based on hoursUntilOptimal', () => {
      const result = calculateOptimalWindows([
        { type: 'Generic', current: 1, max: 10, nextInSeconds: null }
      ])

      const now = new Date('2024-01-15T14:00:00Z')
      expect(result[0].windowStart.getTime()).toBeGreaterThanOrEqual(
        now.getTime()
      )
    })

    it('returns immediate window for full tokens', () => {
      const result = calculateOptimalWindows([
        { type: 'Raid', current: 3, max: 3, nextInSeconds: null }
      ])

      const now = new Date('2024-01-15T14:00:00Z')
      expect(result[0].windowStart.getTime()).toBe(now.getTime())
    })
  })
})
