import {
  addInfrastructureAlert,
  addSyncAlert
} from '@tacticus/app-core/daily-alert-summary'
import { serviceDb } from '@/app/lib/db'

interface OnboardingSummary {
  newGuildsToday: number
  guildsOnboarded: Array<{
    name: string
    code: string
    createdAt: string | null
  }>
  failedOnboardings: number
  pendingOnboardings: number
  checked: boolean
}

interface SecuritySummary {
  failedLoginAttempts: number
  suspiciousActivity: boolean
  newAdminUsers: number
  checked: boolean
}

interface DatabaseHealthSummary {
  totalGuilds: number
  activeGuilds: number
  totalPlayers: number
  totalBattleRecords: number
  oldestData: string | null
  checked: boolean
}

export async function checkOnboardingActivity(
  emitAlerts = true
): Promise<OnboardingSummary> {
  try {
    const supabase = serviceDb()
    const yesterday = new Date()
    yesterday.setHours(yesterday.getHours() - 24)

    const { data: newGuilds, error: newGuildsError } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, created_at')
      .gte('created_at', yesterday.toISOString())
      .eq('enabled', true)
      .order('created_at', { ascending: false })
      .limit(20)

    if (newGuildsError) {
      console.error('Error fetching new guilds:', newGuildsError)
      return {
        newGuildsToday: 0,
        guildsOnboarded: [],
        failedOnboardings: 0,
        pendingOnboardings: 0,
        checked: false
      }
    }

    const { count: failedCount } = await supabase
      .from('onboarding_progress')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', yesterday.toISOString())
      .eq('guild_status', 'failed')

    const { count: pendingCount } = await supabase
      .from('onboarding_progress')
      .select('*', { count: 'exact', head: true })
      .in('guild_status', ['pending', 'in_progress'])

    const guildsOnboarded = (newGuilds || []).map((g) => ({
      name: g.display_name || 'Unknown',
      code: g.guild_code,
      createdAt: g.created_at
    }))

    const newGuildsToday = guildsOnboarded.length

    if (emitAlerts && newGuildsToday > 0) {
      addSyncAlert(
        'New Guilds Onboarded',
        `${newGuildsToday} new guild(s) onboarded in the last 24 hours`,
        'info',
        {
          count: newGuildsToday,
          guilds: guildsOnboarded.slice(0, 5).map((g) => g.name)
        }
      )
    }

    if (emitAlerts && (failedCount || 0) > 0) {
      addSyncAlert(
        'Failed Onboardings',
        `${failedCount} onboarding attempt(s) failed in the last 24 hours`,
        'warning',
        {
          failedCount
        }
      )
    }

    if (emitAlerts && (pendingCount || 0) > 10) {
      addSyncAlert(
        'High Pending Onboardings',
        `${pendingCount} onboarding(s) are stuck in pending/in_progress state`,
        'warning',
        {
          pendingCount
        }
      )
    }

    return {
      newGuildsToday,
      guildsOnboarded,
      failedOnboardings: failedCount || 0,
      pendingOnboardings: pendingCount || 0,
      checked: true
    }
  } catch (error) {
    console.error('Onboarding activity check failed:', error)
    return {
      newGuildsToday: 0,
      guildsOnboarded: [],
      failedOnboardings: 0,
      pendingOnboardings: 0,
      checked: false
    }
  }
}

