import {
  addSyncAlert,
  addDatabaseAlert,
  addInfrastructureAlert
} from '@tacticus/app-core/daily-alert-summary'
import { serviceDb } from '@/app/lib/db'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'

interface DataIntegrityResults {
  orphanedPlayers: { count: number; checked: boolean }
  syncGaps: { count: number; guilds: string[]; checked: boolean }
  seasonDataIntegrity: { healthy: boolean; issues: string[]; checked: boolean }
  staleGuilds: { count: number; guilds: string[]; checked: boolean }
  excludedGuilds: {
    count: number
    guilds: string[]
    memberCount: number | null
    checked: boolean
  }
}

async function checkOrphanedPlayers(
  emitAlerts = true
): Promise<{ count: number; checked: boolean }> {
  try {
    const supabase = serviceDb()

    const { data, error } = await supabase
      .from('player_mapping')
      .select(
        `
        id,
        guild_code,
        guild_config!inner(enabled)
      `
      )
      .eq('guild_config.enabled', false)
      .limit(100)

    if (error) {
      console.error('Error checking orphaned players:', error)
      return { count: 0, checked: false }
    }

    const orphanedCount = data?.length || 0

    if (emitAlerts && orphanedCount > 0) {
      addDatabaseAlert(
        'Orphaned Player Mappings',
        `Found ${orphanedCount} player mappings associated with disabled guilds`,
        orphanedCount > 50 ? 'warning' : 'info',
        {
          orphanedCount,
          sampleCount: Math.min(orphanedCount, 100)
        }
      )
    }

    return { count: orphanedCount, checked: true }
  } catch (error) {
    console.error('Orphaned players check failed:', error)
    return { count: 0, checked: false }
  }
}

async function checkSyncGaps(
  emitAlerts = true
): Promise<{ count: number; guilds: string[]; checked: boolean }> {
  try {
    const supabase = serviceDb()
    const timing = await getSeasonTiming()
    const currentSeason = String(timing.seasonNumber)

    const { data: guilds, error: guildsError } = await supabase
      .from('guild_config')
      .select('guild_code, display_name, last_successful_sync')
      .eq('enabled', true)
      .eq('auto_sync_enabled', true)

    if (guildsError) {
      console.error('Error fetching guilds for sync gap check:', guildsError)
      return { count: 0, guilds: [], checked: false }
    }

    const guildsWithGaps: string[] = []

    for (const guild of guilds || []) {
      const { count, error: dataError } = await supabase
        .from('EOT_GR_data')
        .select('*', { count: 'exact', head: true })
        .eq('Guild', guild.guild_code)
        .eq('Season', currentSeason)

      if (!dataError && (count === null || count === 0)) {
        guildsWithGaps.push(guild.display_name || guild.guild_code)
      }

      if (guildsWithGaps.length >= 20) break
    }

    if (emitAlerts && guildsWithGaps.length > 0) {
      addSyncAlert(
        'Missing Season Data',
        `${guildsWithGaps.length} active guilds have no data for season ${currentSeason}`,
        guildsWithGaps.length > 10 ? 'error' : 'warning',
        {
          season: currentSeason,
          affectedGuilds: guildsWithGaps.slice(0, 10),
          totalAffected: guildsWithGaps.length
        }
      )
    }

    return {
      count: guildsWithGaps.length,
      guilds: guildsWithGaps,
      checked: true
    }
  } catch (error) {
    console.error('Sync gaps check failed:', error)
    return { count: 0, guilds: [], checked: false }
  }
}

