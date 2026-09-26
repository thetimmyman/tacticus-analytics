/** Accumulates alerts through the day and sends one summary email. */

import { Resend } from 'resend'
import { legacyConsoleLogger as logger } from './logger'

const EMAIL_TIMEOUT_MS = 15000

async function withEmailTimeout<T>(
  promise: Promise<T>,
  operationName: string = 'email operation'
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(`${operationName} timed out after ${EMAIL_TIMEOUT_MS}ms`)
      )
    }, EMAIL_TIMEOUT_MS)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

let resendClient: Resend | null = null

function getResendClient(): Resend | null {
  if (typeof window !== 'undefined') return null
  if (!process.env.RESEND_API_KEY) return null
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY)
  }
  return resendClient
}

export type AlertCategory =
  | 'sync' // Guild sync issues
  | 'api_key' // API key problems
  | 'cache' // Cache performance
  | 'database' // Database issues
  | 'error' // Critical errors
  | 'infrastructure' // Memory, disk, etc.
  | 'test_coverage' // Test coverage metrics

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface DailyAlert {
  id: string
  category: AlertCategory
  severity: AlertSeverity
  title: string
  message: string
  details?: Record<string, unknown>
  timestamp: Date
  count: number // For deduplication - how many times this alert occurred
}

class AlertAccumulator {
  private static instance: AlertAccumulator
  private alerts: Map<string, DailyAlert> = new Map()
  private lastSummaryDate: string = ''

  static getInstance(): AlertAccumulator {
    if (!AlertAccumulator.instance) {
      AlertAccumulator.instance = new AlertAccumulator()
    }
    return AlertAccumulator.instance
  }

  /** Alerts with the same category + title are deduplicated and counted. */
  addAlert(alert: Omit<DailyAlert, 'id' | 'timestamp' | 'count'>): void {
    const id = `${alert.category}:${alert.title}`

    const existing = this.alerts.get(id)
    if (existing) {
      existing.count++
      existing.timestamp = new Date() // Update to latest occurrence
      if (alert.details) {
        existing.details = { ...existing.details, ...alert.details }
      }
    } else {
      this.alerts.set(id, {
        ...alert,
        id,
        timestamp: new Date(),
        count: 1
      })
    }
  }

  getAlerts(): DailyAlert[] {
    return Array.from(this.alerts.values())
  }

  getAlertsByCategory(category: AlertCategory): DailyAlert[] {
    return this.getAlerts().filter((a) => a.category === category)
  }

  getAlertsBySeverity(severity: AlertSeverity): DailyAlert[] {
    return this.getAlerts().filter((a) => a.severity === severity)
  }

  clearAlerts(): void {
    this.alerts.clear()
  }

  shouldSendSummary(): boolean {
    const today =
      new Date().toISOString().split('T')[0] ?? new Date().toISOString()
    return this.lastSummaryDate !== today && this.alerts.size > 0
  }

  markSummarySent(): void {
    this.lastSummaryDate =
      new Date().toISOString().split('T')[0] ?? new Date().toISOString()
  }

  getSummaryStats(): {
    total: number
    byCategory: Record<AlertCategory, number>
    bySeverity: Record<AlertSeverity, number>
  } {
    const alerts = this.getAlerts()
    const byCategory: Record<AlertCategory, number> = {
      sync: 0,
      api_key: 0,
      cache: 0,
      database: 0,
      error: 0,
      infrastructure: 0,
      test_coverage: 0
    }
    const bySeverity: Record<AlertSeverity, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0
    }

    alerts.forEach((alert) => {
      byCategory[alert.category] =
        (byCategory[alert.category] || 0) + alert.count
      bySeverity[alert.severity] =
        (bySeverity[alert.severity] || 0) + alert.count
    })

    return {
      total: alerts.reduce((sum, a) => sum + a.count, 0),
      byCategory,
      bySeverity
    }
  }
}

export const alertAccumulator = AlertAccumulator.getInstance()

export function addSyncAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'warning',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'sync',
    severity,
    title,
    message,
    details
  })
}

