import {
  addInfrastructureAlert,
  addSyncAlert
} from '@tacticus/app-core/daily-alert-summary'
import { serviceDb } from '@/app/lib/db'

interface SyncFailurePattern {
  errorType: string
  count: number
  guilds: string[]
}

interface SyncHealthResults {
  totalActiveGuilds: number
  failingGuilds: number
  disabledDueToFailures: number
  commonErrorPatterns: SyncFailurePattern[]
  avgConsecutiveFailures: number
  checked: boolean
}

/** Uses serviceDb(): anon's guild_config grant excludes sync state; do not widen it (key material). */
export async function analyzeSyncFailurePatterns(
  emitAlerts = true
): Promise<SyncHealthResults> {
  try {
    const supabase = serviceDb()

    const { data: guilds, error } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, auto_sync_enabled, consecutive_sync_failures, enabled'
      )
      .eq('enabled', true)

    if (error) {
      console.error('Error fetching guild sync data:', error)
      return {
        totalActiveGuilds: 0,
        failingGuilds: 0,
        disabledDueToFailures: 0,
        commonErrorPatterns: [],
        avgConsecutiveFailures: 0,
        checked: false
      }
    }

    const activeGuilds = guilds || []
    const totalActiveGuilds = activeGuilds.length

    const failingGuilds = activeGuilds.filter(
      (g) => (g.consecutive_sync_failures || 0) >= 3
    )

    const disabledDueToFailures = activeGuilds.filter(
      (g) => !g.auto_sync_enabled && (g.consecutive_sync_failures || 0) >= 3
    )

    const errorPatterns = new Map<string, { count: number; guilds: string[] }>()

    for (const guild of failingGuilds) {
      const errorType = 'Sync Failures'
      const pattern = errorPatterns.get(errorType) || { count: 0, guilds: [] }
      pattern.count++
      pattern.guilds.push(guild.display_name || guild.guild_code)
      errorPatterns.set(errorType, pattern)
    }

    const commonErrorPatterns: SyncFailurePattern[] = Array.from(
      errorPatterns.entries()
    )
      .map(([errorType, data]) => ({
        errorType,
        count: data.count,
        guilds: data.guilds.slice(0, 5)
      }))
      .sort((a, b) => b.count - a.count)

    const totalFailures = activeGuilds.reduce(
      (sum, g) => sum + (g.consecutive_sync_failures || 0),
      0
    )
    const avgConsecutiveFailures =
      totalActiveGuilds > 0 ? totalFailures / totalActiveGuilds : 0

    if (failingGuilds.length > 0) {
      const failureRate = (failingGuilds.length / totalActiveGuilds) * 100

      if (emitAlerts && failureRate >= 50) {
        addInfrastructureAlert(
          'Critical Sync Infrastructure Issue',
          `${failingGuilds.length} of ${totalActiveGuilds} guilds (${Math.round(failureRate)}%) are failing to sync`,
          'critical',
          {
            failingGuilds: failingGuilds.length,
            totalActiveGuilds,
            failureRate: Math.round(failureRate),
            topErrors: commonErrorPatterns.slice(0, 3)
          }
        )
      } else if (emitAlerts && failureRate >= 20) {
        addSyncAlert(
          'High Sync Failure Rate',
          `${failingGuilds.length} of ${totalActiveGuilds} guilds (${Math.round(failureRate)}%) are failing to sync`,
          'error',
          {
            failingGuilds: failingGuilds.length,
            totalActiveGuilds,
            failureRate: Math.round(failureRate)
          }
        )
      }

      for (const pattern of commonErrorPatterns) {
        if (!emitAlerts) continue

        if (pattern.errorType === 'Timeout' && pattern.count >= 5) {
          addInfrastructureAlert(
            'Sync Timeout Pattern Detected',
            `${pattern.count} guilds experiencing sync timeouts - may indicate API or network issues`,
            'warning',
            {
              affectedGuilds: pattern.guilds,
              count: pattern.count
            }
          )
        } else if (pattern.errorType === 'Server Error' && pattern.count >= 3) {
          addInfrastructureAlert(
            'External API Server Errors',
            `${pattern.count} guilds failing due to server errors from external API`,
            'warning',
            {
              affectedGuilds: pattern.guilds,
              count: pattern.count
            }
          )
        } else if (
          pattern.errorType === 'Encryption Error' &&
          pattern.count >= 1
        ) {
          addInfrastructureAlert(
            'Encryption Key Issues',
            `${pattern.count} guilds have encryption/decryption errors - check ENCRYPTION_KEY`,
            'critical',
            {
              affectedGuilds: pattern.guilds,
              count: pattern.count
            }
          )
        }
      }
    }

    if (emitAlerts && disabledDueToFailures.length > 0) {
      addSyncAlert(
        'Guilds Auto-Disabled',
        `${disabledDueToFailures.length} guilds have been auto-disabled due to repeated sync failures`,
        'warning',
        {
          disabledCount: disabledDueToFailures.length,
          guilds: disabledDueToFailures
            .map((g) => g.display_name || g.guild_code)
            .slice(0, 10)
        }
      )
    }

    return {
      totalActiveGuilds,
      failingGuilds: failingGuilds.length,
      disabledDueToFailures: disabledDueToFailures.length,
      commonErrorPatterns,
      avgConsecutiveFailures: Math.round(avgConsecutiveFailures * 100) / 100,
      checked: true
    }
  } catch (error) {
    console.error('Sync failure analysis failed:', error)
    return {
      totalActiveGuilds: 0,
      failingGuilds: 0,
      disabledDueToFailures: 0,
      commonErrorPatterns: [],
      avgConsecutiveFailures: 0,
      checked: false
    }
  }
}

export async function runSyncHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<SyncHealthResults> {
  return await analyzeSyncFailurePatterns(options.emitAlerts ?? true)
}
