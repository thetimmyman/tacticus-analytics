import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/loki/global-config', () => ({
  getGlobalConfigSnapshot: vi.fn()
}))

const FALLBACK_FIRST_SEASON_START_MS = 1646128800000
const FALLBACK_SEASON_CYCLE_SECONDS = 1_209_600
const FALLBACK_SEASON_GAP_SECONDS = 86_400
const SEASON_NUMBER_OFFSET = 10

function buildValidConfig(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      guildBoss: {
        misc: {
          firstSeasonStart: FALLBACK_FIRST_SEASON_START_MS,
          seasonDuration: FALLBACK_SEASON_CYCLE_SECONDS,
          bufferAfterSeasonEnd: FALLBACK_SEASON_GAP_SECONDS,
          ...overrides
        }
      }
    }
  }
}

describe('season-timing-service', () => {
  let getGlobalConfigSnapshot: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const lokiModule = await import('@/app/lib/loki/global-config')
    getGlobalConfigSnapshot = vi.mocked(lokiModule.getGlobalConfigSnapshot)
  })

  describe('getSeasonTiming', () => {
    it('uses hardcoded fallback when getGlobalConfigSnapshot throws', async () => {
      getGlobalConfigSnapshot.mockRejectedValue(new Error('Loki unavailable'))
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.source).toBe('hardcoded-fallback')
      expect(result.seasonNumber).toBe(50)
    })

    it('uses hardcoded fallback when config is missing LOKI guildBoss data', async () => {
      getGlobalConfigSnapshot.mockResolvedValue({ someOtherKey: {} })
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.source).toBe('hardcoded-fallback')
    })

    it('uses hardcoded fallback when LOKI config has partial/invalid data', async () => {
      getGlobalConfigSnapshot.mockResolvedValue({
        guildBoss: {
          misc: { firstSeasonStart: 'not-a-number', seasonDuration: null }
        }
      })
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.source).toBe('hardcoded-fallback')
    })

    it('uses loki-globalconfig source when valid config provided', async () => {
      getGlobalConfigSnapshot.mockResolvedValue(buildValidConfig())
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.source).toBe('loki-globalconfig')
    })

    it('rejects a negative bufferAfterSeasonEnd and uses the safe fallback', async () => {
      getGlobalConfigSnapshot.mockResolvedValue(
        buildValidConfig({ bufferAfterSeasonEnd: -3_600_000 })
      )
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)

      expect(result.source).toBe('hardcoded-fallback')
      expect(result.constants.seasonGapSeconds).toBe(
        FALLBACK_SEASON_GAP_SECONDS
      )
      expect(result.seasonEnd).toBeLessThan(result.nextSeasonStart)
    })

    it('accepts a zero buffer and keeps the season boundary at the cycle edge', async () => {
      getGlobalConfigSnapshot.mockResolvedValue(
        buildValidConfig({ bufferAfterSeasonEnd: 0 })
      )
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)

      expect(result.source).toBe('loki-globalconfig')
      expect(result.constants.seasonGapSeconds).toBe(0)
      expect(result.seasonEnd).toBe(result.nextSeasonStart)
    })

    it('detects divergence when loki value differs from hardcoded by >1000ms', async () => {
      const divergedStart = FALLBACK_FIRST_SEASON_START_MS + 5000
      getGlobalConfigSnapshot.mockResolvedValue(
        buildValidConfig({ firstSeasonStart: divergedStart })
      )
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.divergence).not.toBeNull()
      expect(result.divergence?.field).toBe('firstSeasonStartMs')
    })

    it('reports no divergence when loki matches hardcoded constants', async () => {
      getGlobalConfigSnapshot.mockResolvedValue(buildValidConfig())
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.divergence).toBeNull()
    })

    it('correctly identifies in-gap state between seasons', async () => {
      const cycleMs = FALLBACK_SEASON_CYCLE_SECONDS * 1000
      const gapMs = FALLBACK_SEASON_GAP_SECONDS * 1000
      const activeMs = cycleMs - gapMs
      const seasonsElapsed = 50 + SEASON_NUMBER_OFFSET - 1
      const seasonStart =
        FALLBACK_FIRST_SEASON_START_MS + gapMs + seasonsElapsed * cycleMs
      const seasonEnd = seasonStart + activeMs
      const nowInGap = seasonEnd + 1000 // 1 second into the gap

      getGlobalConfigSnapshot.mockResolvedValue(buildValidConfig())
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')

      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(nowInGap)
      const result = await getSeasonTiming(50)
      dateSpy.mockRestore()

      expect(result.isInGap).toBe(true)
      expect(result.hasEnded).toBe(true)
    })

    it('returns correct output for active season', async () => {
      const cycleMs = FALLBACK_SEASON_CYCLE_SECONDS * 1000
      const gapMs = FALLBACK_SEASON_GAP_SECONDS * 1000
      const seasonsElapsed = 50 + SEASON_NUMBER_OFFSET - 1
      const seasonStart =
        FALLBACK_FIRST_SEASON_START_MS + gapMs + seasonsElapsed * cycleMs
      const nowActive = seasonStart + 1000 // 1 second into active season

      getGlobalConfigSnapshot.mockResolvedValue(buildValidConfig())
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')

      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(nowActive)
      const result = await getSeasonTiming(50)
      dateSpy.mockRestore()

      expect(result.isInGap).toBe(false)
      expect(result.hasEnded).toBe(false)
      expect(result.seasonNumber).toBe(50)
    })

    it('handles getGlobalConfigSnapshot returning null gracefully', async () => {
      getGlobalConfigSnapshot.mockResolvedValue(null)
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming(50)
      expect(result.source).toBe('hardcoded-fallback')
    })

    it('infers current season when no seasonNumber provided', async () => {
      getGlobalConfigSnapshot.mockResolvedValue(buildValidConfig())
      const { getSeasonTiming } =
        await import('@/app/lib/services/season-timing-service')
      const result = await getSeasonTiming()
      expect(typeof result.seasonNumber).toBe('number')
      expect(result.seasonNumber).toBeGreaterThan(0)
    })
  })
})