export function addApiKeyAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'warning',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'api_key',
    severity,
    title,
    message,
    details
  })
}

export function addCacheAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'warning',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'cache',
    severity,
    title,
    message,
    details
  })
}

export function addDatabaseAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'error',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'database',
    severity,
    title,
    message,
    details
  })
}

export function addErrorAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'critical',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'error',
    severity,
    title,
    message,
    details
  })
}

export function addInfrastructureAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'warning',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'infrastructure',
    severity,
    title,
    message,
    details
  })
}

export function addCoverageAlert(
  title: string,
  message: string,
  severity: AlertSeverity = 'warning',
  details?: Record<string, unknown>
): void {
  alertAccumulator.addAlert({
    category: 'test_coverage',
    severity,
    title,
    message,
    details
  })
}

function buildSummaryEmailHtml(
  alerts: DailyAlert[],
  stats: ReturnType<typeof alertAccumulator.getSummaryStats>
): string {
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const severityColors: Record<AlertSeverity, string> = {
    info: '#3498db',
    warning: '#f39c12',
    error: '#e74c3c',
    critical: '#9b59b6'
  }

  const categoryIcons: Record<AlertCategory, string> = {
    sync: '🔄',
    api_key: '🔑',
    cache: '💾',
    database: '🗄️',
    error: '❌',
    infrastructure: '🖥️',
    test_coverage: '📊'
  }

  const sortedAlerts = [...alerts].sort((a, b) => {
    const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  })

  const alertRows = sortedAlerts
    .map(
      (alert) => `
    <tr style="border-bottom: 1px solid #eee;">
      <td style="padding: 12px 8px; vertical-align: top;">
        <span style="font-size: 18px;">${categoryIcons[alert.category]}</span>
      </td>
      <td style="padding: 12px 8px;">
        <div style="font-weight: bold; color: #333;">${alert.title}</div>
        <div style="color: #666; font-size: 14px; margin-top: 4px;">${alert.message}</div>
        ${alert.count > 1 ? `<div style="color: #999; font-size: 12px; margin-top: 4px;">Occurred ${alert.count} times</div>` : ''}
      </td>
      <td style="padding: 12px 8px; text-align: center;">
        <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; color: white; background-color: ${severityColors[alert.severity]};">
          ${alert.severity.toUpperCase()}
        </span>
      </td>
    </tr>
  `
    )
    .join('')

  const hasCritical = stats.bySeverity.critical > 0
  const hasErrors = stats.bySeverity.error > 0
  const headerColor = hasCritical
    ? '#9b59b6'
    : hasErrors
      ? '#e74c3c'
      : '#f39c12'
  const headerText = hasCritical
    ? 'Critical Issues Detected'
    : hasErrors
      ? 'Errors Detected'
      : 'Issues to Review'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily System Summary</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="700" style="background: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 30px; background: ${headerColor}; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">📊 Daily System Summary</h1>
              <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">${date}</p>
              <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; font-weight: bold;">${headerText}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <!-- Summary Stats -->
              <div style="display: flex; margin-bottom: 30px; text-align: center;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding: 15px; background: #f8f8f8; border-radius: 8px; text-align: center; width: 25%;">
                      <div style="font-size: 28px; font-weight: bold; color: #333;">${stats.total}</div>
                      <div style="color: #666; font-size: 12px; text-transform: uppercase;">Total Issues</div>
                    </td>
                    <td style="width: 10px;"></td>
                    <td style="padding: 15px; background: #fef5e7; border-radius: 8px; text-align: center; width: 20%;">
                      <div style="font-size: 24px; font-weight: bold; color: #f39c12;">${stats.bySeverity.warning}</div>
                      <div style="color: #666; font-size: 12px;">Warnings</div>
                    </td>
                    <td style="width: 10px;"></td>
                    <td style="padding: 15px; background: #fdedec; border-radius: 8px; text-align: center; width: 20%;">
                      <div style="font-size: 24px; font-weight: bold; color: #e74c3c;">${stats.bySeverity.error}</div>
                      <div style="color: #666; font-size: 12px;">Errors</div>
                    </td>
                    <td style="width: 10px;"></td>
                    <td style="padding: 15px; background: #f4ecf7; border-radius: 8px; text-align: center; width: 20%;">
                      <div style="font-size: 24px; font-weight: bold; color: #9b59b6;">${stats.bySeverity.critical}</div>
                      <div style="color: #666; font-size: 12px;">Critical</div>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- Category Breakdown -->
              <h3 style="margin: 25px 0 15px 0; color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Issues by Category</h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">🔄</span> Sync Issues</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.sync}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">🔑</span> API Key Issues</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.api_key}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">💾</span> Cache Issues</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.cache}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">🗄️</span> Database Issues</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.database}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">❌</span> Application Errors</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.error}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">🖥️</span> Infrastructure</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.infrastructure}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0;"><span style="margin-right: 8px;">📊</span> Test Coverage</td>
                  <td style="text-align: right; font-weight: bold;">${stats.byCategory.test_coverage}</td>
                </tr>
              </table>

              <!-- Detailed Alerts -->
              <h3 style="margin: 25px 0 15px 0; color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px;">Alert Details</h3>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${alertRows}
              </table>

              <p style="color: #999; font-size: 12px; margin-top: 30px; text-align: center;">
                This is an automated daily summary from Tacticus Analytics.<br>
                Review and address issues as needed.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 30px; background: #f8f8f8; border-radius: 0 0 8px 8px; text-align: center;">
              <p style="margin: 0; color: #999; font-size: 12px;">
                Tacticus Analytics Monitoring System<br>
                © ${new Date().getFullYear()} Tacticus Analytics
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Send the daily summary email if there are alerts (called from a cron job). */
export async function sendDailySummary(): Promise<{
  sent: boolean
  alertCount: number
  error?: string
}> {
  const alerts = alertAccumulator.getAlerts()

  if (alerts.length === 0) {
    return { sent: false, alertCount: 0 }
  }

  const resend = getResendClient()
  if (!resend) {
    logger.warn('Daily summary: RESEND_API_KEY not configured')
    return {
      sent: false,
      alertCount: alerts.length,
      error: 'RESEND_API_KEY not configured'
    }
  }

  const alertRecipient =
    process.env.MONITORING_ALERT_EMAIL || process.env.ADMIN_EMAIL
  if (!alertRecipient) {
    logger.warn(
      'Daily summary: no recipient (set MONITORING_ALERT_EMAIL or ADMIN_EMAIL)'
    )
    return {
      sent: false,
      alertCount: alerts.length,
      error: 'MONITORING_ALERT_EMAIL / ADMIN_EMAIL not configured'
    }
  }
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    'Tacticus Analytics <alerts@tacticusanalytics.com>'
  const stats = alertAccumulator.getSummaryStats()

  try {
    const response = await withEmailTimeout(
      resend.emails.send({
        from: fromEmail,
        to: alertRecipient,
        subject: `📊 Daily Summary: ${stats.total} issue(s) - ${stats.bySeverity.critical} critical, ${stats.bySeverity.error} errors`,
        html: buildSummaryEmailHtml(alerts, stats)
      }),
      'send daily summary email'
    )

    if (response.error) {
      logger.error('Failed to send daily summary email', {
        error: response.error
      })
      return {
        sent: false,
        alertCount: alerts.length,
        error: response.error.message
      }
    }

    alertAccumulator.clearAlerts()
    alertAccumulator.markSummarySent()

    logger.info('Daily summary email sent', {
      alertCount: alerts.length,
      stats
    })

    return { sent: true, alertCount: alerts.length }
  } catch (error) {
    logger.error('Error sending daily summary email', { error })
    return {
      sent: false,
      alertCount: alerts.length,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export function getAlertSummary(): {
  alerts: DailyAlert[]
  stats: ReturnType<typeof alertAccumulator.getSummaryStats>
} {
  return {
    alerts: alertAccumulator.getAlerts(),
    stats: alertAccumulator.getSummaryStats()
  }
}