async function checkSeasonDataIntegrity(
  emitAlerts = true
): Promise<{ healthy: boolean; issues: string[]; checked: boolean }> {
  try {
    const supabase = serviceDb()
    const timing = await getSeasonTiming()
    const currentSeason = timing.seasonNumber
    const issues: string[] = []

    const { data: tracking, error: trackingError } = await supabase
      .from('season_tracking')
      .select('*')
      .order('id', { ascending: false })
      .limit(1)
      .single()

    if (trackingError && trackingError.code !== 'PGRST116') {
      issues.push(`Season tracking query failed: ${trackingError.message}`)
    } else if (tracking) {
      if (tracking.last_tracked_season < currentSeason - 1) {
        issues.push(
          `Season tracking is ${currentSeason - 1 - tracking.last_tracked_season} seasons behind`
        )
      }

      if (tracking.last_check_date) {
        const lastCheck = new Date(tracking.last_check_date)
        const hoursSinceCheck =
          (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60)
        if (hoursSinceCheck > 48) {
          issues.push(
            `Season transition monitor hasn't run in ${Math.round(hoursSinceCheck)} hours`
          )
        }
      }
    }

    if (emitAlerts && issues.length > 0) {
      addSyncAlert(
        'Season Data Integrity Issues',
        issues.join('; '),
        issues.length > 1 ? 'error' : 'warning',
        {
          currentSeason,
          issues
        }
      )
    }

    return { healthy: issues.length === 0, issues, checked: true }
  } catch (error) {
    console.error('Season data integrity check failed:', error)
    return { healthy: false, issues: ['Check failed'], checked: false }
  }
}

async function checkStaleGuilds(
  emitAlerts = true
): Promise<{ count: number; guilds: string[]; checked: boolean }> {
  try {
    const supabase = serviceDb()

    const staleThreshold = new Date()
    staleThreshold.setHours(staleThreshold.getHours() - 48)

    const { data: staleGuilds, error } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, last_successful_sync, consecutive_sync_failures'
      )
      .eq('enabled', true)
      .eq('auto_sync_enabled', true)
      // `NULL < ts` is NULL in SQL, so a bare .lt() would drop never-synced guilds.
      .or(
        `last_successful_sync.is.null,last_successful_sync.lt.${staleThreshold.toISOString()}`
      )
      .limit(20)

    if (error) {
      console.error('Error checking stale guilds:', error)
      return { count: 0, guilds: [], checked: false }
    }

    const staleGuildNames = (staleGuilds || []).map(
      (g) => g.display_name || g.guild_code
    )

    if (emitAlerts && staleGuildNames.length > 0) {
      addSyncAlert(
        'Severely Stale Guild Data',
        `${staleGuildNames.length} guilds haven't synced in over 48 hours`,
        staleGuildNames.length > 5 ? 'error' : 'warning',
        {
          threshold: '48 hours',
          affectedGuilds: staleGuildNames,
          count: staleGuildNames.length
        }
      )
    }

    return {
      count: staleGuildNames.length,
      guilds: staleGuildNames,
      checked: true
    }
  } catch (error) {
    console.error('Stale guilds check failed:', error)
    return { count: 0, guilds: [], checked: false }
  }
}

async function checkEncryptionHealth(
  emitAlerts = true
): Promise<{ healthy: boolean; checked: boolean }> {
  try {
    const supabase = serviceDb()

    const { data: guildsWithErrors, error } = await supabase
      .from('guild_sync_status')
      .select('guild_code, error_message, last_error')
      .or(
        'error_message.ilike.%decrypt%,error_message.ilike.%encryption%,error_message.ilike.%cipher%,last_error.ilike.%decrypt%,last_error.ilike.%encryption%,last_error.ilike.%cipher%'
      )
      .limit(10)

    if (error) {
      console.error('Error checking encryption health:', error)
      return { healthy: true, checked: false }
    }

    if (emitAlerts && guildsWithErrors && guildsWithErrors.length > 0) {
      addInfrastructureAlert(
        'Encryption Key Issues Detected',
        `${guildsWithErrors.length} guilds have sync errors related to encryption/decryption`,
        'critical',
        {
          affectedGuilds: guildsWithErrors.map((g) => g.guild_code),
          sampleError:
            guildsWithErrors[0]?.error_message ??
            guildsWithErrors[0]?.last_error
        }
      )
      return { healthy: false, checked: true }
    }

    return { healthy: true, checked: true }
  } catch (error) {
    console.error('Encryption health check failed:', error)
    return { healthy: true, checked: false }
  }
}

