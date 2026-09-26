import { addInfrastructureAlert } from '@tacticus/app-core/daily-alert-summary'
import * as fs from 'fs'

interface BackupStatusResult {
  checked: boolean
  backupConfigured: boolean
  lastBackupAge?: number // hours since last backup
  backupHealthy: boolean
  error?: string
}

const BACKUP_WARNING_HOURS = 24 // Warn if backup older than 24 hours
const BACKUP_CRITICAL_HOURS = 48 // Critical if backup older than 48 hours
const DEFAULT_BACKUP_MARKER_PATH = '/var/backup/.last_backup'

async function checkEnvBackupStatus(): Promise<{
  configured: boolean
  lastBackupTime?: Date
}> {
  const lastBackupEnv = process.env.BACKUP_LAST_SUCCESS

  if (!lastBackupEnv) {
    return { configured: false }
  }

  try {
    const lastBackupTime = new Date(lastBackupEnv)
    if (isNaN(lastBackupTime.getTime())) {
      return { configured: false }
    }
    return { configured: true, lastBackupTime }
  } catch {
    return { configured: false }
  }
}

async function checkFileBackupStatus(): Promise<{
  configured: boolean
  lastBackupTime?: Date
}> {
  const configuredMarkerPath = process.env.BACKUP_MARKER_PATH

  try {
    const stats = configuredMarkerPath
      ? fs.statSync(/* turbopackIgnore: true */ configuredMarkerPath)
      : fs.statSync(DEFAULT_BACKUP_MARKER_PATH)
    return { configured: true, lastBackupTime: stats.mtime }
  } catch {
    return { configured: false }
  }
}

async function checkDatabaseBackupStatus(): Promise<{
  configured: boolean
  lastBackupTime?: Date
  status?: string
}> {
  return { configured: false }
}

/** BACKUP_STATUS_URL must return { lastBackup: "<ISO timestamp>" }. */
async function checkHttpBackupStatus(): Promise<{
  configured: boolean
  lastBackupTime?: Date
}> {
  const backupStatusUrl = process.env.BACKUP_STATUS_URL

  if (!backupStatusUrl) {
    return { configured: false }
  }

  try {
    const response = await fetch(backupStatusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
      return { configured: true } // Configured but failed to get status
    }

    const data = (await response.json()) as {
      lastBackup?: string
      last_backup?: string
    }
    const lastBackupStr = data.lastBackup || data.last_backup

    if (lastBackupStr) {
      return { configured: true, lastBackupTime: new Date(lastBackupStr) }
    }

    return { configured: true }
  } catch {
    return { configured: false }
  }
}

export async function checkBackupStatus(
  emitAlerts = true
): Promise<BackupStatusResult> {
  const envStatus = await checkEnvBackupStatus()
  const fileStatus = await checkFileBackupStatus()
  const dbStatus = await checkDatabaseBackupStatus()
  const httpStatus = await checkHttpBackupStatus()

  const backupTimes: Date[] = []
  if (envStatus.lastBackupTime) backupTimes.push(envStatus.lastBackupTime)
  if (fileStatus.lastBackupTime) backupTimes.push(fileStatus.lastBackupTime)
  if (dbStatus.lastBackupTime) backupTimes.push(dbStatus.lastBackupTime)
  if (httpStatus.lastBackupTime) backupTimes.push(httpStatus.lastBackupTime)

  const isConfigured =
    envStatus.configured ||
    fileStatus.configured ||
    dbStatus.configured ||
    httpStatus.configured

  if (!isConfigured) {
    return {
      checked: true,
      backupConfigured: false,
      backupHealthy: true,
      error:
        'No backup monitoring configured (set BACKUP_LAST_SUCCESS, BACKUP_STATUS_URL, or BACKUP_MARKER_PATH)'
    }
  }

  if (backupTimes.length === 0) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'No Backup Found',
        'Backup monitoring is configured but no successful backup was found',
        'error',
        {
          envConfigured: envStatus.configured,
          fileConfigured: fileStatus.configured,
          dbConfigured: dbStatus.configured,
          httpConfigured: httpStatus.configured
        }
      )
    }

    return {
      checked: true,
      backupConfigured: true,
      backupHealthy: false,
      error: 'No successful backup found'
    }
  }

  const lastBackup = new Date(Math.max(...backupTimes.map((d) => d.getTime())))
  const hoursSinceBackup =
    (Date.now() - lastBackup.getTime()) / (1000 * 60 * 60)

  if (emitAlerts && hoursSinceBackup >= BACKUP_CRITICAL_HOURS) {
    addInfrastructureAlert(
      'Critical: Backup Overdue',
      `Last backup was ${Math.round(hoursSinceBackup)} hours ago (threshold: ${BACKUP_CRITICAL_HOURS}h)`,
      'critical',
      {
        hoursSinceBackup: Math.round(hoursSinceBackup),
        lastBackup: lastBackup.toISOString(),
        threshold: BACKUP_CRITICAL_HOURS
      }
    )
  } else if (emitAlerts && hoursSinceBackup >= BACKUP_WARNING_HOURS) {
    addInfrastructureAlert(
      'Backup Aging',
      `Last backup was ${Math.round(hoursSinceBackup)} hours ago (warning threshold: ${BACKUP_WARNING_HOURS}h)`,
      'warning',
      {
        hoursSinceBackup: Math.round(hoursSinceBackup),
        lastBackup: lastBackup.toISOString(),
        threshold: BACKUP_WARNING_HOURS
      }
    )
  }

  return {
    checked: true,
    backupConfigured: true,
    lastBackupAge: Math.round(hoursSinceBackup),
    backupHealthy: hoursSinceBackup < BACKUP_CRITICAL_HOURS
  }
}

export async function runBackupHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<BackupStatusResult> {
  return await checkBackupStatus(options.emitAlerts ?? true)
}
