import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.resilience.notification-queue')
import { circuitRegistry } from './registry'
import type { CircuitState } from './circuit-breaker'

export interface QueuedNotification {
  id: string
  webhookUrl: string
  payload: unknown
  queuedAt: Date
  attempts: number
  lastError?: string
  circuitName: string
}

export interface NotificationQueueConfig {
  maxQueueSize?: number
  maxRetries?: number
  retryDelay?: number
}

const DEFAULT_CONFIG: Required<NotificationQueueConfig> = {
  maxQueueSize: 100,
  maxRetries: 3,
  retryDelay: 5000
}

type SendFunction = (webhookUrl: string, payload: unknown) => Promise<boolean>

class NotificationQueue {
  private queues = new Map<string, QueuedNotification[]>()
  private config: Required<NotificationQueueConfig>
  private sendFn: SendFunction | null = null
  private processingCircuits = new Set<string>()

  constructor(config: NotificationQueueConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  setSendFunction(fn: SendFunction): void {
    this.sendFn = fn
  }

  enqueue(
    circuitName: string,
    webhookUrl: string,
    payload: unknown,
    error?: string
  ): boolean {
    let queue = this.queues.get(circuitName)
    if (!queue) {
      queue = []
      this.queues.set(circuitName, queue)
    }

    if (queue.length >= this.config.maxQueueSize) {
      logger.warn(
        `Notification queue full for circuit "${circuitName}", dropping oldest notification`
      )
      queue.shift()
    }

    const notification: QueuedNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      webhookUrl,
      payload,
      queuedAt: new Date(),
      attempts: 0,
      lastError: error,
      circuitName
    }

    queue.push(notification)
    logger.info(
      {
        queueLength: queue.length,
        notificationId: notification.id
      },
      `Notification queued for "${circuitName}"`
    )

    return true
  }

  getQueueLength(circuitName: string): number {
    return this.queues.get(circuitName)?.length || 0
  }

  getAllQueueLengths(): Record<string, number> {
    const lengths: Record<string, number> = {}
    this.queues.forEach((queue, name) => {
      lengths[name] = queue.length
    })
    return lengths
  }

  async processQueue(
    circuitName: string
  ): Promise<{ processed: number; failed: number }> {
    if (!this.sendFn) {
      logger.warn('No send function configured for notification queue')
      return { processed: 0, failed: 0 }
    }

    if (this.processingCircuits.has(circuitName)) {
      return { processed: 0, failed: 0 }
    }

    const queue = this.queues.get(circuitName)
    if (!queue || queue.length === 0) {
      return { processed: 0, failed: 0 }
    }

    this.processingCircuits.add(circuitName)
    let processed = 0
    let failed = 0

    try {
      logger.info(
        `Processing ${queue.length} queued notifications for "${circuitName}"`
      )

      while (queue.length > 0) {
        const circuitState = circuitRegistry.getState(circuitName)
        if (circuitState !== 'CLOSED') {
          logger.info(
            `Circuit "${circuitName}" no longer closed, pausing queue processing`
          )
          break
        }

        const notification = queue[0]
        if (!notification) break
        notification.attempts++

        try {
          const success = await this.sendFn(
            notification.webhookUrl,
            notification.payload
          )
          if (success) {
            queue.shift()
            processed++
            logger.debug(
              { id: notification.id },
              `Queued notification sent successfully`
            )
          } else {
            throw new Error('Send returned false')
          }
        } catch (error) {
          notification.lastError =
            error instanceof Error ? error.message : String(error)

          if (notification.attempts >= this.config.maxRetries) {
            queue.shift()
            failed++
            logger.warn(
              {
                id: notification.id,
                error: notification.lastError
              },
              `Queued notification failed after ${notification.attempts} attempts`
            )
          } else {
            await new Promise((resolve) =>
              setTimeout(resolve, this.config.retryDelay)
            )
          }
        }
      }
    } finally {
      this.processingCircuits.delete(circuitName)
    }

    logger.info(
      { processed, failed },
      `Queue processing complete for "${circuitName}"`
    )
    return { processed, failed }
  }

  clear(circuitName: string): number {
    const queue = this.queues.get(circuitName)
    const count = queue?.length || 0
    this.queues.delete(circuitName)
    return count
  }

  clearAll(): void {
    this.queues.clear()
  }

  getStats(): {
    totalQueued: number
    queuesByCircuit: Record<string, number>
    oldestNotification: Date | null
  } {
    let totalQueued = 0
    let oldestNotification: Date | null = null
    const queuesByCircuit: Record<string, number> = {}

    this.queues.forEach((queue, name) => {
      totalQueued += queue.length
      queuesByCircuit[name] = queue.length

      const firstNotification = queue[0]
      if (firstNotification?.queuedAt) {
        if (
          !oldestNotification ||
          firstNotification.queuedAt < oldestNotification
        ) {
          oldestNotification = firstNotification.queuedAt
        }
      }
    })

    return { totalQueued, queuesByCircuit, oldestNotification }
  }
}

export const notificationQueue = new NotificationQueue()

export function createQueueProcessorCallback() {
  return async (
    circuitName: string,
    previousState: CircuitState,
    newState: CircuitState
  ) => {
    if (previousState === 'HALF_OPEN' && newState === 'CLOSED') {
      await notificationQueue.processQueue(circuitName)
    }
  }
}
