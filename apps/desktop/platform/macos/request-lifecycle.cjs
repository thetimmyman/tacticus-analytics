const diagnostics = require('./request-diagnostics.cjs')

const resources = {
  Document: 'mainFrame',
  Stylesheet: 'stylesheet',
  Image: 'image',
  Media: 'media',
  Font: 'font',
  Script: 'script',
  XHR: 'xhr',
  Fetch: 'xhr',
  WebSocket: 'webSocket',
  Ping: 'ping'
}
const blockedReasons = {
  csp: 'content-security-policy',
  'mixed-content': 'mixed-content',
  origin: 'origin-policy',
  inspector: 'inspector',
  'subresource-filter': 'subresource-filter',
  'content-type': 'content-type'
}
const corsReasons = {
  InvalidResponse: 'invalid-response',
  WildcardOriginNotAllowed: 'origin-policy',
  MissingAllowOriginHeader: 'origin-policy',
  MultipleAllowOriginValues: 'origin-policy',
  InvalidAllowOriginValue: 'origin-policy',
  AllowOriginMismatch: 'origin-policy',
  InvalidAllowCredentials: 'credential-policy',
  MethodDisallowedByPreflightResponse: 'preflight-method',
  HeaderDisallowedByPreflightResponse: 'preflight-header',
  RedirectContainsCredentials: 'redirect-policy'
}

// CDP IDs remain private Map keys. Only fixed labels/booleans leave this module.
function createRequestLifecycle(origin, phase) {
  const requests = new Map(),
    failed = []
  let available = false,
    reason = 'not-attached',
    truncated = false
  return {
    available() {
      available = true
      reason = undefined
    },
    unavailable(value) {
      available = false
      reason = [
        'attach-unavailable',
        'network-observation-unavailable',
        'detached'
      ].includes(value)
        ? value
        : 'not-attached'
    },
    record(method, params) {
      if (
        typeof params?.requestId !== 'string' ||
        params.requestId.length > 256
      )
        return
      if (method === 'Network.requestWillBeSent') {
        let url
        try {
          url = new URL(params.request?.url)
        } catch {
          return
        }
        const previous = requests.get(params.requestId)
        if (params.redirectResponse && previous) {
          requests.set(params.requestId, {
            ...previous,
            redirected: true,
            crossOriginRedirect:
              previous.crossOriginRedirect === true || url.origin !== origin
          })
          return
        }
        if (url.origin !== origin) return
        if (requests.size >= 4096 && !requests.has(params.requestId)) {
          truncated = true
          return
        }
        requests.set(params.requestId, {
          ...diagnostics.requestLabel(
            url.pathname,
            Object.hasOwn(resources, params.type)
              ? resources[params.type]
              : 'other',
            phase()
          ),
          ...diagnostics.requestMetadata(
            params.request?.method,
            params.request?.headers
          ),
          document: diagnostics.requestDocumentLabel(params.documentURL)
        })
      } else if (method === 'Network.loadingFinished')
        requests.delete(params.requestId)
      else if (method === 'Network.loadingFailed') {
        const label = requests.get(params.requestId)
        requests.delete(params.requestId)
        if (!label) return
        if (failed.length >= 64) {
          truncated = true
          return
        }
        const cors = params.corsErrorStatus?.corsError
        failed.push({
          ...label,
          networkError:
            params.errorText === 'net::ERR_ABORTED'
              ? 'request-canceled'
              : diagnostics.networkErrorLabel(params.errorText),
          ...(typeof params.canceled === 'boolean'
            ? { canceled: params.canceled }
            : {}),
          ...(typeof params.blockedReason === 'string'
            ? {
                blockedReason: Object.hasOwn(
                  blockedReasons,
                  params.blockedReason
                )
                  ? blockedReasons[params.blockedReason]
                  : 'other'
              }
            : {}),
          ...(typeof cors === 'string'
            ? {
                corsCategory: Object.hasOwn(corsReasons, cors)
                  ? corsReasons[cors]
                  : cors.startsWith('Preflight')
                    ? 'preflight-policy'
                    : 'other'
              }
            : {})
        })
      }
    },
    snapshot() {
      return {
        schemaVersion: 'macos-request-lifecycle/v1',
        classification: 'diagnostic',
        accepted: false,
        productAcceptance: false,
        instrumentationMayAffectTiming: true,
        available,
        ...(reason ? { reason } : {}),
        truncated,
        trackedRequestCount: requests.size,
        failed: failed.map((value) => ({ ...value }))
      }
    }
  }
}

async function observeRequestLifecycle(contents, origin, phase) {
  const observer = createRequestLifecycle(origin, phase)
  const debug = contents.debugger
  try {
    debug.attach('1.3')
  } catch {
    observer.unavailable('attach-unavailable')
    return observer
  }
  debug.on('message', (_event, method, params) =>
    observer.record(method, params)
  )
  debug.on('detach', () => observer.unavailable('detached'))
  let deadline
  try {
    await Promise.race([
      debug.sendCommand('Network.enable'),
      new Promise((_accept, reject) => {
        deadline = setTimeout(
          () => reject(new Error('Diagnostic deadline')),
          5000
        )
      })
    ])
    if (!debug.isAttached()) throw new Error('Diagnostic target unavailable')
    observer.available()
  } catch {
    try {
      debug.detach()
    } catch {}
    observer.unavailable('network-observation-unavailable')
  } finally {
    clearTimeout(deadline)
  }
  return observer
}

module.exports = { createRequestLifecycle, observeRequestLifecycle }
