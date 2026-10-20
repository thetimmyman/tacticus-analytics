export type ProviderDomain = 'official' | 'loki' | 'cdn' | 'websocket'

export interface ProviderDispatch {
  domain: ProviderDomain
  account: string
  endpoint: string
  purpose: string
  priority: 'essential' | 'background'
  timeoutMs: number
}

export interface ProviderOperation {
  purpose: string
  trigger: 'scheduled' | 'user' | 'admin'
  timeoutMs: number
}

export interface ProviderPhysicalContext {
  operation?: ProviderOperation
  dispatch?: ProviderDispatch
}

export type ProviderPhysicalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
  context?: ProviderPhysicalContext
) => Promise<Response>

export function createProviderDispatchResolver(options: {
  key: string
  officialOrigin?: string
}) {
  const label = createProviderAccountLabeler(options.key)
  return async (
    input: RequestInfo | URL,
    init: RequestInit,
    operation: ProviderOperation
  ): Promise<ProviderDispatch> => {
    if (
      !purposes.has(operation.purpose) ||
      !['scheduled', 'user', 'admin'].includes(operation.trigger) ||
      !Number.isInteger(operation.timeoutMs) ||
      operation.timeoutMs < 100 ||
      operation.timeoutMs > 60000
    )
      throw new ProviderAdmissionError()
    const target = providerRequestTarget(input, init, options.officialOrigin)
    let identity: string | undefined
    try {
      if (target.domain === 'official') {
        // Fetch replaces Request headers when init.headers is supplied.
        identity =
          new Headers(
            init.headers ??
              (input instanceof Request ? input.headers : undefined)
          ).get('x-api-key') ?? undefined
      } else if (target.domain === 'loki') {
        const path = new URL(
          input instanceof Request ? input.url : String(input)
        ).pathname
        identity = decodeURIComponent(
          path.match(/\/userId\/([^/]+)/)?.[1] ?? ''
        )
      }
    } catch {
      throw new ProviderAdmissionError()
    }
    const priority =
      ['guild-sync', 'guild-war-sync'].includes(operation.purpose) ||
      (operation.trigger !== 'scheduled' &&
        [
          'roster-fetch',
          'credential-check',
          'token-refresh',
          'session-connect'
        ].includes(operation.purpose))
        ? 'essential'
        : 'background'
    return {
      ...target,
      account: await label(target.domain, identity),
      purpose: operation.purpose,
      priority,
      timeoutMs: operation.timeoutMs
    }
  }
}

export interface ProviderAdmissionOptions {
  authorityOrigin: string
  token: string
  officialOrigin?: string
  controlFetch?: typeof fetch
  physicalFetch?: ProviderPhysicalFetch
  rpcTimeoutMs?: number
  pollMs?: number
}

const routes: Record<
  Exclude<ProviderDomain, 'websocket'>,
  readonly string[]
> = {
  official: [
    '/api/v1/player',
    '/api/v1/guild',
    '/api/v1/guildRaid',
    '/api/v1/guildRaid/<id>'
  ],
  loki: [
    '/player/player2/userId/<account>',
    '/player/player2/userId/<account>/sessionId/<session>',
    '/game-event/game3/userId/<account>/sessionId/<session>'
  ],
  cdn: ['/config/global/GlobalConfig.<hash>.json']
}
const purposes = new Set([
  'guild-sync',
  'guild-war-sync',
  'roster-fetch',
  'game-config-refresh',
  'credential-check',
  'session-connect',
  'token-refresh',
  'guildchat-replay',
  'health-check'
])

