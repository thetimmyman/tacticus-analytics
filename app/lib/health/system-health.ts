import { addInfrastructureAlert } from '@tacticus/app-core/daily-alert-summary'
import * as fs from 'fs'
import * as tls from 'tls'

interface DiskSpaceResult {
  available: boolean
  path?: string
  totalGB?: number
  usedGB?: number
  freeGB?: number
  usedPercent?: number
  error?: string
}

interface SslCertificateResult {
  checked: boolean
  valid: boolean
  daysUntilExpiry?: number
  issuer?: string
  subject?: string
  error?: string
}

function firstCertificateAttribute(
  value: string | string[] | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

async function checkDiskSpace(emitAlerts = true): Promise<DiskSpaceResult> {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return {
      available: false,
      error: 'Serverless environment - disk space not applicable'
    }
  }

  try {
    const checkPath = process.env.DATA_PATH || '/tmp'

    // statfs needs Node 18.15+.
    if ('statfs' in fs.promises) {
      const stats = await (
        fs.promises as unknown as {
          statfs: (path: string) => Promise<{
            bsize: number
            blocks: number
            bfree: number
            bavail: number
          }>
        }
      ).statfs(checkPath)

      const totalBytes = stats.bsize * stats.blocks
      const freeBytes = stats.bsize * stats.bavail
      const usedBytes = totalBytes - freeBytes

      const totalGB = Math.round((totalBytes / (1024 * 1024 * 1024)) * 10) / 10
      const freeGB = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10
      const usedGB = Math.round((usedBytes / (1024 * 1024 * 1024)) * 10) / 10
      const usedPercent = Math.round((usedBytes / totalBytes) * 100)

      if (emitAlerts && usedPercent >= 95) {
        addInfrastructureAlert(
          'Critical Disk Space',
          `Disk usage at ${usedPercent}% (${freeGB}GB free of ${totalGB}GB)`,
          'critical',
          { path: checkPath, usedPercent, freeGB, totalGB }
        )
      } else if (emitAlerts && usedPercent >= 85) {
        addInfrastructureAlert(
          'High Disk Usage',
          `Disk usage at ${usedPercent}% (${freeGB}GB free of ${totalGB}GB)`,
          'warning',
          { path: checkPath, usedPercent, freeGB, totalGB }
        )
      }

      return {
        available: true,
        path: checkPath,
        totalGB,
        usedGB,
        freeGB,
        usedPercent
      }
    }

    return {
      available: false,
      error: 'statfs not available in this Node.js version'
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function checkSslCertificate(
  emitAlerts = true
): Promise<SslCertificateResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL

  if (!appUrl) {
    return { checked: false, valid: true, error: 'No APP_URL configured' }
  }

  try {
    const url = new URL(appUrl)

    if (url.protocol !== 'https:') {
      return { checked: false, valid: true, error: 'Not an HTTPS URL' }
    }

    return new Promise((resolve) => {
      const parsedPort = url.port ? Number.parseInt(url.port, 10) : 443
      const resolvedPort = Number.isFinite(parsedPort) ? parsedPort : 443
      const options = {
        host: url.hostname,
        port: resolvedPort,
        servername: url.hostname,
        rejectUnauthorized: true
      }

      const socket = tls.connect(options, () => {
        const cert = socket.getPeerCertificate()
        socket.end()

        if (!cert || !cert.valid_to) {
          resolve({
            checked: true,
            valid: false,
            error: 'Could not retrieve certificate'
          })
          return
        }

        const expiryDate = new Date(cert.valid_to)
        const now = new Date()
        const daysUntilExpiry = Math.floor(
          (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        )

        if (emitAlerts && daysUntilExpiry <= 0) {
          addInfrastructureAlert(
            'SSL Certificate Expired',
            `SSL certificate for ${url.hostname} has expired`,
            'critical',
            { hostname: url.hostname, expiredDaysAgo: -daysUntilExpiry }
          )
        } else if (emitAlerts && daysUntilExpiry <= 7) {
          addInfrastructureAlert(
            'SSL Certificate Expiring Soon',
            `SSL certificate for ${url.hostname} expires in ${daysUntilExpiry} days`,
            'critical',
            { hostname: url.hostname, daysUntilExpiry }
          )
        } else if (emitAlerts && daysUntilExpiry <= 14) {
          addInfrastructureAlert(
            'SSL Certificate Expiring',
            `SSL certificate for ${url.hostname} expires in ${daysUntilExpiry} days`,
            'error',
            { hostname: url.hostname, daysUntilExpiry }
          )
        } else if (emitAlerts && daysUntilExpiry <= 30) {
          addInfrastructureAlert(
            'SSL Certificate Renewal Needed',
            `SSL certificate for ${url.hostname} expires in ${daysUntilExpiry} days`,
            'warning',
            { hostname: url.hostname, daysUntilExpiry }
          )
        }

        resolve({
          checked: true,
          valid: daysUntilExpiry > 0,
          daysUntilExpiry,
          issuer: firstCertificateAttribute(cert.issuer?.O ?? cert.issuer?.CN),
          subject: firstCertificateAttribute(cert.subject?.CN)
        })
      })

      socket.on('error', (err) => {
        resolve({
          checked: true,
          valid: false,
          error: err.message
        })
      })

      socket.setTimeout(10000, () => {
        socket.destroy()
        resolve({
          checked: false,
          valid: true,
          error: 'Connection timeout'
        })
      })
    })
  } catch (error) {
    return {
      checked: false,
      valid: true,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function runSystemHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<{
  diskSpace: DiskSpaceResult
  sslCertificate: SslCertificateResult
}> {
  const emitAlerts = options.emitAlerts ?? true
  const [diskSpace, sslCertificate] = await Promise.all([
    checkDiskSpace(emitAlerts),
    checkSslCertificate(emitAlerts)
  ])

  return {
    diskSpace,
    sslCertificate
  }
}
