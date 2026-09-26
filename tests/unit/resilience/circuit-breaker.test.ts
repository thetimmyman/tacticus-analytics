import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/resilience/registry', () => ({
  circuitRegistry: {
    register: vi.fn()
  }
}))

import {
  CircuitBreaker,
  CircuitOpenError,
  DEFAULT_CIRCUIT_CONFIG,
  AGGRESSIVE_CIRCUIT_CONFIG,
  LENIENT_CIRCUIT_CONFIG
} from '@/app/lib/resilience/circuit-breaker'

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker

  beforeEach(() => {
    vi.clearAllMocks()
    breaker = new CircuitBreaker({
      name: 'test-circuit',
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      registerInRegistry: false
    })
  })

  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED')
    })

    it('exposes the circuit name', () => {
      expect(breaker.name).toBe('test-circuit')
    })

    it('reports initial metrics', () => {
      const metrics = breaker.getMetrics()
      expect(metrics.state).toBe('CLOSED')
      expect(metrics.failureCount).toBe(0)
      expect(metrics.successCount).toBe(0)
      expect(metrics.totalRequests).toBe(0)
      expect(metrics.totalFailures).toBe(0)
      expect(metrics.totalSuccesses).toBe(0)
      expect(metrics.lastFailureTime).toBeNull()
      expect(metrics.lastSuccessTime).toBeNull()
    })
  })

  describe('CLOSED state', () => {
    it('passes through successful operations', async () => {
      const result = await breaker.execute(async () => 'success')
      expect(result).toBe('success')
      expect(breaker.getState()).toBe('CLOSED')
    })

    it('counts requests and successes', async () => {
      await breaker.execute(async () => 'ok')
      const metrics = breaker.getMetrics()
      expect(metrics.totalRequests).toBe(1)
      expect(metrics.totalSuccesses).toBe(1)
      expect(metrics.lastSuccessTime).not.toBeNull()
    })

    it('propagates errors from the operation', async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error('fail')
        })
      ).rejects.toThrow('fail')
    })

    it('tracks failure count', async () => {
      try {
        await breaker.execute(async () => {
          throw new Error('1')
        })
      } catch {
        /* expected */
      }
      try {
        await breaker.execute(async () => {
          throw new Error('2')
        })
      } catch {
        /* expected */
      }

      const metrics = breaker.getMetrics()
      expect(metrics.failureCount).toBe(2)
      expect(metrics.totalFailures).toBe(2)
      expect(metrics.lastFailureTime).not.toBeNull()
    })

    it('resets failure count on success', async () => {
      try {
        await breaker.execute(async () => {
          throw new Error('1')
        })
      } catch {
        /* expected */
      }
      try {
        await breaker.execute(async () => {
          throw new Error('2')
        })
      } catch {
        /* expected */
      }
      await breaker.execute(async () => 'success')

      expect(breaker.getMetrics().failureCount).toBe(0)
    })

    it('transitions to OPEN after reaching failure threshold', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error(`fail-${i}`)
          })
        } catch {
          /* expected */
        }
      }

      expect(breaker.getState()).toBe('OPEN')
    })
  })

  describe('OPEN state', () => {
    beforeEach(async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error(`fail-${i}`)
          })
        } catch {
          /* expected */
        }
      }
      expect(breaker.getState()).toBe('OPEN')
    })

    it('rejects requests with CircuitOpenError', async () => {
      await expect(
        breaker.execute(async () => 'should not run')
      ).rejects.toThrow(CircuitOpenError)
    })

    it('includes time until half-open in error', async () => {
      try {
        await breaker.execute(async () => 'should not run')
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError)
        const coe = error as CircuitOpenError
        expect(coe.circuitName).toBe('test-circuit')
        expect(coe.timeUntilHalfOpen).toBeGreaterThan(0)
        expect(coe.timeUntilHalfOpen).toBeLessThanOrEqual(1000)
      }
    })

    it('still counts rejected requests in total', async () => {
      const before = breaker.getMetrics().totalRequests
      try {
        await breaker.execute(async () => 'x')
      } catch {
        /* expected */
      }
      expect(breaker.getMetrics().totalRequests).toBe(before + 1)
    })

    it('uses fallback when provided', async () => {
      const breakerWithFallback = new CircuitBreaker({
        name: 'fallback-test',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 1000,
        registerInRegistry: false,
        fallback: async () => 'fallback-value'
      })

      try {
        await breakerWithFallback.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }
      expect(breakerWithFallback.getState()).toBe('OPEN')

      const result = await breakerWithFallback.execute(
        async () => 'should not run'
      )
      expect(result).toBe('fallback-value')
    })
  })

  describe('HALF_OPEN state and recovery', () => {
    it('transitions to HALF_OPEN after timeout elapses', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'fast-recovery',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50, // 50ms
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }
      expect(fastBreaker.getState()).toBe('OPEN')

      await new Promise((resolve) => setTimeout(resolve, 60))

      const result = await fastBreaker.execute(async () => 'recovered')
      expect(result).toBe('recovered')
      expect(fastBreaker.getState()).toBe('CLOSED') // successThreshold=1, so immediately closes
    })

    it('returns to OPEN on failure during HALF_OPEN', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'half-open-fail',
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 50,
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }

      await new Promise((resolve) => setTimeout(resolve, 60))

      try {
        await fastBreaker.execute(async () => {
          throw new Error('still failing')
        })
      } catch {
        /* expected */
      }
      expect(fastBreaker.getState()).toBe('OPEN')
    })

    it('closes after enough successes in HALF_OPEN', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'multi-success',
        failureThreshold: 1,
        successThreshold: 2,
        timeout: 50,
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }

      await new Promise((resolve) => setTimeout(resolve, 60))

      await fastBreaker.execute(async () => 'ok-1')
      expect(fastBreaker.getState()).toBe('HALF_OPEN')

      await fastBreaker.execute(async () => 'ok-2')
      expect(fastBreaker.getState()).toBe('CLOSED')
    })
  })

  describe('timer-based recovery on state reads (no traffic)', () => {
    // /api/health reads getState() without execute(), so reads must advance OPEN → HALF_OPEN on the timer.
    it('getState() reports HALF_OPEN after the timeout without any execute() call', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'read-recovery-state',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50,
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }
      expect(fastBreaker.getState()).toBe('OPEN')

      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(fastBreaker.getState()).toBe('HALF_OPEN')
    })

    it('getMetrics() reports HALF_OPEN after the timeout without any execute() call', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'read-recovery-metrics',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50,
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }
      expect(fastBreaker.getMetrics().state).toBe('OPEN')

      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(fastBreaker.getMetrics().state).toBe('HALF_OPEN')
    })

    it('still reports OPEN on a read before the timeout window elapses', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'read-recovery-too-soon',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 1000,
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }

      expect(fastBreaker.getState()).toBe('OPEN')
      expect(fastBreaker.getMetrics().state).toBe('OPEN')
    })

    it('a read-driven HALF_OPEN still closes on a subsequent successful execute()', async () => {
      const fastBreaker = new CircuitBreaker({
        name: 'read-then-recover',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50,
        registerInRegistry: false
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }
      await new Promise((resolve) => setTimeout(resolve, 60))

      expect(fastBreaker.getState()).toBe('HALF_OPEN')

      const result = await fastBreaker.execute(async () => 'recovered')
      expect(result).toBe('recovered')
      expect(fastBreaker.getState()).toBe('CLOSED')
    })

    it('fires the state-change callback for the read-driven recovery transition', async () => {
      // alerts.ts separately suppresses OPEN → HALF_OPEN so reads stay quiet.
      const onStateChange = vi.fn()
      const fastBreaker = new CircuitBreaker({
        name: 'read-recovery-callback',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 50,
        registerInRegistry: false,
        onStateChange
      })

      try {
        await fastBreaker.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }
      await new Promise((resolve) => setTimeout(resolve, 60))
      onStateChange.mockClear()

      expect(fastBreaker.getState()).toBe('HALF_OPEN')
      expect(fastBreaker.getState()).toBe('HALF_OPEN')
      expect(fastBreaker.getMetrics().state).toBe('HALF_OPEN')
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onStateChange).toHaveBeenCalledWith(
        'read-recovery-callback',
        'OPEN',
        'HALF_OPEN'
      )
      expect(onStateChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('manual controls', () => {
    it('reset() returns to CLOSED', async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('x')
          })
        } catch {
          /* expected */
        }
      }
      expect(breaker.getState()).toBe('OPEN')

      breaker.reset()
      expect(breaker.getState()).toBe('CLOSED')
      expect(breaker.getMetrics().failureCount).toBe(0)
    })

    it('trip() opens the circuit', () => {
      expect(breaker.getState()).toBe('CLOSED')
      breaker.trip()
      expect(breaker.getState()).toBe('OPEN')
    })

    it('recordSuccess() updates metrics', () => {
      breaker.recordSuccess()
      const metrics = breaker.getMetrics()
      expect(metrics.totalSuccesses).toBe(1)
      expect(metrics.lastSuccessTime).not.toBeNull()
    })

    it('recordFailure() updates metrics and can trip', () => {
      breaker.recordFailure()
      breaker.recordFailure()
      breaker.recordFailure()
      expect(breaker.getState()).toBe('OPEN')
    })
  })

  describe('state change callback', () => {
    it('calls onStateChange when state transitions', async () => {
      const onStateChange = vi.fn()
      const cb = new CircuitBreaker({
        name: 'callback-test',
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 1000,
        registerInRegistry: false,
        onStateChange
      })

      try {
        await cb.execute(async () => {
          throw new Error('trip')
        })
      } catch {
        /* expected */
      }

      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(onStateChange).toHaveBeenCalledWith(
        'callback-test',
        'CLOSED',
        'OPEN'
      )
    })
  })

  describe('preset configs', () => {
    it('DEFAULT_CIRCUIT_CONFIG has expected values', () => {
      expect(DEFAULT_CIRCUIT_CONFIG.failureThreshold).toBe(5)
      expect(DEFAULT_CIRCUIT_CONFIG.successThreshold).toBe(2)
      expect(DEFAULT_CIRCUIT_CONFIG.timeout).toBe(60000)
    })

    it('AGGRESSIVE_CIRCUIT_CONFIG has lower thresholds', () => {
      expect(AGGRESSIVE_CIRCUIT_CONFIG.failureThreshold).toBe(3)
      expect(AGGRESSIVE_CIRCUIT_CONFIG.successThreshold).toBe(3)
      expect(AGGRESSIVE_CIRCUIT_CONFIG.timeout).toBe(30000)
    })

    it('LENIENT_CIRCUIT_CONFIG has higher thresholds', () => {
      expect(LENIENT_CIRCUIT_CONFIG.failureThreshold).toBe(10)
      expect(LENIENT_CIRCUIT_CONFIG.successThreshold).toBe(1)
      expect(LENIENT_CIRCUIT_CONFIG.timeout).toBe(120000)
    })
  })

  describe('CircuitOpenError', () => {
    it('has correct properties', () => {
      const error = new CircuitOpenError('my-circuit', 5000)
      expect(error.circuitName).toBe('my-circuit')
      expect(error.timeUntilHalfOpen).toBe(5000)
      expect(error.name).toBe('CircuitOpenError')
      expect(error.message).toContain('my-circuit')
      expect(error.message).toContain('OPEN')
    })

    it('is an instance of Error', () => {
      const error = new CircuitOpenError('test', 1000)
      expect(error).toBeInstanceOf(Error)
    })
  })
})
