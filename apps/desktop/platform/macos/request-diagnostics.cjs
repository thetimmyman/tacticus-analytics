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
const documents = {
  '/home': 'home-document',
  '/player-performance': 'scores-document',
  '/desktop/personal': 'personal-document',
  '/desktop/setup': 'setup-document'
}
const documentNames = [...Object.values(documents), 'other-document']
const methods = [
  'GET',
  'POST',
  'HEAD',
  'OPTIONS',
  'PUT',
  'PATCH',
  'DELETE',
  'other'
]
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
  '/home': 'home-page',
  // Fixed local Next Link targets from workspace/account navigation and footer.
  '/dashboard': 'raid-dashboard-page',
  '/guild-trends': 'guild-trends-page',
  '/boss-assignments': 'boss-assignments-page',
  '/wars': 'wars-page',
  '/creators': 'creators-page',
  '/roster': 'roster-page',
  '/achievements': 'achievements-page',
  '/explore': 'explore-page',
  '/guild-settings': 'guild-settings-page',
  '/admin/feature-releases': 'admin-releases-page',
  '/faq': 'faq-page',
  '/acknowledgements': 'acknowledgements-page',
  '/privacy': 'privacy-page',
  '/terms': 'terms-page',
  '/do-not-sell': 'do-not-sell-page',
  '/boss-playbooks': 'boss-playbooks-page',
  '/player-stats': 'player-stats-page',
  '/desktop/open': 'device-bootstrap',
  '/desktop/personal': 'personal-page',
  '/desktop/onboarding-status': 'onboarding-status',
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
  '/supabase/rest/v1/rpc/get_distinct_seasons_for_guild': 'distinct-seasons',
  '/api/performance/five-season-averages': 'performance-averages',
  '/api/upcoming/token-performance': 'target-performance',
  '/api/health': 'health',
  '/api/user/activity': 'activity',
  '/api/user/token-alerts': 'token-alerts',
  '/api/briefing/seen': 'briefing-seen',
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
  '/supabase/rest/v1/rpc/get_player_boss_performance': 'boss-performance',
  '/supabase/rest/v1/rpc/get_player_prime_performance': 'prime-performance',
  '/supabase/rest/v1/rpc/get_player_performance_summary': 'performance-summary',
  '/supabase/rest/v1/rpc/get_guild_vs_cluster_boss_performance':
    'cluster-boss-performance',
  '/favicon.ico': 'favicon'
}
// Finite home-table targets from boss-playbooks/playbook-id.ts; the ID is never
// emitted and arbitrary detail paths remain unknown.
const playbookPaths = new Set(
  [
    'magnus',
    'mortarion',
    'silent-king',
    'ghazghkull',
    'avatar-of-khaine',
    'belisarius',
    'riptide',
    'rogal-dorn',
    'screamer-killer',
    'lion',
    'hive-tyrant-kronos',
    'hive-tyrant-gorgon',
    'hive-tyrant-leviathan',
    'tervigon-kronos',
    'tervigon-gorgon',
    'tervigon-leviathan'
  ].map((id) => `/boss-playbooks/${id}`)
)
const endpointNames = [
  ...Object.values(endpoints),
  'boss-playbook-detail-page',
  'static-asset',
  'other-local'
]

// Diagnostic labels never include a URL, query, body, ID, error or cookie.
function requestLabel(path, resource, phase) {
  return {
    endpoint:
      endpoints[path] ??
      (playbookPaths.has(path)
        ? 'boss-playbook-detail-page'
        : path.startsWith('/_next/static/')
          ? 'static-asset'
          : 'other-local'),
    resource: resources.includes(resource) ? resource : 'other',
    ...(phases.includes(phase) ? { phase } : {})
  }
}

function networkErrorLabel(error) {
  return Object.hasOwn(networkErrors, error) ? networkErrors[error] : 'other'
}

function requestMetadata(method, headers) {
  const value = { method: methods.includes(method) ? method : 'other' }
  if (!headers || typeof headers !== 'object' || Array.isArray(headers))
    return value
  const names = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  )
  value.rsc = names.rsc === '1'
  value.prefetch =
    names['next-router-prefetch'] === '1' ||
    ['purpose', 'sec-purpose'].some(
      (name) =>
        typeof names[name] === 'string' &&
        names[name].toLowerCase().includes('prefetch')
    )
  return value
}

function requestDocumentLabel(referrer) {
  try {
    const path = new URL(referrer).pathname
    return Object.hasOwn(documents, path) ? documents[path] : 'other-document'
  } catch {
    return 'other-document'
  }
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
      ...(documentNames.includes(entry?.document)
        ? { document: entry.document }
        : {}),
      ...(methods.includes(entry?.method) ? { method: entry.method } : {}),
      ...(typeof entry?.rsc === 'boolean' ? { rsc: entry.rsc } : {}),
      ...(typeof entry?.prefetch === 'boolean'
        ? { prefetch: entry.prefetch }
        : {}),
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
              : {}),
            ...(typeof entry?.frameAvailable === 'boolean'
              ? { frameAvailable: entry.frameAvailable }
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

// Fail closed on an incomplete final observation; pending work is never a pass.
function networkFailureCause(network) {
  if (
    !Array.isArray(network?.pending) ||
    !Array.isArray(network?.failed) ||
    !Number.isSafeInteger(network?.blocked) ||
    network.blocked < 0
  )
    return 'request-failed'
  if (network.pending.length) return 'requests-pending'
  if (network.blocked || network.failed.some(unexpectedFailure))
    return 'request-failed'
}

module.exports = {
  requestLabel,
  networkErrorLabel,
  requestMetadata,
  requestDocumentLabel,
  sanitizeFailure,
  rendererReceipt,
  holdingHeader,
  holdingRefusal,
  unexpectedFailure,
  networkFailureCause
}