export function providerObservationPurpose(value: unknown): string {
  return typeof value === 'string' && purposes.has(value) ? value : 'unknown'
}
const reasons = new Set([
  'policy-unconfigured',
  'disabled',
  'duplicate-attempt',
  'provider-hold',
  'concurrency',
  'rate',
  'not-owned',
  'already-dispatched',
  'policy-changed',
  'expired',
  'inactive',
  'timeout'
])
type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null
const exact = (value: RecordValue, fields: readonly string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((key) => Object.hasOwn(value, key))

function cancelQuietly(body: { cancel: () => Promise<unknown> } | null) {
  try {
    void body?.cancel().catch(() => undefined)
  } catch {
    /* A locked body cannot be cancelled directly. */
  }
}

function retryAfter(response: Response): number | undefined {
  if (response.status !== 429) return undefined
  const text = response.headers.get('retry-after')?.trim()
  const seconds =
    text && /^\d+(?:\.\d+)?$/.test(text)
      ? Number(text)
      : text
        ? (Date.parse(text) - Date.now()) / 1000
        : Number.NaN
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
}

export class ProviderAdmissionError extends Error {
  readonly code = 'PROVIDER_ADMISSION_REFUSED'
  readonly status = 503
  readonly localBackPressure = true

  constructor(readonly retryAfterSeconds?: number) {
    super('Provider traffic unavailable')
  }
}

/** Stable protocol subjects allow independent runtimes to share an account budget. */
export function createProviderAccountLabeler(key: string) {
  if (typeof key !== 'string' || new TextEncoder().encode(key).byteLength < 32)
    throw new ProviderAdmissionError()
  const signing = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return async (domain: ProviderDomain, identity?: string): Promise<string> => {
    let subject: string
    if (domain === 'cdn') subject = 'anonymous\0cdn'
    else {
      if (
        typeof identity !== 'string' ||
        identity.length === 0 ||
        identity.length > (domain === 'official' ? 512 : 200)
      )
        throw new ProviderAdmissionError()
      if (domain === 'official') subject = `official-credential\0${identity}`
      else if (domain === 'loki' || domain === 'websocket')
        subject = `game-account\0${identity}`
      else throw new ProviderAdmissionError()
    }
    try {
      const digest = new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          await signing,
          new TextEncoder().encode(subject)
        )
      )
      let encoded = ''
      for (const byte of digest) encoded += byte.toString(16).padStart(2, '0')
      return encoded
    } catch {
      throw new ProviderAdmissionError()
    }
  }
}