export async function checkSecurityEvents(
  emitAlerts = true
): Promise<SecuritySummary> {
  try {
    const supabase = serviceDb()
    const yesterday = new Date()
    yesterday.setHours(yesterday.getHours() - 24)

    const enableAdminPrivilegeAlerts =
      process.env.ENABLE_ADMIN_PRIVILEGE_ALERTS === 'true'
    let newAdminCount = 0

    // Gated: routine profile updates on admin rows make this noisy.
    if (enableAdminPrivilegeAlerts) {
      const { count, error: adminError } = await supabase
        .from('player_mapping')
        .select('*', { count: 'exact', head: true })
        .eq('is_app_admin', true)
        .eq('is_current', true)
        .gte('updated_at', yesterday.toISOString())

      if (adminError) {
        console.error('Error checking admin users:', adminError)
      } else {
        newAdminCount = count || 0
      }

      if (emitAlerts && newAdminCount > 0) {
        addInfrastructureAlert(
          'New Admin Users',
          `${newAdminCount} app-admin mapping(s) were updated in the last 24 hours`,
          'warning',
          { count: newAdminCount }
        )
      }
    }

    // Checked so a bad column name cannot silently disable this alert.
    const { count: bulkKeyChanges, error: bulkKeyChangesError } = await supabase
      .from('guild_config')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', yesterday.toISOString())
      .not('api_key_encrypted', 'is', null)

    if (bulkKeyChangesError) {
      console.error(
        'Error checking guild_config API key activity:',
        bulkKeyChangesError
      )
    }

    const suspiciousActivity = (bulkKeyChanges || 0) > 20

    if (emitAlerts && suspiciousActivity) {
      addInfrastructureAlert(
        'Unusual API Key Activity',
        `${bulkKeyChanges} API key changes detected in the last 24 hours`,
        'warning',
        { keyChanges: bulkKeyChanges }
      )
    }

    return {
      failedLoginAttempts: 0, // needs auth log access
      suspiciousActivity,
      newAdminUsers: newAdminCount,
      checked: true
    }
  } catch (error) {
    console.error('Security events check failed:', error)
    return {
      failedLoginAttempts: 0,
      suspiciousActivity: false,
      newAdminUsers: 0,
      checked: false
    }
  }
}

export async function checkDatabaseHealth(
  emitAlerts = true
): Promise<DatabaseHealthSummary> {
  try {
    const supabase = serviceDb()

    const { count: totalGuilds } = await supabase
      .from('guild_config')
      .select('*', { count: 'exact', head: true })

    const { count: activeGuilds } = await supabase
      .from('guild_config')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', true)
      .eq('auto_sync_enabled', true)

    const { count: totalPlayers } = await supabase
      .from('player_mapping')
      .select('*', { count: 'exact', head: true })

    const { count: totalBattleRecords } = await supabase
      .from('EOT_GR_data')
      .select('*', { count: 'exact', head: true })

    const { data: oldestRecord } = await supabase
      .from('EOT_GR_data')
      .select('timestamp')
      .order('timestamp', { ascending: true })
      .limit(1)
      .single()

    if (emitAlerts && (totalBattleRecords || 0) > 10000000) {
      addInfrastructureAlert(
        'Large Database Size',
        `Battle records table has ${((totalBattleRecords || 0) / 1000000).toFixed(1)}M records`,
        'info',
        { totalBattleRecords }
      )
    }

    return {
      totalGuilds: totalGuilds || 0,
      activeGuilds: activeGuilds || 0,
      totalPlayers: totalPlayers || 0,
      totalBattleRecords: totalBattleRecords || 0,
      oldestData: oldestRecord?.timestamp || null,
      checked: true
    }
  } catch (error) {
    console.error('Database health check failed:', error)
    return {
      totalGuilds: 0,
      activeGuilds: 0,
      totalPlayers: 0,
      totalBattleRecords: 0,
      oldestData: null,
      checked: false
    }
  }
}

export async function runAdminHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<{
  onboarding: OnboardingSummary
  security: SecuritySummary
  databaseHealth: DatabaseHealthSummary
}> {
  const emitAlerts = options.emitAlerts ?? true
  const [onboarding, security, databaseHealth] = await Promise.all([
    checkOnboardingActivity(emitAlerts),
    checkSecurityEvents(emitAlerts),
    checkDatabaseHealth(emitAlerts)
  ])

  return {
    onboarding,
    security,
    databaseHealth
  }
}
