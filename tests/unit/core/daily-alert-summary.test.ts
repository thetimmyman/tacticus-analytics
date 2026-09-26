/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Daily Alert Summary Core', () => {
  const originalEnv = { ...process.env }
  let alertAccumulator: any
  let addSyncAlert: any
  let addApiKeyAlert: any
  let addCacheAlert: any
  let addDatabaseAlert: any
  let addErrorAlert: any
  let addInfrastructureAlert: any
  let sendDailySummary: any
  let mockSend: any
  let mockResendConstructor: any

  beforeEach(async () => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      MONITORING_ALERT_EMAIL: 'alerts@example.test'
    }

    mockSend = vi.fn()
    mockResendConstructor = vi.fn().mockReturnValue({
      emails: {
        send: mockSend
      }
    })

    vi.doMock('resend', () => ({
      Resend: mockResendConstructor
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

    const module = await import('@tacticus/app-core/daily-alert-summary')
    alertAccumulator = module.alertAccumulator
    addSyncAlert = module.addSyncAlert
    addApiKeyAlert = module.addApiKeyAlert
    addCacheAlert = module.addCacheAlert
    addDatabaseAlert = module.addDatabaseAlert
    addErrorAlert = module.addErrorAlert
    addInfrastructureAlert = module.addInfrastructureAlert
    sendDailySummary = module.sendDailySummary

    alertAccumulator.clearAlerts()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.clearAllMocks()
  })

  describe('AlertAccumulator', () => {
    it('should add and retrieve alerts', () => {
      alertAccumulator.addAlert({
        category: 'sync',
        severity: 'warning',
        title: 'Test Alert',
        message: 'This is a test alert'
      })

      const alerts = alertAccumulator.getAlerts()
      expect(alerts).toHaveLength(1)
      expect(alerts[0]).toMatchObject({
        category: 'sync',
        severity: 'warning',
        title: 'Test Alert',
        message: 'This is a test alert',
        count: 1
      })
      expect(alerts[0].id).toBe('sync:Test Alert')
    })

    it('should deduplicate alerts and increment count', () => {
      alertAccumulator.addAlert({
        category: 'sync',
        severity: 'warning',
        title: 'Duplicate Alert',
        message: 'First occurrence'
      })

      alertAccumulator.addAlert({
        category: 'sync',
        severity: 'warning',
        title: 'Duplicate Alert',
        message: 'Second occurrence'
      })

      const alerts = alertAccumulator.getAlerts()
      expect(alerts).toHaveLength(1)
      expect(alerts[0].count).toBe(2)
      expect(alerts[0].title).toBe('Duplicate Alert')
    })

    it('should update details on duplicate alert', () => {
      alertAccumulator.addAlert({
        category: 'database',
        severity: 'error',
        title: 'DB Error',
        message: 'Connection failed',
        details: { retries: 1 }
      })

      alertAccumulator.addAlert({
        category: 'database',
        severity: 'error',
        title: 'DB Error',
        message: 'Connection failed again',
        details: { lastError: 'Timeout' }
      })

      const alerts = alertAccumulator.getAlerts()
      expect(alerts).toHaveLength(1)
      expect(alerts[0].count).toBe(2)
      expect(alerts[0].details).toEqual({
        retries: 1,
        lastError: 'Timeout'
      })
    })

    it('should filter alerts by category', () => {
      addSyncAlert('Sync Issue', 'Sync failed')
      addDatabaseAlert('DB Issue', 'DB failed')

      const syncAlerts = alertAccumulator.getAlertsByCategory('sync')
      expect(syncAlerts).toHaveLength(1)
      expect(syncAlerts[0].title).toBe('Sync Issue')

      const dbAlerts = alertAccumulator.getAlertsByCategory('database')
      expect(dbAlerts).toHaveLength(1)
      expect(dbAlerts[0].title).toBe('DB Issue')
    })

    it('should filter alerts by severity', () => {
      addSyncAlert('Warning', 'Warning message', 'warning')
      addDatabaseAlert('Error', 'Error message', 'error')

      const warnings = alertAccumulator.getAlertsBySeverity('warning')
      expect(warnings).toHaveLength(1)
      expect(warnings[0].severity).toBe('warning')

      const errors = alertAccumulator.getAlertsBySeverity('error')
      expect(errors).toHaveLength(1)
      expect(errors[0].severity).toBe('error')
    })

    it('should calculate summary stats correctly', () => {
      addSyncAlert('Sync 1', 'Msg')
      addSyncAlert('Sync 2', 'Msg')
      addDatabaseAlert('DB 1', 'Msg', 'error')

      addDatabaseAlert('DB 1', 'Msg', 'error')

      const stats = alertAccumulator.getSummaryStats()

      expect(stats.total).toBe(4)

      expect(stats.byCategory.sync).toBe(2)
      expect(stats.byCategory.database).toBe(2)

      expect(stats.bySeverity.warning).toBe(2)
      expect(stats.bySeverity.error).toBe(2)
    })

    it('should track sent summary date', () => {
      alertAccumulator.addAlert({
        category: 'info',
        severity: 'info',
        title: 'Info',
        message: 'Info'
      })

      alertAccumulator.markSummarySent()

      const shouldSend = alertAccumulator.shouldSendSummary()
      expect(shouldSend).toBe(false)
    })
  })

  describe('Helper Functions', () => {
    it('addSyncAlert adds a sync alert', () => {
      addSyncAlert('Sync Title', 'Sync Message')
      const alerts = alertAccumulator.getAlertsByCategory('sync')
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('sync')
    })

    it('addApiKeyAlert adds an api_key alert', () => {
      addApiKeyAlert('Key Title', 'Key Message')
      const alerts = alertAccumulator.getAlertsByCategory('api_key')
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('api_key')
    })

    it('addCacheAlert adds a cache alert', () => {
      addCacheAlert('Cache Title', 'Cache Message')
      const alerts = alertAccumulator.getAlertsByCategory('cache')
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('cache')
    })

    it('addDatabaseAlert adds a database alert', () => {
      addDatabaseAlert('DB Title', 'DB Message')
      const alerts = alertAccumulator.getAlertsByCategory('database')
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('database')
      expect(alerts[0].severity).toBe('error') // default
    })

    it('addErrorAlert adds an error alert', () => {
      addErrorAlert('Error Title', 'Error Message')
      const alerts = alertAccumulator.getAlertsByCategory('error')
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('error')
      expect(alerts[0].severity).toBe('critical') // default
    })

    it('addInfrastructureAlert adds an infrastructure alert', () => {
      addInfrastructureAlert('Infra Title', 'Infra Message')
      const alerts = alertAccumulator.getAlertsByCategory('infrastructure')
      expect(alerts).toHaveLength(1)
      expect(alerts[0].category).toBe('infrastructure')
    })
  })

  describe('sendDailySummary', () => {
    it('should return sent: false if no alerts', async () => {
      const result = await sendDailySummary()
      expect(result).toEqual({ sent: false, alertCount: 0 })
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should return sent: false if RESEND_API_KEY is missing', async () => {
      delete process.env.RESEND_API_KEY
      addSyncAlert('Test', 'Msg')

      const result = await sendDailySummary()
      expect(result.sent).toBe(false)
      expect(result.error).toContain('RESEND_API_KEY')
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should return sent: false when no recipient is configured', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      delete process.env.MONITORING_ALERT_EMAIL
      delete process.env.ADMIN_EMAIL
      addSyncAlert('Test', 'Msg')

      const result = await sendDailySummary()
      expect(result.sent).toBe(false)
      expect(result.error).toContain('MONITORING_ALERT_EMAIL')
      expect(mockSend).not.toHaveBeenCalled()
      expect(alertAccumulator.getAlerts()).toHaveLength(1)
    })

    it('sends to MONITORING_ALERT_EMAIL, falling back to ADMIN_EMAIL', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      delete process.env.MONITORING_ALERT_EMAIL
      process.env.ADMIN_EMAIL = 'admin@example.test'
      addSyncAlert('Test', 'Msg')
      mockSend.mockResolvedValueOnce({ id: '123', error: null })

      await sendDailySummary()
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin@example.test' })
      )
    })

    it('should send email and clear alerts on success', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      addSyncAlert('Test', 'Msg')

      mockSend.mockResolvedValueOnce({ id: '123', error: null })

      const result = await sendDailySummary()
      expect(result.sent).toBe(true)
      expect(result.alertCount).toBe(1)
      expect(mockSend).toHaveBeenCalled()

      expect(alertAccumulator.getAlerts()).toHaveLength(0)
    })

    it('should handle Resend errors', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      addSyncAlert('Test', 'Msg')

      mockSend.mockResolvedValueOnce({ error: { message: 'Failed to send' } })

      const result = await sendDailySummary()
      expect(result.sent).toBe(false)
      expect(result.error).toBe('Failed to send')

      expect(alertAccumulator.getAlerts()).toHaveLength(1)
    })

    it('should handle thrown errors during send', async () => {
      process.env.RESEND_API_KEY = 'test-key'
      addSyncAlert('Test', 'Msg')

      mockSend.mockRejectedValueOnce(new Error('Network error'))

      const result = await sendDailySummary()
      expect(result.sent).toBe(false)
      expect(result.error).toBe('Network error')
    })
  })
})
