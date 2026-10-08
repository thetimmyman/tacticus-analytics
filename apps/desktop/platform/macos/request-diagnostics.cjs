const stages = [
  'window-startup',
  'workspace-page',
  'workspace-setup',
  'workspace-navigation',
  'native-session',
  'renderer-observation',
  'renderer-scores',
  'renderer-network'
]
const codes = ['ESESSION', 'EVAULT', 'EVAULTLOCKED', 'EACCESS', 'EVERIFY']
const causes = ['requests-pending', 'request-failed']
const networkErrors = {
  'net::ERR_FAILED': 'request-failed',
  'net::ERR_CONNECTION_RESET': 'connection-reset',
  'net::ERR_CONNECTION_CLOSED': 'connection-closed',
  'net::ERR_CONNECTION_REFUSED': 'connection-refused',
  'net::ERR_EMPTY_RESPONSE': 'empty-response',
  'net::ERR_TIMED_OUT': 'timed-out',
  'net::ERR_NETWORK_CHANGED': 'network-changed',
  'net::ERR_INCOMPLETE_CHUNKED_ENCODING': 'incomplete-body',
  'net::ERR_CONTENT_LENGTH_MISMATCH': 'body-length-mismatch',
  'net::ERR_CONTENT_DECODING_FAILED': 'body-decoding-failed',
  'net::ERR_NAME_NOT_RESOLVED': 'name-not-resolved',
  'net::ERR_BLOCKED_BY_CLIENT': 'client-blocked'
}
const networkErrorNames = Object.values(networkErrors)
const phases = [
  'initial-open',
  'renderer-refusal',
  'signed-out-check',
  'recovered-open',
  'scores-view'
]
const resources = [
  'mainFrame',
  'subFrame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xhr',
  'ping',
  'cspReport',
  'media',
  'webSocket',
  'other'
]
const endpoints = {
  '/desktop/open': 'device-bootstrap',
  '/desktop/personal': 'personal-page',
  '/player-performance': 'scores-page',
  '/profile': 'profile-page',
  '/api-keys': 'official-access-page',
  '/onboarding': 'legacy-onboarding-page',
  '/api/guild-tokens': 'guild-tokens',
  '/api/desktop/personal': 'personal-cache',
  '/api/player-api-key': 'player-access-status',
  '/api/player-api-key/sync': 'player-access-sync',
  '/supabase/auth/v1/user': 'auth-user',
  '/supabase/auth/v1/token': 'auth-token',
  '/supabase/rest/v1/player_mapping': 'player-mapping',
  '/supabase/rest/v1/guild_config': 'guild-config',
  '/supabase/rest/v1/player_with_cluster': 'cluster-profile',
  '/supabase/rest/v1/rpc/get_token_usage_for_guild': 'token-usage-read',
  '/supabase/rest/v1/rpc/get_season_token_stats': 'token-stats-read',
  '/supabase/rest/v1/rpc/get_guild_player_scores_batch': 'scores-batch-read',
  '/supabase/rest/v1/rpc/get_season_token_stats_batch':
    'token-stats-batch-read',
  '/api/performance/five-season-averages': 'performance-averages',
  '/api/upcoming/token-performance': 'target-performance',
  '/api/health': 'health',
  '/api/user/activity': 'activity',
  '/api/version': 'version',
  '/api/health/telemetry': 'health-telemetry',
  '/api/season/timing': 'season-timing',
  '/api/assignments/current-season-bosses': 'current-season-bosses',
  '/api/assignments/next-season-bosses': 'next-season-bosses',
  '/api/sync/freshness': 'sync-freshness',
  '/api/features/stages': 'feature-stages',
  '/api/guild-trends/target-scores-batch': 'target-scores',
  '/api/boss-assignments/target-tokens/schedule': 'target-schedule',
  '/api/boss-assignments/target-tokens/rotation-stats': 'target-rotation',
  '/supabase/rest/v1/EOT_GR_data': 'raid-data',
  '/supabase/rest/v1/guild_members': 'guild-members',
  '/supabase/rest/v1/guild_raid_season': 'raid-season',
  '/favicon.ico': 'favicon'
}
const endpointNames = [
  ...Object.values(endpoints),
  'static-asset',
  'other-local'
]