export function providerRequestTarget(
  input: RequestInfo | URL,
  init: RequestInit = {},
  officialOrigin = 'https://api.tacticusgame.com'
) {
  let url: URL
  try {
    url = new URL(input instanceof Request ? input.url : String(input))
  } catch {
    throw new ProviderAdmissionError()
  }
  if (url.username || url.password || url.search || url.hash)
    throw new ProviderAdmissionError()
  const method = (
    init.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  let domain: ProviderDomain | undefined
  let endpoint: string | undefined
  if (url.origin === officialOrigin && method === 'GET') {
    domain = 'official'
    if (
      ['/api/v1/player', '/api/v1/guild', '/api/v1/guildRaid'].includes(
        url.pathname
      )
    )
      endpoint = url.pathname
    else if (/^\/api\/v1\/guildRaid\/\d+$/.test(url.pathname))
      endpoint = '/api/v1/guildRaid/<id>'
  } else if (
    url.origin === 'https://api-live.loki.snowprintstudios.com' &&
    method === 'POST'
  ) {
    domain = 'loki'
    if (/^\/player\/player2\/userId\/[A-Za-z0-9_-]+$/.test(url.pathname))
      endpoint = '/player/player2/userId/<account>'
    else if (
      /^\/player\/player2\/userId\/[A-Za-z0-9_-]+\/sessionId\/[A-Za-z0-9_-]+$/.test(
        url.pathname
      )
    )
      endpoint = '/player/player2/userId/<account>/sessionId/<session>'
    else if (
      /^\/game-event\/game3\/userId\/[A-Za-z0-9_-]+\/sessionId\/[A-Za-z0-9_-]+$/.test(
        url.pathname
      )
    )
      endpoint = '/game-event/game3/userId/<account>/sessionId/<session>'
  } else if (
    url.origin === 'https://cdn.loki.snowprintstudios.com' &&
    method === 'GET'
  ) {
    domain = 'cdn'
    if (
      /^\/config\/global\/GlobalConfig\.[A-Fa-f0-9]{16,64}\.json$/.test(
        url.pathname
      )
    )
      endpoint = '/config/global/GlobalConfig.<hash>.json'
  }
  if (!domain || !endpoint) throw new ProviderAdmissionError()
  return { domain, endpoint }
}

export function createProviderAdmission(options: ProviderAdmissionOptions) {
  let origin: URL
  try {
    origin = new URL(options.authorityOrigin)
  } catch {
    throw new ProviderAdmissionError()
  }
  const rpcTimeout = options.rpcTimeoutMs ?? 800
  const pollMs = options.pollMs ?? 500
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !options.token ||
    /\s/.test(options.token) ||
    options.token.length > 8192 ||
    !Number.isInteger(rpcTimeout) ||
    rpcTimeout < 100 ||
    rpcTimeout > 5000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 100 ||
    pollMs > 5000
  )
    throw new ProviderAdmissionError()
  const controlFetch = options.controlFetch ?? globalThis.fetch
  const physicalFetch = options.physicalFetch ?? globalThis.fetch
  let officialOrigin = 'https://api.tacticusgame.com'
  if (options.officialOrigin) {
    try {
      const alias = new URL(options.officialOrigin)
      if (
        !['http:', 'https:'].includes(alias.protocol) ||
        alias.username ||
        alias.password ||
        alias.pathname !== '/' ||
        alias.search ||
        alias.hash ||
        alias.origin === origin.origin
      )
        throw new ProviderAdmissionError()
      officialOrigin = alias.origin
    } catch {
      throw new ProviderAdmissionError()
    }
  }

  async function rpc(
    operation: string,
    body: RecordValue,
    signal?: AbortSignal
  ): Promise<RecordValue> {
    signal?.throwIfAborted()
    const controller = new AbortController()
    let response: Response | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let rejectAborted!: (reason: unknown) => void
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = reject
    })
    const abort = () => {
      controller.abort()
      try {
        void reader?.cancel().catch(() => undefined)
      } catch {
        /* A failed control read stays refused. */
      }
      rejectAborted(
        signal?.aborted ? signal.reason : new ProviderAdmissionError()
      )
    }
    const timer = setTimeout(abort, rpcTimeout)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const work = (async () => {
        response = await controlFetch(
          `${origin.origin}/v1/admission/${operation}`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${options.token}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify(body),
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal
          }
        )
        if (controller.signal.aborted || !response.ok) {
          cancelQuietly(response.body)
          throw new ProviderAdmissionError()
        }
        if (!response.body) throw new ProviderAdmissionError()
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let text = '',
          bytes = 0
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 16384) {
            try {
              void reader.cancel().catch(() => undefined)
            } catch {
              /* Refuse oversized control data. */
            }
            throw new ProviderAdmissionError()
          }
          text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
        const value = record(JSON.parse(text))
        if (!value) throw new ProviderAdmissionError()
        return value
      })()
      return await Promise.race([work, aborted])
    } catch {
      if (signal?.aborted) throw signal.reason
      throw new ProviderAdmissionError()
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      controller.abort()
      try {
        reader?.releaseLock()
      } catch {
        /* A cancelled pending read owns its cleanup. */
      }
    }
  }

  function grant(
    value: RecordValue,
    status: 'reserved' | 'dispatch',
    id: string,
    timeoutMs: number
  ) {
    if (value.status === 'denied') {
      if (
        !exact(value, ['status', 'reason', 'retryAfterSeconds']) ||
        !reasons.has(String(value.reason)) ||
        !Number.isFinite(value.retryAfterSeconds) ||
        Number(value.retryAfterSeconds) <= 0
      )
        throw new ProviderAdmissionError()
      throw new ProviderAdmissionError(Number(value.retryAfterSeconds))
    }
    const expiry = status === 'reserved' ? 'claimUntil' : 'deadline'
    if (
      !exact(value, ['status', 'attemptId', expiry, 'timeoutMs']) ||
      value.status !== status ||
      value.attemptId !== id ||
      value.timeoutMs !== timeoutMs ||
      typeof value[expiry] !== 'string' ||
      String(value[expiry]).length > 40 ||
      !Number.isFinite(Date.parse(String(value[expiry]))) ||
      Date.parse(String(value[expiry])) <= Date.now()
    )
      throw new ProviderAdmissionError()
    return Date.parse(String(value[expiry]))
  }

  return {
    async fetch(
      input: RequestInfo | URL,
      init: RequestInit,
      dispatch: ProviderDispatch,
      operation?: ProviderOperation
    ): Promise<Response> {
      const descriptor = record(dispatch)
      if (
        !descriptor ||
        !exact(descriptor, [
          'domain',
          'account',
          'endpoint',
          'purpose',
          'priority',
          'timeoutMs'
        ]) ||
        dispatch.domain === 'websocket' ||
        !routes[dispatch.domain]?.includes(dispatch.endpoint) ||
        !/^[0-9a-f]{64}$/.test(dispatch.account) ||
        !purposes.has(dispatch.purpose) ||
        !['essential', 'background'].includes(dispatch.priority) ||
        !Number.isInteger(dispatch.timeoutMs) ||
        dispatch.timeoutMs < 100 ||
        dispatch.timeoutMs > 60000
      )
        throw new ProviderAdmissionError()
      const target = providerRequestTarget(input, init, officialOrigin)
      if (
        target.domain !== dispatch.domain ||
        target.endpoint !== dispatch.endpoint
      )
        throw new ProviderAdmissionError()
      const sourceSignal =
        init.signal ?? (input instanceof Request ? input.signal : undefined)
      sourceSignal?.throwIfAborted()
      // Validate the request before obtaining a permit; redirects are never a second dispatch.
      const requestInit = { ...init, redirect: 'error' as const }
      const prepared = new Request(input, requestInit)
      const attemptId = crypto.randomUUID()
      grant(
        await rpc(
          'reserve',
          { attemptId, ...dispatch },
          sourceSignal ?? undefined
        ),
        'reserved',
        attemptId,
        dispatch.timeoutMs
      )
      sourceSignal?.throwIfAborted()
      const deadline = grant(
        await rpc('dispatch', { attemptId }, sourceSignal ?? undefined),
        'dispatch',
        attemptId,
        dispatch.timeoutMs
      )
      const physical = new AbortController()
      const polling = new AbortController()
      let status = 0
      let delay: number | undefined
      let received: Response | undefined
      let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let output: ReadableStreamDefaultController<Uint8Array> | undefined
      let ended = false
      let closing = false
      let pollTimer: ReturnType<typeof setTimeout> | undefined
      let closeTimer: ReturnType<typeof setTimeout> | undefined
      let rejectPhysicalAbort!: (error: unknown) => void
      const physicalAbort = new Promise<never>((_, reject) => {
        rejectPhysicalAbort = reject
      })
      void physicalAbort.catch(() => undefined)

      const stop = () => {
        clearTimeout(deadlineTimer)
        clearTimeout(pollTimer)
        clearTimeout(closeTimer)
        sourceSignal?.removeEventListener('abort', abort)
        polling.abort()
      }
      const finish = (settled: boolean) => {
        if (ended) return
        ended = true
        stop()
        void rpc('outcome', {
          attemptId,
          status,
          settled,
          ...(delay ? { retryAfterSeconds: delay } : {})
        }).catch(() => undefined)
      }
      const abort = () => {
        if (ended || closing) return
        closing = true
        const reason = sourceSignal?.aborted
          ? sourceSignal.reason
          : new ProviderAdmissionError()
        // Ask the owned reader to cancel before abort errors its stream.
        // Only that cancellation's fulfillment can prove body settlement.
        let cancellation: Promise<unknown> | undefined
        try {
          if (bodyReader) cancellation = bodyReader.cancel()
          else if (received)
            cancellation = received.body
              ? received.body.cancel()
              : Promise.resolve()
        } catch {
          cancellation = Promise.reject(new ProviderAdmissionError())
        }
        physical.abort(reason)
        rejectPhysicalAbort(reason)
        polling.abort()
        clearTimeout(pollTimer)
        try {
          output?.error(reason)
        } catch {
          /* A consumer may already have closed. */
        }
        closeTimer = setTimeout(() => finish(false), 100)
        if (cancellation)
          void cancellation.then(
            () => finish(true),
            () => finish(false)
          )
      }
      const deadlineTimer = setTimeout(
        abort,
        Math.max(0, Math.min(dispatch.timeoutMs, deadline - Date.now()))
      )
      sourceSignal?.addEventListener('abort', abort, { once: true })
      if (sourceSignal?.aborted) abort()
      const poll = async () => {
        if (ended || closing) return
        try {
          const result = await rpc('check', { attemptId }, polling.signal)
          if (!exact(result, ['status']) || result.status !== 'continue') {
            abort()
            return
          }
          if (!ended && !closing)
            pollTimer = setTimeout(() => {
              void poll()
            }, pollMs)
        } catch {
          if (!ended && !closing) abort()
        }
      }
      pollTimer = setTimeout(() => {
        void poll()
      }, pollMs)

      try {
        physical.signal.throwIfAborted()
        let invokedPhysical = false
        const pending = Promise.resolve().then(() => {
          physical.signal.throwIfAborted()
          invokedPhysical = true
          const physicalInit = {
            ...requestInit,
            body: undefined,
            signal: physical.signal
          }
          return operation
            ? physicalFetch(prepared, physicalInit, { operation, dispatch })
            : physicalFetch(prepared, physicalInit)
        })
        // A late response after cancellation is drained without becoming a fallback send.
        void pending.then(
          (response) => {
            if (!closing) return
            try {
              void response.body?.cancel().then(
                () => finish(true),
                () => finish(false)
              )
            } catch {
              finish(false)
            }
            if (!response.body) finish(true)
          },
          // A fetch rejection after cancellation supplies no owned reader's
          // settlement proof. Keep the permit uncertain once a send began.
          () => finish(!closing || !invokedPhysical)
        )
        const response = await Promise.race([pending, physicalAbort])
        received = response
        status = response.status
        delay = retryAfter(response)
        if (delay) {
          // Publish the hold at headers, before a stalled error body can delay it.
          const receipt = await rpc('outcome', {
            attemptId,
            status,
            settled: false,
            retryAfterSeconds: delay,
            responseOnly: true
          })
          if (!exact(receipt, ['status']) || receipt.status !== 'continue')
            throw new ProviderAdmissionError()
        }
        if (!response.body) {
          finish(true)
          return response
        }
        bodyReader = response.body.getReader()
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            output = controller
          },
          async pull(controller) {
            try {
              const next = await bodyReader!.read()
              // Cancelling a ReadableStream resolves queued reads before its
              // underlying cancellation promise proves transport settlement.
              if (closing) return
              if (next.done) {
                controller.close()
                finish(true)
              } else controller.enqueue(next.value)
            } catch (error) {
              if (closing) return
              physical.abort()
              try {
                controller.error(error)
              } catch {
                /* Cancellation may already have errored the stream. */
              }
              finish(true)
            }
          },
          async cancel() {
            closing = true
            let cancellation: Promise<unknown>
            try {
              cancellation = bodyReader!.cancel()
            } catch {
              cancellation = Promise.reject(new ProviderAdmissionError())
            }
            physical.abort()
            polling.abort()
            clearTimeout(pollTimer)
            try {
              await Promise.race([
                cancellation.then(
                  () => finish(true),
                  () => finish(false)
                ),
                new Promise<void>((resolve) => {
                  closeTimer = setTimeout(() => {
                    finish(false)
                    resolve()
                  }, 100)
                })
              ])
            } catch {
              finish(false)
            }
          }
        })
        const wrap = (value: Response): Response =>
          new Proxy(value, {
            get(target, key) {
              if (key === 'url' || key === 'redirected' || key === 'type')
                return Reflect.get(response, key, response)
              if (key === 'clone') return () => wrap(target.clone())
              const member = Reflect.get(target, key, target)
              return typeof member === 'function' ? member.bind(target) : member
            }
          })
        return wrap(
          new Response(stream, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          })
        )
      } catch (error) {
        if (!ended && !closing) abort()
        throw error
      }
    }
  }
}

