export {
  checkNginxRouting,
  checkCloudflaredTunnel,
  checkPostgrestSchemaHealth,
  runInfrastructureHealthChecks
} from './infrastructure-health'

export {
  runExternalApiHealthChecks,
  getExternalApiHealthSummary
} from './external-api-health'

export { runDataIntegrityHealthChecks } from './data-integrity-health'

export { runSystemHealthChecks } from './system-health'

export { runSyncHealthChecks } from './sync-health'

export { runDockerHealthChecks } from './docker-health'

export { getMemoryMonitor } from './memory-monitor'

export {
  attemptMemoryRecovery,
  sendCriticalMemoryAlert
} from './memory-recovery'

export async function runAllHealthChecks(
  options: { emitAlerts?: boolean } = {}
) {
  const emitAlerts = options.emitAlerts ?? true
  const { runInfrastructureHealthChecks } =
    await import('./infrastructure-health')
  const { runExternalApiHealthChecks, getExternalApiHealthSummary } =
    await import('./external-api-health')
  const { runDataIntegrityHealthChecks } =
    await import('./data-integrity-health')
  const { runSystemHealthChecks } = await import('./system-health')
  const { runSyncHealthChecks } = await import('./sync-health')
  const { runDockerHealthChecks } = await import('./docker-health')
  const { runRealtimeHealthChecks } = await import('./realtime-health')
  const { runBackupHealthChecks } = await import('./backup-health')
  const { runAdminHealthChecks } = await import('./admin-alerts')
  const { runCoverageHealthChecks } = await import('./coverage-health')

  const [
    infrastructure,
    externalApis,
    dataIntegrity,
    system,
    sync,
    docker,
    realtime,
    backup,
    admin,
    coverage
  ] = await Promise.all([
    runInfrastructureHealthChecks({ emitAlerts }),
    runExternalApiHealthChecks({ emitAlerts }),
    runDataIntegrityHealthChecks({ emitAlerts }),
    runSystemHealthChecks({ emitAlerts }),
    runSyncHealthChecks({ emitAlerts }),
    runDockerHealthChecks({ emitAlerts }),
    runRealtimeHealthChecks({ emitAlerts }),
    runBackupHealthChecks({ emitAlerts }),
    runAdminHealthChecks({ emitAlerts }),
    runCoverageHealthChecks()
  ])

  const externalApiSummary = getExternalApiHealthSummary(externalApis)
  const dependencyChecks = [
    infrastructure.dependencies.nginx,
    infrastructure.dependencies.cloudflared,
    infrastructure.dependencies.postgrest
  ]
  const dependenciesHealthy = dependencyChecks.every(
    (check) => !check.checked || check.healthy
  )

  return {
    infrastructure,
    externalApis,
    dataIntegrity,
    system,
    sync,
    docker,
    realtime,
    backup,
    admin,
    coverage,
    summary: {
      infrastructureHealthy:
        infrastructure.memory &&
        infrastructure.database.connected &&
        infrastructure.environment &&
        dependenciesHealthy,
      externalApisHealthy: externalApiSummary.allHealthy,
      unhealthyExternalApis: externalApiSummary.unhealthyApis,
      totalExternalApiResponseTimeMs: externalApiSummary.totalResponseTimeMs,
      databaseResponseTimeMs: infrastructure.database.responseTimeMs,
      // Monitoring endpoints pass emitAlerts:false, so this verdict is their only view of excluded guilds.
      dataIntegrityIssues:
        !dataIntegrity.seasonDataIntegrity.healthy ||
        dataIntegrity.syncGaps.count > 0 ||
        dataIntegrity.excludedGuilds.count > 0,
      syncFailureRate:
        sync.totalActiveGuilds > 0
          ? Math.round((sync.failingGuilds / sync.totalActiveGuilds) * 100)
          : 0,
      diskSpaceAvailable: system.diskSpace.available,
      sslCertificateValid: system.sslCertificate.valid,
      sslDaysUntilExpiry: system.sslCertificate.daysUntilExpiry,
      dockerAvailable: docker.available,
      dockerUnhealthyContainers: docker.unhealthyCount,
      dependenciesHealthy,
      nginxRoutingHealthy: infrastructure.dependencies.nginx.healthy,
      cloudflaredHealthy: infrastructure.dependencies.cloudflared.healthy,
      postgrestSchemaHealthy: infrastructure.dependencies.postgrest.healthy,
      realtimeReachable: realtime.reachable,
      backupHealthy: backup.backupHealthy,
      backupLastAge: backup.lastBackupAge,
      newGuildsToday: admin.onboarding.newGuildsToday,
      securityAlerts: admin.security.suspiciousActivity,
      testCoveragePct: coverage.current?.statements ?? 0,
      testsPassing: coverage.current
        ? coverage.current.passingTests === coverage.current.totalTests
        : true
    }
  }
}
