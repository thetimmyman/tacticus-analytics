import type { TypedSupabaseClient } from '@tacticus/app-core/types'

import type { Json } from '@tacticus/app-core/database.generated'

import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { circuitRegistry } from '@/app/lib/resilience'
import type { CircuitState } from '@/app/lib/resilience'

const logger = createComponentLogger('write-queue')

export type WriteOperationType = 'insert' | 'update' | 'delete' | 'upsert'

export interface QueuedWrite {
  id: string
  operationType: WriteOperationType
  targetTable: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired'
  priority: number
  attempts: number
  maxAttempts: number
  lastError?: string
  circuitName?: string
  context?: Record<string, unknown>
  queuedAt: Date
  scheduledFor: Date
  expiresAt?: Date
}

export interface EnqueueWriteOptions {
  /** Higher = processed first. */
  priority?: number
  circuitName?: string
  context?: Record<string, unknown>
  maxAttempts?: number
  expiresInHours?: number
}

export interface WriteQueueStats {
  pending: number
  processing: number
  completed: number
  failed: number
  oldestPending?: Date
  byCircuit: Record<string, number>
}

class WriteQueueManager {
  private isProcessing = false
  private workerId: string

  constructor() {
    this.workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  async enqueue(
    operationType: WriteOperationType,
    targetTable: string,
    payload: Record<string, unknown>,
    options: EnqueueWriteOptions = {}
  ): Promise<string | null> {
    try {
      const supabase = serviceDb()

      const { data, error } = await supabase.rpc('enqueue_write', {
        p_operation_type: operationType,
        p_target_table: targetTable,
        p_payload: payload as Json,
        p_priority: options.priority ?? 5,
        p_circuit_name: options.circuitName ?? undefined,
        p_context: (options.context ?? {}) as Json,
        p_max_attempts: options.maxAttempts ?? 3,
        p_expires_in: `${options.expiresInHours ?? 24} hours`
      })

      if (error) {
        logger.error(
          { err: error, operationType, targetTable },
          'Failed to enqueue write'
        )
        return null
      }

      logger.info(
        {
          jobId: data,
          operationType,
          targetTable,
          circuitName: options.circuitName
        },
        'Write operation queued'
      )

      return data as string
    } catch (error) {
      logger.error(
        { err: error, operationType, targetTable },
        'Failed to enqueue write'
      )
      return null
    }
  }

  async processQueue(
    circuitName?: string,
    limit = 10
  ): Promise<{ processed: number; failed: number }> {
    if (this.isProcessing) {
      logger.debug('Queue processing already in progress')
      return { processed: 0, failed: 0 }
    }

    this.isProcessing = true
    let processed = 0
    let failed = 0

    try {
      const supabase = serviceDb()

      for (let i = 0; i < limit; i++) {
        if (circuitName) {
          const state = circuitRegistry.getState(circuitName)
          if (state !== 'CLOSED') {
            logger.debug(
              { circuitName, state },
              'Circuit not closed, stopping queue processing'
            )
            break
          }
        }

        const { data: job, error: claimError } = await supabase.rpc(
          'claim_write_job',
          {
            p_worker_id: this.workerId,
            p_circuit_name: circuitName ?? undefined
          }
        )

        if (claimError) {
          logger.error({ err: claimError }, 'Failed to claim write job')
          break
        }

        if (!job || !job.id) {
          break
        }

        const success = await this.executeWrite(supabase, job)

        const { error: completeError } = await supabase.rpc(
          'complete_write_job',
          {
            p_job_id: (job as { id: string }).id,
            p_success: success,
            p_error: success
              ? undefined
              : (((job as Record<string, unknown>).lastError as
                  string | undefined) ?? undefined)
          }
        )

        if (completeError) {
          logger.error(
            { err: completeError, jobId: job.id },
            'Failed to complete write job'
          )
        }

        if (success) {
          processed++
        } else {
          failed++
        }
      }

      if (processed > 0 || failed > 0) {
        logger.info(
          { processed, failed, circuitName },
          'Queue processing complete'
        )
      }
    } finally {
      this.isProcessing = false
    }

    return { processed, failed }
  }

  private async executeWrite(
    supabase: TypedSupabaseClient,
    job: Record<string, unknown>
  ): Promise<boolean> {
    const operationType = job.operation_type as WriteOperationType
    const targetTable = job.target_table as string
    const payload = job.payload as Record<string, unknown>

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = supabase as any

      switch (operationType) {
        case 'insert': {
          const { error } = await client.from(targetTable).insert(payload)
          if (error) throw error
          break
        }
        case 'update': {
          const { id, ...updateData } = payload
          const { error } = await client
            .from(targetTable)
            .update(updateData)
            .eq('id', id)
          if (error) throw error
          break
        }
        case 'delete': {
          const { id } = payload
          const { error } = await client.from(targetTable).delete().eq('id', id)
          if (error) throw error
          break
        }
        case 'upsert': {
          const { error } = await client.from(targetTable).upsert(payload)
          if (error) throw error
          break
        }
        default:
          throw new Error(`Unknown operation type: ${operationType}`)
      }

      logger.debug(
        { jobId: job.id, operationType, targetTable },
        'Queued write executed successfully'
      )
      return true
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      ;(job as Record<string, unknown>).lastError = errorMessage

      logger.warn(
        { jobId: job.id, operationType, targetTable, err: errorMessage },
        'Queued write execution failed'
      )
      return false
    }
  }

