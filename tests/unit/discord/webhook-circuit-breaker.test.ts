/** Once OPEN, a call short-circuits, resolves `{ ok: false }` and enqueues the notification. */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  postToWebhook,
  discordCircuit
} from '@/app/lib/discord/webhook-service'
import { notificationQueue } from '@/app/lib/resilience'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'

const CIRCUIT_NAME = 'discord-webhooks'
const webhookUrl = 'https://discord.com/api/webhooks/123/token'
const payload: DiscordWebhookPayload = { content: 'hi' }

const serverErrorResponse = () =>
  ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    text: async () => 'upstream is down',
    json: async () => ({})
  }) as unknown as Response

const okResponse = () =>
  ({
    ok: true,
    status: 204,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({})
  }) as unknown as Response

describe('Discord webhook circuit breaker', () => {
  // Probe the real failure threshold instead of hard-coding it.
  let DISCORD_FAILURE_THRESHOLD = 0

  beforeAll(async () => {
    discordCircuit.reset()
    notificationQueue.clearAll()
    const fetchMock = vi.fn(async () => serverErrorResponse())
    vi.stubGlobal('fetch', fetchMock)
    let count = 0
    while (discordCircuit.getState() === 'CLOSED' && count < 1000) {
      try {
        await postToWebhook(webhookUrl, payload, {
          rateLimit: false,
          retries: 0,
          queueOnCircuitOpen: false
        })
      } catch {
        // CLOSED-circuit failures re-throw; the breaker still records them.
      }
      count += 1
    }
    vi.unstubAllGlobals()
    DISCORD_FAILURE_THRESHOLD = count
    discordCircuit.reset()
    notificationQueue.clearAll()
    expect(DISCORD_FAILURE_THRESHOLD).toBeGreaterThan(1)
    expect(DISCORD_FAILURE_THRESHOLD).toBeLessThan(1000)
  })

  beforeEach(() => {
    // Production singletons carry state across tests: reset breaker and queue.
    discordCircuit.reset()
    notificationQueue.clearAll()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    discordCircuit.reset()
    notificationQueue.clearAll()
  })

  const failureThreshold = (): number => DISCORD_FAILURE_THRESHOLD

  const driveOneFailure = async () => {
    try {
      await postToWebhook(webhookUrl, payload, {
        rateLimit: false,
        retries: 0,
        queueOnCircuitOpen: false
      })
    } catch {
      // expected while CLOSED
    }
  }

  it('opens after N consecutive 5xx failures, then queues the next call for retry', async () => {
    const threshold = failureThreshold()

    const fetchMock = vi.fn(async () => serverErrorResponse())
    vi.stubGlobal('fetch', fetchMock)

    expect(discordCircuit.getState()).toBe('CLOSED')

    for (let i = 0; i < threshold; i += 1) {
      await expect(
        postToWebhook(webhookUrl, payload, { rateLimit: false, retries: 0 })
      ).rejects.toThrow('Discord webhook failed')
    }

    expect(discordCircuit.getState()).toBe('OPEN')
    expect(fetchMock).toHaveBeenCalledTimes(threshold)
    // Only the circuit-open path queues.
    expect(notificationQueue.getQueueLength(CIRCUIT_NAME)).toBe(0)

    const queued = await postToWebhook(webhookUrl, payload, {
      rateLimit: false,
      retries: 0
    })

    expect(queued.ok).toBe(false)
    expect(queued.status).toBeNull()
    expect(queued.error?.message ?? '').toContain('queued for retry')
    expect(fetchMock).toHaveBeenCalledTimes(threshold)
    expect(notificationQueue.getQueueLength(CIRCUIT_NAME)).toBe(1)
  })

  it('preserves Discord thread routing when a queued call is retried', async () => {
    const threshold = failureThreshold()
    const fetchMock = vi.fn(async () => serverErrorResponse())
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < threshold; i += 1) {
      await driveOneFailure()
    }
    expect(discordCircuit.getState()).toBe('OPEN')

    await postToWebhook(webhookUrl, payload, {
      rateLimit: false,
      retries: 0,
      threadId: 'thread-123'
    })
    expect(notificationQueue.getQueueLength(CIRCUIT_NAME)).toBe(1)

    fetchMock.mockImplementation(async () => okResponse())
    discordCircuit.reset()
    const processed = await notificationQueue.processQueue(CIRCUIT_NAME)

    expect(processed).toEqual({ processed: 1, failed: 0 })
    const retriedUrl = new URL(String(fetchMock.mock.calls.at(-1)?.[0]))
    expect(retriedUrl.searchParams.get('thread_id')).toBe('thread-123')
  })

  it('respects queueOnCircuitOpen:false — open circuit returns queued result but does NOT enqueue', async () => {
    const threshold = failureThreshold()
    const fetchMock = vi.fn(async () => serverErrorResponse())
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < threshold; i += 1) {
      await driveOneFailure()
    }
    expect(discordCircuit.getState()).toBe('OPEN')

    const result = await postToWebhook(webhookUrl, payload, {
      rateLimit: false,
      retries: 0,
      queueOnCircuitOpen: false
    })

    expect(result.ok).toBe(false)
    expect(result.error?.message ?? '').toContain('queued for retry')
    expect(notificationQueue.getQueueLength(CIRCUIT_NAME)).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(threshold)
  })

  it('a successful call below threshold keeps the circuit CLOSED and does not queue', async () => {
    // Failures short of the threshold must not open it; a success resets the count.
    const threshold = failureThreshold()
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => serverErrorResponse())
    vi.stubGlobal('fetch', fetchMock)

    for (let i = 0; i < threshold - 1; i += 1) {
      await driveOneFailure()
    }
    expect(discordCircuit.getState()).toBe('CLOSED')

    fetchMock.mockImplementation(async () => okResponse())
    const ok = await postToWebhook(webhookUrl, payload, {
      rateLimit: false,
      retries: 0
    })
    expect(ok.ok).toBe(true)
    expect(discordCircuit.getState()).toBe('CLOSED')
    expect(notificationQueue.getQueueLength(CIRCUIT_NAME)).toBe(0)
  })
})
