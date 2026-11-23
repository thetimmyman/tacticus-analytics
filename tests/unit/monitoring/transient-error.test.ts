import { PostgrestClient } from '@supabase/postgrest-js'
import { GoTrueClient } from '@supabase/auth-js'
import { describe, expect, it, vi } from 'vitest'
import {
  hasTransientCause,
  isTransientUpstreamError
} from '@/app/lib/monitoring/transient-error'

const sentry = vi.hoisted(() => ({
  addIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init: vi.fn(),
  lazyLoadIntegration: vi.fn(() => Promise.resolve(vi.fn()))
}))

vi.mock('@sentry/nextjs', () => sentry)

type BeforeSendHook = (
  event: Record<string, unknown>,
  hint: { originalException?: unknown }
) => Record<string, unknown> | null

async function loadBeforeSendHooks(): Promise<Record<string, BeforeSendHook>> {
  const loaders: Array<[string, () => Promise<unknown>]> = [
    ['client', () => import('../../../instrumentation-client')],
    ['server', () => import('../../../sentry.server.config')],
    ['edge', () => import('../../../sentry.edge.config')]
  ]
  const hooks: Record<string, BeforeSendHook> = {}
  for (const [name, load] of loaders) {
    vi.resetModules()
    sentry.init.mockClear()
    await load()
    const beforeSend = sentry.init.mock.calls[0]?.[0]?.beforeSend as
      BeforeSendHook | undefined
    if (typeof beforeSend !== 'function') {
      throw new Error(`Missing beforeSend hook for ${name}`)
    }
    hooks[name] = beforeSend
  }
  return hooks
}

function makeEvent(error: Error): Record<string, unknown> {
  return {
    level: 'error',
    exception: {
      values: [{ type: error.name, value: error.message }]
    }
  }
}

function wrapped(cause: unknown): Error {
  return new Error('Unable to verify account access', { cause })
}

async function queryPostgrestWithFetch(
  customFetch: typeof fetch
): Promise<unknown> {
  const client = new PostgrestClient('https://database.example/rest/v1', {
    fetch: customFetch
  })
  const { error } = await client.from('user_bans').select('id').retry(false)
  return error
}

