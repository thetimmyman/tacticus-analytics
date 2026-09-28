import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentry = vi.hoisted(() => {
  let activeTags: Record<string, string> = {}
  const tagsAtCapture: Array<Record<string, string>> = []
  return {
    tagsAtCapture,
    captureRequestError: vi.fn((..._args: unknown[]) => {
      tagsAtCapture.push({ ...activeTags })
    }),
    withScope: vi.fn(
      (
        callback: (scope: {
          setTags: (tags: Record<string, string>) => void
        }) => void
      ) => {
        const outer = activeTags
        try {
          callback({
            setTags: (tags) => {
              activeTags = { ...activeTags, ...tags }
            }
          })
        } finally {
          activeTags = outer
        }
      }
    )
  }
})

vi.mock('@sentry/nextjs', () => sentry)

const SAFE_TAG_VALUE = /^[A-Za-z0-9_.:-]{1,80}$/u

describe('onRequestError', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sentry.tagsAtCapture.length = 0
  })

  it('drops the React Flight abort raised when the client disconnects mid-stream', async () => {
    const { CLIENT_DISCONNECT_RENDER_ABORT, onRequestError } =
      await import('@/app/lib/monitoring/request-error')
    const request = { path: '/wars', method: 'GET', headers: {} }
    const context = {
      routerKind: 'App Router' as const,
      routePath: '/wars/page',
      routeType: 'render' as const,
      revalidateReason: undefined
    }

    await onRequestError(
      new Error(CLIENT_DISCONNECT_RENDER_ABORT),
      request,
      context
    )
    await onRequestError(
      { name: 'Error', message: CLIENT_DISCONNECT_RENDER_ABORT },
      request,
      context
    )
    await onRequestError(new Error(CLIENT_DISCONNECT_RENDER_ABORT), request, {
      ...context,
      routeType: 'action' as const
    })

    expect(sentry.withScope).not.toHaveBeenCalled()
    expect(sentry.captureRequestError).not.toHaveBeenCalled()
  })

  it('captures every other error once, unchanged, with route tags on the scope', async () => {
    const { onRequestError } =
      await import('@/app/lib/monitoring/request-error')
    const error = new Error('Synthetic render failure')
    const request = { path: '/wars/abc', method: 'GET', headers: {} }
    const context = {
      routerKind: 'App Router' as const,
      routePath: '/wars/[warId]/page',
      routeType: 'render' as const,
      revalidateReason: undefined
    }

    await onRequestError(error, request, context)

    expect(sentry.captureRequestError).toHaveBeenCalledTimes(1)
    const [capturedError, capturedRequest, capturedContext] =
      sentry.captureRequestError.mock.calls[0]
    expect(capturedError).toBe(error)
    expect(capturedRequest).toBe(request)
    expect(capturedContext).toBe(context)
    expect(sentry.tagsAtCapture).toEqual([
      { operation: 'GET:wars._', source: 'next.render' }
    ])
  })

  it('still reports that message from route handlers, which never stream React Flight', async () => {
    const { CLIENT_DISCONNECT_RENDER_ABORT, onRequestError } =
      await import('@/app/lib/monitoring/request-error')
    const error = new Error(CLIENT_DISCONNECT_RENDER_ABORT)
    const request = { path: '/api/files', method: 'POST', headers: {} }
    const context = {
      routerKind: 'App Router' as const,
      routePath: '/api/files/route',
      routeType: 'route' as const,
      revalidateReason: undefined
    }

    await onRequestError(error, request, context)

    expect(sentry.captureRequestError).toHaveBeenCalledTimes(1)
    expect(sentry.captureRequestError.mock.calls[0][0]).toBe(error)
    expect(sentry.tagsAtCapture).toEqual([
      { operation: 'POST:api.files', source: 'next.route' }
    ])
  })

  it('is the handler instrumentation.ts exports to Next', async () => {
    const requestErrors = await import('@/app/lib/monitoring/request-error')
    const instrumentation = await import('../../../instrumentation')

    expect(instrumentation.onRequestError).toBe(requestErrors.onRequestError)
  })
})