export interface ProviderRuntimeSettings {
  mode?: string
  authorityOrigin?: string
  token?: string
  accountLabelKey?: string
}

export function providerRequestDomain(
  url: URL,
  officialOrigin = 'https://api.tacticusgame.com'
): ProviderDomain | null {
  if (
    url.hostname === 'api.tacticusgame.com' ||
    url.hostname === new URL(officialOrigin).hostname
  )
    return 'official'
  if (url.hostname === 'api-live.loki.snowprintstudios.com') return 'loki'
  if (url.hostname === 'cdn.loki.snowprintstudios.com') return 'cdn'
  if (url.hostname === 'websocket-live.loki.snowprintstudios.com')
    return 'websocket'
  return null
}

/** Enrollment wraps the existing physical boundary; it never schedules or retries. */
export function createProviderRuntime(options: {
  settings: () => ProviderRuntimeSettings
  officialOrigin?: string
  physicalFetch: ProviderPhysicalFetch
  controlFetch?: typeof fetch
  /** True when an operator stop is engaged; checked before any admission exchange. */
  outboundStopped?: () => Promise<boolean>
}) {
  const officialOrigin =
    options.officialOrigin ?? 'https://api.tacticusgame.com'
  let cached:
    | {
        settings: Required<Omit<ProviderRuntimeSettings, 'mode'>>
        admission: ReturnType<typeof createProviderAdmission>
        resolve: ReturnType<typeof createProviderDispatchResolver>
      }
    | undefined
  return {
    async fetch(
      input: RequestInfo | URL,
      init: RequestInit = {},
      operation?: ProviderOperation
    ): Promise<Response> {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (!providerRequestDomain(url, officialOrigin))
        return options.physicalFetch(input, init)
      let settings: ProviderRuntimeSettings
      try {
        settings = options.settings()
      } catch {
        throw new ProviderAdmissionError()
      }
      if (settings.mode === undefined || settings.mode === 'off') {
        const physicalInit = { ...init, redirect: 'error' as const }
        return operation
          ? options.physicalFetch(input, physicalInit, { operation })
          : options.physicalFetch(input, physicalInit)
      }
      if (
        settings.mode !== 'enforce' ||
        !settings.authorityOrigin ||
        !settings.token ||
        !settings.accountLabelKey ||
        !operation
      )
        throw new ProviderAdmissionError()
      if (
        !cached ||
        cached.settings.authorityOrigin !== settings.authorityOrigin ||
        cached.settings.token !== settings.token ||
        cached.settings.accountLabelKey !== settings.accountLabelKey
      ) {
        cached = {
          settings: {
            authorityOrigin: settings.authorityOrigin,
            token: settings.token,
            accountLabelKey: settings.accountLabelKey
          },
          admission: createProviderAdmission({
            authorityOrigin: settings.authorityOrigin,
            token: settings.token,
            officialOrigin,
            controlFetch: options.controlFetch,
            physicalFetch: options.physicalFetch
          }),
          resolve: createProviderDispatchResolver({
            key: settings.accountLabelKey,
            officialOrigin
          })
        }
      }
      // The caller can mutate Headers or URL while HMAC derivation awaits.
      // Bind attribution and the physical send to the same private snapshot.
      const prepared = new Request(input, { ...init, redirect: 'error' })
      // A stopped dispatch must not reserve or claim capacity at the authority.
      if (await options.outboundStopped?.()) throw new ProviderAdmissionError()
      const dispatch = await cached.resolve(prepared, {}, operation)
      return cached.admission.fetch(prepared, {}, dispatch, operation)
    }
  }
}
