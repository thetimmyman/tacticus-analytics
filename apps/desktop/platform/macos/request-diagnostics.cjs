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
  '/api/guild-tokens': 'guild-tokens',
  '/api/user/activity': 'activity',
  '/api/version': 'version',
  '/favicon.ico': 'favicon'
}
const endpointNames = [
  ...Object.values(endpoints),
  'static-asset',
  'other-local'
]

// Diagnostic labels never include a URL, query, body, ID, error or cookie.
function requestLabel(path, resource) {
  return {
    endpoint:
      endpoints[path] ??
      (path.startsWith('/_next/static/') ? 'static-asset' : 'other-local'),
    resource: resources.includes(resource) ? resource : 'other'
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
  return value
}

module.exports = { requestLabel, sanitizeFailure }