/** Every automated selector excludes these guilds, so nothing else monitors them. */
async function checkExcludedGuilds(emitAlerts = true): Promise<{
  count: number
  guilds: string[]
  /** NULL means the impact could not be read; never treat it as zero. */
  memberCount: number | null
  checked: boolean
}> {
  try {
    const supabase = serviceDb()

    const staleThresholdMs = Date.now() - 24 * 60 * 60 * 1000

    // A second `.or()` fails silently as an empty result (a false all-clear); filter staleness in JS.
    const { data: excluded, error } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, api_key_is_valid, auto_sync_enabled, last_successful_sync, consecutive_sync_failures'
      )
      .eq('enabled', true)
      // Excluded from EVERY lane = intersection of the guild-batch-sync and sync-scheduler skips.
      // `api_key_encrypted` is filtered but never SELECTed: no ciphertext here.
      .or(
        'api_key_is_valid.is.false,and(auto_sync_enabled.not.is.true,api_key_encrypted.is.null)'
      )
      .limit(100)

    if (error) {
      console.error('Error checking excluded guilds:', error)
      return { count: 0, guilds: [], memberCount: 0, checked: false }
    }

    const rows = (excluded ?? []).filter((g) => {
      if (!g.last_successful_sync) return true
      const at = Date.parse(g.last_successful_sync)
      return !Number.isFinite(at) || at < staleThresholdMs
    })

    if (rows.length === 0) {
      return { count: 0, guilds: [], memberCount: 0, checked: true }
    }

    const codes = rows.map((g) => g.guild_code)
    const { data: members, error: memberError } = await supabase
      .from('player_mapping')
      .select('guild_code')
      .in('guild_code', codes)
      .eq('is_current', true)

    // A failed read is unknown, never 0, which would downgrade the alert.
    if (memberError) {
      console.error('Error counting excluded-guild members:', memberError)
      return {
        count: rows.length,
        guilds: [],
        memberCount: null,
        checked: false
      }
    }

    const memberCount = members?.length ?? 0
    const names = rows.map((g) => g.display_name || g.guild_code)

    if (emitAlerts) {
      addSyncAlert(
        'Guilds Excluded From Sync',
        `${names.length} enabled guilds are excluded from every automated sync lane and have no successful sync in 24h (${memberCount} affected members)`,
        memberCount > 0 ? 'error' : 'warning',
        {
          affectedGuilds: names,
          count: names.length,
          memberCount,
          reasons: rows.map((g) => ({
            guild: g.display_name || g.guild_code,
            apiKeyInvalid: g.api_key_is_valid === false,
            autoSyncDisabled: g.auto_sync_enabled === false,
            consecutiveFailures: g.consecutive_sync_failures ?? 0,
            lastSuccessfulSync: g.last_successful_sync
          }))
        }
      )
    }

    return {
      count: names.length,
      guilds: names,
      memberCount,
      checked: true
    }
  } catch (error) {
    console.error('Excluded guilds check failed:', error)
    return { count: 0, guilds: [], memberCount: 0, checked: false }
  }
}

export async function runDataIntegrityHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<DataIntegrityResults> {
  const emitAlerts = options.emitAlerts ?? true
  const [
    orphanedPlayers,
    syncGaps,
    seasonDataIntegrity,
    staleGuilds,
    excludedGuilds
  ] = await Promise.all([
    checkOrphanedPlayers(emitAlerts),
    checkSyncGaps(emitAlerts),
    checkSeasonDataIntegrity(emitAlerts),
    checkStaleGuilds(emitAlerts),
    checkExcludedGuilds(emitAlerts)
  ])

  await checkEncryptionHealth(emitAlerts)

  return {
    orphanedPlayers,
    syncGaps,
    seasonDataIntegrity,
    staleGuilds,
    excludedGuilds
  }
}

export const __internal = {
  checkExcludedGuilds
}