  async getStats(): Promise<WriteQueueStats> {
    try {
      const supabase = serviceDb()

      const { data, error } = await supabase.rpc('get_write_queue_stats')

      if (error) {
        logger.debug(
          { err: error },
          'Failed to get queue stats (function may not exist)'
        )
        return {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          byCircuit: {}
        }
      }

      const stats: WriteQueueStats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        byCircuit: {}
      }

      for (const row of data || []) {
        const status = row.status as keyof Pick<
          WriteQueueStats,
          'pending' | 'processing' | 'completed' | 'failed'
        >
        if (status in stats && typeof stats[status] === 'number') {
          ;(stats as unknown as Record<string, number>)[status] = Number(
            row.count
          )
        }
        if (row.oldest_pending) {
          stats.oldestPending = new Date(row.oldest_pending)
        }
        if (row.by_circuit) {
          Object.assign(stats.byCircuit, row.by_circuit)
        }
      }

      return stats
    } catch (error) {
      logger.error({ err: error }, 'Failed to get queue stats')
      return {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        byCircuit: {}
      }
    }
  }
}

export const writeQueue = new WriteQueueManager()

export function createWriteQueueCallback() {
  return async (
    circuitName: string,
    previousState: CircuitState,
    newState: CircuitState
  ) => {
    if (previousState === 'HALF_OPEN' && newState === 'CLOSED') {
      logger.info({ circuitName }, 'Circuit closed, processing queued writes')
      await writeQueue.processQueue(circuitName)
    }
  }
}

/** Rethrows only if queueing fails. */
export async function withWriteQueue<T>(
  operationType: WriteOperationType,
  targetTable: string,
  payload: Record<string, unknown>,
  operation: () => Promise<T>,
  options: EnqueueWriteOptions = {}
): Promise<{ success: boolean; result?: T; queued?: boolean }> {
  try {
    const result = await operation()
    return { success: true, result }
  } catch (error) {
    const jobId = await writeQueue.enqueue(
      operationType,
      targetTable,
      payload,
      {
        ...options,
        context: {
          ...options.context,
          originalError: error instanceof Error ? error.message : String(error)
        }
      }
    )

    if (jobId) {
      logger.info(
        { operationType, targetTable, jobId },
        'Write operation failed, queued for retry'
      )
      return { success: false, queued: true }
    }

    throw error
  }
}
