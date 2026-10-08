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

function createRequestCorrelation(origin, phase) {
  const groups = new Map(),
    browser = new Map(),
    web = new Map(),
    failures = []
  let truncated = false
  // Match only a single occurrence from each API across the entire launch.
  // No clock tolerance, event-order assumption or shared request ID is used.
  function start(side, id, rawUrl, method, document) {
    const records = side === 'browser' ? browser : web
    if (records.has(id)) {
      records.get(id).redirected = true
      return
    }
    if (records.size >= 4096) {
      truncated = true
      return
    }
    let url, documentUrl
    try {
      if (
        typeof rawUrl !== 'string' ||
        rawUrl.length > 8192 ||
        typeof document !== 'string' ||
        document.length > 8192 ||
        typeof method !== 'string' ||
        !/^[A-Z]{1,16}$/.test(method)
      )
        return
      url = new URL(rawUrl)
      documentUrl = new URL(document)
    } catch {
      return
    }
    if (url.origin !== origin || documentUrl.origin !== origin) return
    // Full URLs (including query), document URLs and IDs stay private.
    const key = JSON.stringify([url.href, method, documentUrl.href])
    if (!groups.has(key)) {
      if (groups.size >= 4096) {
        truncated = true
        return
      }
      groups.set(key, { browser: [], web: [] })
    }
    const group = groups.get(key)
    const record = {
      group,
      redirected: false
    }
    group[side].push(record)
    records.set(id, record)
    return record
  }
  function project(record) {
    if (!record.group) return { correlation: 'unmatched' }
    if (record.group.browser.length !== 1 || record.group.web.length !== 1)
      return {
        correlation: record.group.browser.length ? 'ambiguous' : 'unmatched'
      }
    const candidate = record.group.browser[0]
    if (record.redirected || candidate.redirected)
      return { correlation: 'redirected' }
    if (!candidate.terminal) return { correlation: 'pending' }
    return {
      correlation: 'unique-exact-key',
      browserOutcome: candidate.terminal,
      ...(candidate.failure
        ? {
            browserNetworkError: candidate.failure.networkError,
            ...(typeof candidate.failure.canceled === 'boolean'
              ? { browserCanceled: candidate.failure.canceled }
              : {}),
            ...(candidate.failure.blockedReason
              ? { browserBlockedReason: candidate.failure.blockedReason }
              : {}),
            ...(candidate.failure.corsCategory
              ? { browserCorsCategory: candidate.failure.corsCategory }
              : {})
          }
        : {})
    }
  }
  return {
    browserStart(params) {
      if (params.redirectResponse) {
        const record = browser.get(params.requestId)
        if (record) record.redirected = true
        return
      }
      start(
        'browser',
        params.requestId,
        params.request?.url,
        params.request?.method,
        params.documentURL
      )
    },
    browserFinished(id, failure) {
      const record = browser.get(id)
      if (!record) return
      record.terminal = failure ? 'failed' : 'completed'
      record.failure = failure
    },
    webRequest(event, details) {
      if (!Number.isSafeInteger(details?.id)) return
      if (typeof details.url !== 'string') return
      if (details.url.length > 8192) {
        truncated = true
        return
      }
      let url
      try {
        url = new URL(details.url)
      } catch {
        return
      }
      if (url.origin !== origin) return
      if (event === 'start') {
        let record = start(
          'web',
          details.id,
          details.url,
          details.method,
          details.referrer
        )
        if (!record && !web.has(details.id) && web.size < 4096) {
          record = {}
          web.set(details.id, record)
        }
        if (record)
          record.label = {
            ...diagnostics.requestLabel(
              url.pathname,
              details.resourceType,
              phase()
            ),
            ...diagnostics.requestMetadata(details.method),
            document: diagnostics.requestDocumentLabel(details.referrer)
          }
      } else {
        const record = web.get(details.id)
        if (!record) return
        if (event === 'headers')
          record.label = {
            ...record.label,
            ...diagnostics.requestMetadata(
              details.method,
              details.requestHeaders
            )
          }
        else if (event === 'error' && details.error !== 'net::ERR_ABORTED') {
          if (failures.length >= 64) truncated = true
          else
            failures.push({
              record,
              webRequestError: diagnostics.networkErrorLabel(details.error)
            })
        }
      }
    },
    snapshot(unavailable) {
      return {
        truncated,
        failed: failures.map(({ record, webRequestError }) => ({
          ...record.label,
          webRequestError,
          ...(truncated || unavailable
            ? { correlation: 'unavailable' }
            : project(record))
        }))
      }
    }
  }
}

// CDP IDs remain private Map keys. Only fixed labels/booleans leave this module.
function createRequestLifecycle(origin, phase) {
  const requests = new Map(),
    failed = []
  const correlation = createRequestCorrelation(origin, phase)
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
    recordWebRequest(event, details) {
      correlation.webRequest(event, details)
    },
    record(method, params) {
      if (
        typeof params?.requestId !== 'string' ||
        params.requestId.length > 256
      )
        return
      if (method === 'Network.requestWillBeSent') {
        correlation.browserStart(params)
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
      } else if (method === 'Network.loadingFinished') {
        correlation.browserFinished(params.requestId)
        requests.delete(params.requestId)
      } else if (method === 'Network.loadingFailed') {
        const label = requests.get(params.requestId)
        requests.delete(params.requestId)
        if (!label) return
        if (failed.length >= 64) {
          truncated = true
          return
        }
        const cors = params.corsErrorStatus?.corsError
        const failure = {
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
        }
        correlation.browserFinished(params.requestId, failure)
        failed.push(failure)
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
        failed: failed.map((value) => ({ ...value })),
        webRequestCorrelation: correlation.snapshot(!available || truncated)
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
