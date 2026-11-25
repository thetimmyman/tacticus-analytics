import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mockLogger
}))

const mockFetch = vi.fn()

describe('circuit breaker Discord state-change alerts', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('CIRCUIT_BREAKER_WEBHOOK_URL', 'https://discord.test/webhook/1')
    vi.stubEnv('DISCORD_ALERTS_ENABLED', 'true')
    mockFetch.mockResolvedValue({ ok: true, status: 204 })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('alerts when a circuit opens from CLOSED', async () => {
    const { alertOnStateChange } = await import('@/app/lib/resilience/alerts')

    await alertOnStateChange('tacticus-api', 'CLOSED', 'OPEN')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))
    expect(body.embeds[0].title).toContain('tacticus-api')
    expect(body.embeds[0].description).toContain('Circuit OPENED')
  })

  it('stays quiet when transitioning OPEN -> HALF_OPEN', async () => {
    const { alertOnStateChange } = await import('@/app/lib/resilience/alerts')

    await alertOnStateChange('tacticus-api', 'OPEN', 'HALF_OPEN')

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('alerts when recovering automatically via HALF_OPEN -> CLOSED', async () => {
    const { alertOnStateChange } = await import('@/app/lib/resilience/alerts')

    await alertOnStateChange('tacticus-api', 'HALF_OPEN', 'CLOSED')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))
    expect(body.embeds[0].title).toContain('tacticus-api')
    expect(body.embeds[0].description).toContain('Circuit RECOVERED')
    expect(body.embeds[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Previous State',
          value: 'HALF_OPEN'
        }),
        expect.objectContaining({ name: 'New State', value: 'CLOSED' })
      ])
    )
  })

  it('alerts on manual reset OPEN -> CLOSED and re-open HALF_OPEN -> OPEN', async () => {
    const { alertOnStateChange } = await import('@/app/lib/resilience/alerts')

    await alertOnStateChange('tacticus-api', 'OPEN', 'CLOSED')
    await alertOnStateChange('tacticus-api', 'HALF_OPEN', 'OPEN')

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))
    const second = JSON.parse(String(mockFetch.mock.calls[1]?.[1]?.body))
    expect(first.embeds[0].description).toContain('Circuit RECOVERED')
    expect(second.embeds[0].description).toContain('Circuit OPENED')
  })
})