describe('isClientDisconnectRenderAbort', () => {
  it.each([
    [
      'sibling stream write error',
      new Error('The destination stream errored while writing data.')
    ],
    [
      'message with extra text',
      new Error('The destination stream closed early. (retry)')
    ],
    ['plain string', 'The destination stream closed early.'],
    ['null', null],
    ['undefined', undefined],
    ['object without message', { name: 'Error' }]
  ])('does not match %s', async (_label, value) => {
    const { isClientDisconnectRenderAbort } =
      await import('@/app/lib/monitoring/request-error')

    expect(isClientDisconnectRenderAbort(value)).toBe(false)
  })

  it('still matches the message React Flight ships in the installed Next runtime', async () => {
    const { CLIENT_DISCONNECT_RENDER_ABORT } =
      await import('@/app/lib/monitoring/request-error')
    const runtime = readFileSync(
      path.join(
        process.cwd(),
        'node_modules/next/dist/compiled/next-server/app-page-turbo.runtime.prod.js'
      ),
      'utf8'
    )

    expect(runtime).toContain(JSON.stringify(CLIENT_DISCONNECT_RENDER_ABORT))
  })
})

describe('requestErrorTags', () => {
  it.each([
    [
      '/(dashboard)/guild-ops/player-lookup/page',
      'GET',
      'render',
      'GET:guild-ops.player-lookup',
      'next.render'
    ],
    ['/wars/[warId]/page', 'GET', 'render', 'GET:wars._', 'next.render'],
    ['/api/wars/[warId]/route', 'GET', 'route', 'GET:api.wars._', 'next.route'],
    ['/page', 'GET', 'render', 'GET:root', 'next.render'],
    ['/@modal/(.)photo/[id]/page', 'GET', 'render', 'GET:_._', 'next.render'],
    ['/docs/[[...slug]]/page', 'GET', 'render', 'GET:docs._', 'next.render'],
    [
      '/files/[...parts]/route',
      'DELETE',
      'route',
      'DELETE:files._',
      'next.route'
    ],
    ['/proxy', 'GET', 'proxy', 'GET:proxy', 'next.proxy'],
    [
      '/guild-ops/player-lookup/page',
      'POST',
      'action',
      'POST:guild-ops.player-lookup',
      'next.action'
    ],
    ['/season-2/page', 'GET', 'render', 'GET:season-2', 'next.render'],
    ['/safe/page', 'BREW', 'render', 'UNKNOWN:safe', 'next.render'],
    ['/safe/page', 'GET', 'weird', 'GET:safe', 'next.unknown'],
    ['/Guild2/ünïcode/page', 'GET', 'render', 'GET:_._', 'next.render']
  ])('%s (%s, %s)', async (routePath, method, routeType, operation, source) => {
    const { requestErrorTags } =
      await import('@/app/lib/monitoring/request-error')

    expect(requestErrorTags({ method }, { routePath, routeType })).toEqual({
      operation,
      source
    })
  })

  it('always yields values the Sentry privacy scrubber keeps unchanged', async () => {
    const { requestErrorTags } =
      await import('@/app/lib/monitoring/request-error')
    const { sanitizeSentryEvent } =
      await import('@/app/lib/monitoring/sentry-privacy')
    const hostile: Array<
      [string | undefined, string | undefined, string | undefined]
    > = [
      [undefined, undefined, undefined],
      ['', '', ''],
      ['/'.repeat(500), 'GET', 'render'],
      [`/${'a'.repeat(300)}/page`, 'GET', 'render'],
      [`/${'abc/'.repeat(60)}page`, 'OPTIONS', 'route'],
      ['a/b c/%2F/<script>alert(1)</script>', 'GET', 'render'],
      ['/\u{1F680}/page', 'get', 'RENDER'],
      ['/x@example.test/page', 'GET\n', 'render\u0000']
    ]

    for (const [routePath, method, routeType] of hostile) {
      const tags = requestErrorTags({ method }, { routePath, routeType })

      expect(tags.operation).toMatch(SAFE_TAG_VALUE)
      expect(tags.source).toMatch(SAFE_TAG_VALUE)
      expect(sanitizeSentryEvent({ tags }).tags).toEqual(tags)
    }
  })
})
