import { describe, it, expect, vi, afterEach } from 'vitest'

const logger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn()
}))

vi.mock('@tacticus/app-core/logger', () => ({
  legacyConsoleLogger: logger
}))

const ORIGINAL_ENV = process.env.NODE_ENV

const loadMonitor = async (env: string) => {
  process.env.NODE_ENV = env
  vi.resetModules()
  return await import('@tacticus/app-core/performance-monitor')
}

const setupTime = () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => {
    now += 100
    return now
  })
}

afterEach(() => {
  process.env.NODE_ENV = ORIGINAL_ENV
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('performance-monitor', () => {
  it('logs query warnings after threshold in development', async () => {
    const { logQuery, resetMonitor } = await loadMonitor('development')
    resetMonitor()
    setupTime()

    for (let i = 0; i < 11; i += 1) {
      logQuery('SomeComponent', 'useQuery')
    }

    expect(logger.warn).toHaveBeenCalled()
  })

  it('ignores PlayerStatsController queries', async () => {
    const { logQuery, resetMonitor } = await loadMonitor('development')
    resetMonitor()
    setupTime()

    for (let i = 0; i < 20; i += 1) {
      logQuery('PlayerStatsControllerTable', 'useQuery')
    }

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('tracks render counts and warns on high volume', async () => {
    const { logRender, resetMonitor } = await loadMonitor('development')
    resetMonitor()

    for (let i = 0; i < 51; i += 1) {
      logRender('RenderHeavyComponent')
    }

    expect(logger.warn).toHaveBeenCalled()
  })

  it('skips logging in production wrappers', async () => {
    const { logQuery, logRender } = await loadMonitor('production')
    setupTime()

    logQuery('SomeComponent', 'useQuery')
    const count = logRender('SomeComponent')

    expect(count).toBe(0)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('exposes performance stats for queries and renders', async () => {
    const { logQuery, logRender, getPerformanceStats, resetMonitor } =
      await loadMonitor('development')
    resetMonitor()
    setupTime()

    logQuery('StatsComponent', 'useQuery')
    logRender('StatsComponent')

    const stats = getPerformanceStats() as any
    expect(stats.queries[0].key).toBe('StatsComponent:useQuery')
    expect(stats.renders[0].component).toBe('StatsComponent')
  })
})