describe('hasTransientCause', () => {
  it('matches verified transport Error causes behind the account-access wrapper', () => {
    expect(hasTransientCause(wrapped(new TypeError('fetch failed')))).toBe(true)
    expect(hasTransientCause(wrapped(new Error('socket hang up')))).toBe(true)
    expect(
      hasTransientCause(
        wrapped(
          Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
        )
      )
    ).toBe(true)
    expect(
      hasTransientCause(
        wrapped(
          Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })
        )
      )
    ).toBe(true)
    expect(
      hasTransientCause(wrapped(new Error('failed to pipe response')))
    ).toBe(true)
  })

  it('walks nested transport-only cause chains and nested allowlisted wrappers', () => {
    const socketCause = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET'
    })
    const fetchFailure = new TypeError('fetch failed', { cause: socketCause })
    expect(hasTransientCause(wrapped(fetchFailure))).toBe(true)
    expect(hasTransientCause(wrapped(wrapped(fetchFailure)))).toBe(true)
  })

  it('classifies real PostgrestClient transport failures while rejecting database/HTTP errors', async () => {
    const transportError = await queryPostgrestWithFetch(async () => {
      throw new TypeError('fetch failed')
    })
    expect(transportError).not.toBeInstanceOf(Error)
    expect(hasTransientCause(wrapped(transportError))).toBe(true)

    const nestedTransportError = await queryPostgrestWithFetch(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET'
        })
      })
    })
    expect(hasTransientCause(wrapped(nestedTransportError))).toBe(true)

    const permissionError = await queryPostgrestWithFetch(
      async () =>
        new Response(
          JSON.stringify({
            code: '42501',
            message: 'permission denied for schema cache',
            details: null,
            hint: null
          }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
    )
    expect(hasTransientCause(wrapped(permissionError))).toBe(false)

    const missingFnError = await queryPostgrestWithFetch(
      async () =>
        new Response(
          JSON.stringify({
            code: 'PGRST202',
            message:
              'Could not find the function public.enforce_account_access in the schema cache',
            details: 'Searched for the function',
            hint: null
          }),
          { status: 404, headers: { 'content-type': 'application/json' } }
        )
    )
    expect(hasTransientCause(wrapped(missingFnError))).toBe(false)

    const gatewayTextError = await queryPostgrestWithFetch(
      async () => new Response('fetch failed upstream', { status: 502 })
    )
    expect(hasTransientCause(wrapped(gatewayTextError))).toBe(false)
  })

  it('classifies GoTrue transport errors (status 0) while retaining HTTP auth failures', async () => {
    const failingAuth = new GoTrueClient({
      url: 'https://auth.example/auth/v1',
      autoRefreshToken: false,
      persistSession: false,
      fetch: async () => {
        throw new TypeError('fetch failed')
      }
    })
    const { error: transportAuthError } = await failingAuth.admin.getUserById(
      '00000000-0000-0000-0000-000000000000'
    )
    expect(hasTransientCause(wrapped(transportAuthError))).toBe(true)

    const unauthorizedAuth = new GoTrueClient({
      url: 'https://auth.example/auth/v1',
      autoRefreshToken: false,
      persistSession: false,
      fetch: async () =>
        new Response(JSON.stringify({ message: 'Invalid JWT: fetch failed' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        })
    })
    const { error: authHttpError } = await unauthorizedAuth.admin.getUserById(
      '00000000-0000-0000-0000-000000000000'
    )
    expect(hasTransientCause(wrapped(authHttpError))).toBe(false)
  })

  it('rejects security/domain outer wrappers, intermediate security/domain errors, and schema/function errors', () => {
    expect(
      hasTransientCause(
        new Error('Invalid signature', { cause: new Error('fetch failed') })
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        new Error('Session verification failed', {
          cause: new Error('fetch failed')
        })
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        wrapped(
          new Error('Invalid signature', { cause: new Error('fetch failed') })
        )
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        wrapped(
          new Error('lookup failed', { cause: new Error('fetch failed') })
        )
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        wrapped(
          new Error('fetch failed', { cause: new Error('Invalid signature') })
        )
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        wrapped(new Error('permission denied for schema cache'))
      )
    ).toBe(false)
    expect(hasTransientCause(wrapped(new Error('schema cache is stale')))).toBe(
      false
    )
    expect(
      hasTransientCause(
        wrapped(new Error('function enforce_account_access does not exist'))
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        wrapped(new Error('the function does not exist in the schema cache'))
      )
    ).toBe(false)
    expect(hasTransientCause(wrapped(new Error('permission denied')))).toBe(
      false
    )
  })

  it('rejects unvalidated plain objects, missing causes, and cycles', () => {
    expect(hasTransientCause(wrapped({ message: 'fetch failed' }))).toBe(false)
    expect(
      hasTransientCause(
        wrapped({
          message: 'TypeError: fetch failed',
          details: '',
          hint: '',
          code: '42501'
        })
      )
    ).toBe(false)
    expect(
      hasTransientCause(
        wrapped({
          message: 'TypeError: fetch failed: Invalid signature',
          details: '',
          hint: '',
          code: ''
        })
      )
    ).toBe(false)
    expect(
      hasTransientCause(new Error('Unable to verify account access'))
    ).toBe(false)
    expect(hasTransientCause(wrapped('fetch failed'))).toBe(false)
    expect(hasTransientCause(wrapped(null))).toBe(false)

    const a = new Error('Unable to verify account access')
    const b = new Error('Unable to verify account access', { cause: a })
    a.cause = b
    expect(hasTransientCause(wrapped(a))).toBe(false)
  })
})