// Diagnostic labels never include a URL, query, body, ID, error or cookie.
function requestLabel(path, resource, phase) {
  return {
    endpoint:
      endpoints[path] ??
      (path.startsWith('/_next/static/') ? 'static-asset' : 'other-local'),
    resource: resources.includes(resource) ? resource : 'other',
    ...(phases.includes(phase) ? { phase } : {})
  }
}

function networkErrorLabel(error) {
  return Object.hasOwn(networkErrors, error) ? networkErrors[error] : 'other'
}

function sanitizeFailure(input) {
  const value = {
    synthetic: true,
    stage: stages.includes(input?.stage) ? input.stage : 'window-startup',
    code: codes.includes(input?.code) ? input.code : 'EVERIFY'
  }
  if (value.stage !== 'renderer-network' || !causes.includes(input?.cause))
    return value
  value.cause = input.cause
  value.network = {}
  for (const name of ['pending', 'failed']) {
    const entries = Array.isArray(input.network?.[name])
      ? input.network[name]
      : []
    const clean = entries.slice(0, 128).map((entry) => ({
      endpoint: endpointNames.includes(entry?.endpoint)
        ? entry.endpoint
        : 'other-local',
      resource: resources.includes(entry?.resource) ? entry.resource : 'other',
      ...(phases.includes(entry?.phase) ? { phase: entry.phase } : {}),
      ...(name === 'failed'
        ? {
            status:
              Number.isInteger(entry?.status) &&
              entry.status >= 0 &&
              entry.status <= 599
                ? entry.status
                : 0,
            ...(networkErrorNames.includes(entry?.networkError) ||
            entry?.networkError === 'other'
              ? { networkError: entry.networkError }
              : {})
          }
        : {})
    }))
    value.network[name] = [
      ...new Map(clean.map((entry) => [JSON.stringify(entry), entry])).values()
    ].slice(0, 20)
  }
  value.network.blocked = Number.isSafeInteger(input.network?.blocked)
    ? Math.max(0, Math.min(1000000, input.network.blocked))
    : 0
  return value
}

function rendererReceipt({ observed, pending, failed, blocked }) {
  return {
    observed: {
      nodeAccess: observed?.nodeAccess !== false,
      positiveScore:
        typeof observed?.text === 'string' && observed.text.includes('+58%'),
      negativeScore:
        typeof observed?.text === 'string' && observed.text.includes('-50%'),
      serviceDisruption:
        typeof observed?.text !== 'string' ||
        observed.text.includes('Service Disruption')
    },
    network: sanitizeFailure({
      stage: 'renderer-network',
      cause: 'request-failed',
      network: { pending, failed, blocked }
    }).network
  }
}

// The gateway tags its deliberate holding refusal of legacy credential routes,
// which renderer navigation and prefetch can reach without any defect.
const holdingHeader = 'x-desktop-holding'
function holdingRefusal(status, headers) {
  if (status !== 403) return false
  return Object.entries(headers ?? {}).some(
    ([name, values]) =>
      name.toLowerCase() === holdingHeader &&
      [].concat(values).includes('credential-surface')
  )
}

// A failed request is expected only when the journey provoked it: the refused
// renderer bootstrap, a refused live guild token read, or an authorization
// failure while the renderer was deliberately signed out and recovering.
function unexpectedFailure(failure) {
  if (
    failure?.status === 403 &&
    ['/api/guild-tokens', '/desktop/open'].includes(failure.path)
  )
    return false
  if (failure?.status === 401 && failure.phase === 'signed-out-check')
    return false
  return true
}

module.exports = {
  requestLabel,
  networkErrorLabel,
  sanitizeFailure,
  rendererReceipt,
  holdingHeader,
  holdingRefusal,
  unexpectedFailure
}
