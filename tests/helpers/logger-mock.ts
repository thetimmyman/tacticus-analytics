import { vi } from 'vitest'

/** Use: vi.mock('@tacticus/app-core/logger', () => import('@/tests/helpers/logger-mock')) */
export const legacyConsoleLogger = {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn()
}

export const logger = legacyConsoleLogger
