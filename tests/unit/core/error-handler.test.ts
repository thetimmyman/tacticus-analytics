/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createEnhancedError,
  createError,
  ErrorCodes,
  formatErrorForUser,
  getVersionInfo,
  EnhancedError
} from '@tacticus/app-core/error-handler'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@tacticus/app-core/daily-alert-summary', () => ({
  addErrorAlert: vi.fn(),
  addDatabaseAlert: vi.fn()
}))

vi.mock('../../../version.json', () => ({
  default: { version: '1.0.0-test' }
}))

describe('Error Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.npm_package_version = '1.0.0'
  })

  describe('getVersionInfo', () => {
    it('returns version from env if available', () => {
      process.env.npm_package_version = '2.0.0'
      const info = getVersionInfo()
      expect(info.version).toBe('2.0.0')
    })

    it('falls back to version.json if env missing', () => {
      delete process.env.npm_package_version
      const info = getVersionInfo()
      expect(info.version).toBe('1.0.0-test')
    })
  })

  describe('createEnhancedError', () => {
    it('creates error with context', () => {
      const error = createEnhancedError(
        'TEST_ERROR',
        'Test message',
        'api',
        'medium',
        { userId: 'u1' }
      )

      expect(error.code).toBe('TEST_ERROR')
      expect(error.message).toBe('Test message')
      expect(error.category).toBe('api')
      expect(error.severity).toBe('medium')
      expect(error.context.userId).toBe('u1')
      expect(error.context.timestamp).toBeDefined()
    })

    it('captures stack trace from original error', () => {
      const original = new Error('original')
      const error = createEnhancedError(
        'TEST',
        'Msg',
        'api',
        'medium',
        {},
        original
      )

      expect(error.originalError).toBe(original)
      expect(error.stackTrace).toBe(original.stack)
    })

    it('calls logger', async () => {
      const { legacyConsoleLogger: logger } =
        await import('@tacticus/app-core/logger')
      createEnhancedError('TEST', 'Msg', 'api', 'medium')
      expect(logger.error).toHaveBeenCalled()
    })

    it('triggers alerts for critical errors', async () => {
      const { addErrorAlert } =
        await import('@tacticus/app-core/daily-alert-summary')
      createEnhancedError('CRITICAL_ERR', 'Critical', 'api', 'critical')
      expect(addErrorAlert).toHaveBeenCalled()
    })

    it('triggers database alert for critical database errors', async () => {
      const { addDatabaseAlert } =
        await import('@tacticus/app-core/daily-alert-summary')
      createEnhancedError('DB_ERR', 'Critical DB', 'database', 'critical')
      expect(addDatabaseAlert).toHaveBeenCalled()
    })
  })

  describe('createError', () => {
    it('creates error from predefined code', () => {
      const error = createError('AUTH_REQUIRED', 'Please login')
      expect(error.code).toBe('AUTH_REQUIRED')
      expect(error.category).toBe('auth')
      expect(error.severity).toBe('medium') // From ErrorCodes
    })
  })

  describe('Formatting', () => {
    const error: EnhancedError = {
      code: 'TEST_ERR',
      message: 'Something went wrong',
      category: 'api',
      severity: 'high',
      context: {
        userId: 'u1',
        version: '1.0.0',
        timestamp: '2023-01-01T00:00:00Z'
      },
      troubleshooting: ['Step 1']
    }

    it('formatErrorForUser sanitizes output', () => {
      const formatted = formatErrorForUser(error)
      expect(formatted.message).toBe('Something went wrong')
      expect(formatted.code).toBe('TEST_ERR')
      expect(formatted.supportMessage).toBeDefined()
      expect(formatted.troubleshooting).toBeUndefined()
    })

    it('formatErrorForUser shows troubleshooting for low severity', () => {
      const lowError = { ...error, severity: 'low' as const }
      const formatted = formatErrorForUser(lowError)
      expect(formatted.troubleshooting).toEqual(['Step 1'])
    })

    it('displayMessage keeps a muted diagnostic line for genuine bugs (any high/critical)', () => {
      const formatted = formatErrorForUser(error) // category: 'api', severity: 'high'
      expect(formatted.displayMessage).toContain('Something went wrong')
      expect(formatted.displayMessage).toContain('TEST_ERR')
      expect(formatted.displayMessage).toContain('v1.0.0')
      expect(formatted.displayMessage).toContain('[#Bug Reports]')
      expect(formatted.displayMessage).toContain('\n')

      for (const category of ['validation', 'ui', 'auth', 'network'] as const) {
        const bug = formatErrorForUser({
          ...error,
          category,
          severity: 'critical'
        })
        expect(bug.displayMessage).toContain('TEST_ERR')
      }
    })

    it('displayMessage keeps the diagnostic for medium server-side failures (not user-fixable)', () => {
      // Medium backend errors are not user-fixable, so support still needs the breadcrumb.
      for (const category of ['database', 'api', 'encryption'] as const) {
        const formatted = formatErrorForUser({
          ...error,
          category,
          severity: 'medium'
        })
        expect(formatted.displayMessage).toContain('TEST_ERR')
        expect(formatted.displayMessage).toContain('[#Bug Reports]')
      }
    })

    it('treats WEBHOOK_SAVE_FAILED as a backend save failure, not a user-fixable network issue', () => {
      const enhanced = createError(
        'WEBHOOK_SAVE_FAILED',
        'Unable to save webhook configuration'
      )
      const formatted = formatErrorForUser(enhanced)

      expect(enhanced.category).toBe('database')
      expect(formatted.displayMessage).toContain('WEBHOOK_SAVE_FAILED')
      expect(formatted.displayMessage).toContain('[#Bug Reports]')
    })

    it('keeps the diagnostic breadcrumb for auth codes that wrap backend errors', () => {
      for (const code of [
        'PASSWORD_RESET_FAILED',
        'EMAIL_VERIFICATION_FAILED'
      ]) {
        const formatted = formatErrorForUser({
          ...error,
          code,
          category: 'auth',
          severity: 'medium'
        })
        expect(formatted.displayMessage).toContain(code)
        expect(formatted.displayMessage).toContain('[#Bug Reports]')
      }
    })

    it('displayMessage is the plain human message for user-actionable errors', () => {
      const cases: Array<
        [EnhancedError['category'], EnhancedError['severity']]
      > = [
        ['validation', 'low'],
        ['validation', 'medium'],
        ['ui', 'low'],
        ['auth', 'medium'],
        ['network', 'low']
      ]
      for (const [category, severity] of cases) {
        const formatted = formatErrorForUser({ ...error, category, severity })
        expect(formatted.displayMessage).toContain('Something went wrong')
        expect(formatted.displayMessage).not.toContain('TEST_ERR')
        expect(formatted.displayMessage).not.toContain('Bug Reports')
      }
    })
  })
})
