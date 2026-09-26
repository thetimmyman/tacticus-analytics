import { describe, expect, it, vi } from 'vitest'
import { TACTICUS_CIRCUIT_NAME } from '@/app/lib/api/tacticus-client'
import { circuitRegistry } from '@/app/lib/resilience'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

/** An unknown circuit name reads as healthy, so a one-sided rename silently disables the outage guard. */
describe('Tacticus circuit registration', () => {
  it('registers under the exported name', async () => {
    // CircuitBreaker registers itself through a lazy dynamic import.
    await vi.waitFor(() =>
      expect(circuitRegistry.has(TACTICUS_CIRCUIT_NAME)).toBe(true)
    )
  })
})