describe('isTransientUpstreamError', () => {
  it('recognizes recoverable upstream statuses and circuit-breaker trips', () => {
    expect(
      isTransientUpstreamError(
        Object.assign(new Error('API returned 500'), { statusCode: 500 })
      )
    ).toBe(true)
    expect(isTransientUpstreamError(new Error('API returned 500'))).toBe(true)
    expect(isTransientUpstreamError(new Error('API returned 503'))).toBe(true)
    expect(isTransientUpstreamError(new Error('API returned 429'))).toBe(true)
    expect(isTransientUpstreamError(new Error('API returned 408'))).toBe(true)
    expect(
      isTransientUpstreamError(
        Object.assign(new Error('Bad Gateway'), { status: 502 })
      )
    ).toBe(true)
    expect(
      isTransientUpstreamError(
        new Error('Circuit breaker is OPEN — too many recent failures')
      )
    ).toBe(true)
  })

  it('rejects permanent 4xx, non-transient text, and non-numeric statuses', () => {
    expect(isTransientUpstreamError(new Error('API returned 400'))).toBe(false)
    expect(isTransientUpstreamError(new Error('API returned 404'))).toBe(false)
    expect(
      isTransientUpstreamError(
        Object.assign(new Error('Bad Gateway'), { statusCode: 409 })
      )
    ).toBe(false)
    expect(
      isTransientUpstreamError(
        Object.assign(new Error('Bad Gateway'), { statusCode: '500' })
      )
    ).toBe(false)
    expect(isTransientUpstreamError(new Error('duplicate key'))).toBe(false)
    expect(isTransientUpstreamError(undefined)).toBe(false)
    expect(isTransientUpstreamError(null)).toBe(false)
    expect(isTransientUpstreamError('API returned 500')).toBe(false)
  })
})

describe('beforeSend hooks across client, server, and edge configs', () => {
  it('retains security/permission/schema errors while dropping verified transport-backed account-access wrappers', async () => {
    const hooks = await loadBeforeSendHooks()
    const postgrestTransport = await queryPostgrestWithFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const postgrestPermission = await queryPostgrestWithFetch(
      async () =>
        new Response(
          JSON.stringify({
            code: '42501',
            message: 'permission denied for schema cache',
            details: null,
            hint: null
          }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
    )

    for (const [hookName, beforeSend] of Object.entries(hooks)) {
      const retainedCases = [
        new Error('Invalid signature'),
        new Error('Invalid signature', { cause: new Error('fetch failed') }),
        new Error('Invalid signature', { cause: postgrestTransport }),
        wrapped(
          new Error('Invalid signature', { cause: new Error('fetch failed') })
        ),
        wrapped(new Error('permission denied for schema cache')),
        wrapped(new Error('function enforce_account_access does not exist')),
        wrapped(postgrestPermission),
        new Error('permission denied for schema cache')
      ]

      for (const err of retainedCases) {
        expect(
          beforeSend(makeEvent(err), { originalException: err }),
          `${hookName} should retain: ${err.message}`
        ).not.toBeNull()
      }

      const droppedCases = [
        wrapped(new TypeError('fetch failed')),
        wrapped(new TypeError('Failed to fetch')),
        wrapped(new TypeError('Load failed')),
        wrapped(
          new TypeError('NetworkError when attempting to fetch resource.')
        ),
        wrapped(postgrestTransport)
      ]

      for (const err of droppedCases) {
        expect(
          beforeSend(makeEvent(err), { originalException: err }),
          `${hookName} should drop: ${err.message}`
        ).toBeNull()
      }
    }
  })

  it('server beforeSend drops transient upstream failures without affecting client/edge', async () => {
    const hooks = await loadBeforeSendHooks()
    const upstreamErrors = [
      Object.assign(new Error('API returned 500'), { statusCode: 500 }),
      Object.assign(new Error('API returned 429'), { statusCode: 429 }),
      new Error('Circuit breaker is OPEN — too many recent failures')
    ]

    for (const err of upstreamErrors) {
      expect(
        hooks.server(makeEvent(err), { originalException: err }),
        `server should drop: ${err.message}`
      ).toBeNull()
    }

    // Client and edge keep these (they only see browser/edge failures).
    for (const err of upstreamErrors) {
      expect(
        hooks.client(makeEvent(err), { originalException: err }),
        `client should retain: ${err.message}`
      ).not.toBeNull()
      expect(
        hooks.edge(makeEvent(err), { originalException: err }),
        `edge should retain: ${err.message}`
      ).not.toBeNull()
    }
  })
})
