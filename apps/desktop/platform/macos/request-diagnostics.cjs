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
  '/api/performance/five-season-averages': 'performance-averages',
  '/api/upcoming/token-performance': 'target-performance',
  '/api/health': 'health',
  '/api/user/activity': 'activity',
  '/api/version': 'version',
  '/favicon.ico': 'favicon'
}
const endpointNames = [
  ...Object.values(endpoints),
  'static-asset',
  'other-local'
]
const diagnosticEndpointNames = [...endpointNames, 'season-list']
const requestClasses = [
  'supabase-rpc',
  'supabase-auth',
  'supabase-table',
  'local-api',
  'next-static',
  'next-internal',
  'local-page',
  'other-local'
]
const chromiumErrorCodes = [
  'ERR_ABORTED',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_FAILED',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ERR_NETWORK_CHANGED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
  'ERR_NAME_NOT_RESOLVED'
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

function requestClass(path) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[?#\x00-\x20]/.test(path)
  )
    return 'other-local'
  for (const [prefix, value] of [
    ['/supabase/rest/v1/rpc/', 'supabase-rpc'],
    ['/supabase/auth/v1/', 'supabase-auth'],
    ['/supabase/rest/v1/', 'supabase-table'],
    ['/api/', 'local-api'],
    ['/_next/static/', 'next-static'],
    ['/_next/', 'next-internal']
  ])
    if (path.startsWith(prefix)) return value
  return [
    '/desktop/open',
    '/desktop/personal',
    '/player-performance',
    '/profile',
    '/api-keys',
    '/onboarding',
    '/favicon.ico'
  ].includes(path)
    ? 'local-page'
    : 'other-local'
}

// Keep the original label for success receipts and policy checks. Additional
// fixed labels are used only by the failure diagnostic projection.
function networkRequestLabel(path, resource, phase) {
  const original = requestLabel(path, resource, phase)
  return {
    ...original,
    diagnosticEndpoint:
      path === '/supabase/rest/v1/rpc/get_distinct_seasons_for_guild'
        ? 'season-list'
        : original.endpoint,
    requestClass: requestClass(path)
  }
}

function chromiumErrorCategory(error) {
  return chromiumErrorCodes.find((code) => error === 'net::' + code) ?? 'other'
}

function sanitizeNetworkDiagnostics(input) {
  if (input?.schemaVersion !== 1) return undefined
  const value = { schemaVersion: 1, truncated: input.truncated === true }
  for (const kind of ['pending', 'failed']) {
    const entries = Array.isArray(input[kind]) ? input[kind] : []
    if (entries.length > 128) value.truncated = true
    const clean = entries.slice(0, 128).map((entry) => {
      const endpoint = entry?.diagnosticEndpoint ?? entry?.endpoint
      const validStatus =
        Number.isInteger(entry?.status) &&
        entry.status >= 0 &&
        entry.status <= 599
      return {
        endpoint: diagnosticEndpointNames.includes(endpoint)
          ? endpoint
          : 'other-local',
        requestClass: requestClasses.includes(entry?.requestClass)
          ? entry.requestClass
          : 'other-local',
        resource: resources.includes(entry?.resource)
          ? entry.resource
          : 'other',
        ...(phases.includes(entry?.phase) ? { phase: entry.phase } : {}),
        ...(kind === 'failed'
          ? {
              status: validStatus ? entry.status : 0,
              errorCategory:
                validStatus && entry.status !== 0
                  ? 'not-applicable'
                  : validStatus &&
                      chromiumErrorCodes.includes(entry?.errorCategory)
                    ? entry.errorCategory
                    : 'other'
            }
          : {})
      }
    })
    const unique = [
      ...new Map(clean.map((entry) => [JSON.stringify(entry), entry])).values()
    ]
    if (unique.length > 20) value.truncated = true
    value[kind] = unique.slice(0, 20)
  }
  return value
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
                : 0
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
  const diagnostics = sanitizeNetworkDiagnostics(input.networkDiagnostics)
  if (diagnostics) {
    value.networkDiagnostics = diagnostics
    // The owner relay retains 4096 bytes including this exact prefix/newline.
    // All projected values are ASCII. Trim only the additional diagnostic,
    // preserving original network evidence and its acceptance policy.
    while (
      ('TA-MAC-VERIFY-FAILURE:' + JSON.stringify(value) + '\n').length > 4096 &&
      (diagnostics.pending.length || diagnostics.failed.length)
    ) {
      diagnostics.truncated = true
      if (diagnostics.pending.length) diagnostics.pending.pop()
      else diagnostics.failed.pop()
    }
  }
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
// failure from a request started while the renderer was deliberately signed out.
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
  networkRequestLabel,
  chromiumErrorCategory,
  sanitizeFailure,
  rendererReceipt,
  holdingHeader,
  holdingRefusal,
  unexpectedFailure
}
