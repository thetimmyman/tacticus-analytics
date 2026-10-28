import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeSentryEvent } from '@/app/lib/monitoring/sentry-privacy'
import { browserRenderErrorTags } from '@/app/lib/monitoring/browser-render-error'

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getClient: vi.fn(() => ({}))
}))

vi.mock('@sentry/nextjs', () => sentry)

const initialLocation = window.location.href

const tagsFor = (pathname: unknown, error: unknown = new Error('synthetic')) =>
  browserRenderErrorTags(error, pathname)

const FAMILY_CASES: Array<[string, string]> = [
  ['/', 'home'],
  ['/home', 'home'],
  ['/dashboard/summary', 'home'],
  ['/roster', 'roster'],
  ['/roster-development/anything', 'roster'],
  ['/guild-management/anything', 'guild'],
  ['/guild-ops', 'guild'],
  ['/guild-settings', 'guild'],
  ['/guild-teams', 'guild'],
  ['/guild-trends', 'guild'],
  ['/wars', 'wars'],
  ['/war-room', 'wars'],
  ['/war-explorer/anything', 'wars'],
  ['/boss', 'boss'],
  ['/boss-assignments', 'boss'],
  ['/boss-playbooks', 'boss'],
  ['/explore/anything', 'explore'],
  ['/leaderboards/anything', 'explore'],
  ['/player-stats', 'player'],
  ['/player-performance/anything', 'player'],
  ['/auth/onboarding', 'auth'],
  ['/onboarding', 'auth'],
  ['/unauthorized', 'auth'],
  ['/api-keys', 'account'],
  ['/profile/anything', 'account'],
  ['/privacy-rights', 'account'],
  ['/clusters/anything', 'clusters'],
  ['/token-usage', 'tokens'],
  ['/replays/anything', 'replays'],
  ['/meta-atlas/anything', 'meta'],
  ['/achievements', 'awards'],
  ['/votlw/anything', 'awards']
]

const OTHER_PATHS: unknown[] = [
  undefined,
  null,
  42,
  true,
  {},
  [],
  '',
  'roster',
  'https://example.test/roster',
  '//example.test/roster',
  '/__proto__/anything',
  '/constructor',
  '/prototype/anything',
  '/ROSTER',
  '/unknown/roster',
  '/roster-development%2Fprivate',
  '/roster%2Ddevelopment'
]

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState({}, '', initialLocation)
})

describe('browserRenderErrorTags', () => {
  it('emits exactly the fixed tag keys and static values', () => {
    expect(tagsFor('/roster-development/abc')).toEqual({
      source: 'react.error-boundary',
      operation: 'browser.render.roster',
      error_code: 'REACT_RENDER_FAILURE'
    })
  })

  it.each(FAMILY_CASES)('maps %s to browser.render.%s', (pathname, family) => {
    expect(tagsFor(pathname).operation).toBe(`browser.render.${family}`)
  })

  it.each(OTHER_PATHS)(
    'guards malformed or unknown pathname %s as other',
    (pathname) => {
      expect(tagsFor(pathname).operation).toBe('browser.render.other')
    }
  )

  it('inspects only the first static segment', () => {
    expect(tagsFor('/unknown/roster').operation).toBe('browser.render.other')
    expect(tagsFor('/roster/unknown').operation).toBe('browser.render.roster')
    expect(tagsFor('/roster/../../home').operation).toBe(
      'browser.render.roster'
    )
  })

  it('never emits a raw path remainder, query, fragment or error text', () => {
    const privatePath =
      '/guild-management/SecretGuild?token=private-token#private-fragment'
    const privateMessage = 'Synthetic failure for person@example.test'
    const tags = browserRenderErrorTags(new Error(privateMessage), privatePath)

    expect(Object.keys(tags).sort()).toEqual([
      'error_code',
      'operation',
      'source'
    ])

    const serialized = JSON.stringify(tags)
    for (const secret of [
      'SecretGuild',
      'private-token',
      'private-fragment',
      'person@example.test',
      privateMessage
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('keeps fixed tags through the existing privacy sanitizer', () => {
    const privatePath =
      '/guild-management/SecretGuild?token=private-token#private-fragment'
    const privateMessage = 'Synthetic failure for person@example.test'
    const tags = browserRenderErrorTags(new Error(privateMessage), privatePath)

    const event = sanitizeSentryEvent({
      tags,
      extra: { pathname: privatePath, message: privateMessage },
      exception: { values: [{ value: privateMessage }] }
    })

    expect(event.tags).toEqual(tags)
    const serialized = JSON.stringify(event)
    for (const secret of [
      'SecretGuild',
      'private-token',
      'private-fragment',
      'person@example.test'
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('classifies the React invalid-child messages, not #310', () => {
    expect(
      tagsFor('/', new Error('Objects are not valid as a React child'))
        .error_code
    ).toBe('REACT_INVALID_CHILD')
    expect(
      tagsFor(
        '/',
        new Error(
          'Objects are not valid as a React child (found: object with keys {name})'
        )
      ).error_code
    ).toBe('REACT_INVALID_CHILD')
    expect(tagsFor('/', new Error('Minified React error #31')).error_code).toBe(
      'REACT_INVALID_CHILD'
    )
    expect(
      tagsFor('/', new Error('Minified React error #310')).error_code
    ).toBe('REACT_RENDER_FAILURE')
    expect(
      tagsFor('/', new Error('Minified React error #311')).error_code
    ).toBe('REACT_RENDER_FAILURE')
    expect(
      tagsFor('/', new Error('Minified React error #31arbitrary')).error_code
    ).toBe('REACT_RENDER_FAILURE')
  })

  it('classifies NotFoundError DOM insert/remove failures by duck typing', () => {
    const insert = {
      name: 'NotFoundError',
      message:
        "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node."
    }
    const remove = {
      name: 'NotFoundError',
      message:
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."
    }
    const other = {
      name: 'NotFoundError',
      message: 'The object can not be found here.'
    }

    expect(tagsFor('/', insert).error_code).toBe('DOM_INSERT_TARGET_MISSING')
    expect(tagsFor('/', remove).error_code).toBe('DOM_REMOVE_TARGET_MISSING')
    expect(tagsFor('/', other).error_code).toBe('DOM_NOT_FOUND')
    expect(tagsFor('/', { name: 'NotFoundError' }).error_code).toBe(
      'DOM_NOT_FOUND'
    )
    expect(tagsFor('/', new Error('insertBefore removeChild')).error_code).toBe(
      'REACT_RENDER_FAILURE'
    )
  })

  it('falls back safely when reading error fields throws', () => {
    const throwingMessage = Object.defineProperty({}, 'message', {
      get() {
        throw new Error('synthetic getter failure')
      }
    })
    const throwingName = Object.defineProperty(
      { message: 'Objects are not valid as a React child' },
      'name',
      {
        get() {
          throw new Error('synthetic getter failure')
        }
      }
    )

    expect(tagsFor('/', throwingMessage).error_code).toBe(
      'REACT_RENDER_FAILURE'
    )
    expect(tagsFor('/', throwingName).error_code).toBe('REACT_INVALID_CHILD')
    expect(tagsFor('/', null).error_code).toBe('REACT_RENDER_FAILURE')
    expect(tagsFor('/', 17).error_code).toBe('REACT_RENDER_FAILURE')
  })
})

describe('ErrorBoundary browser render telemetry', () => {
  it('adds fixed tags to the single existing capture without changing the error', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1')
    vi.resetModules()

    const React = await import('react')
    const { render, cleanup } = await import('@testing-library/react')
    const { ErrorBoundary } =
      await import('@/app/components/error/ErrorBoundary')

    const privatePath =
      '/guild-management/SecretGuild?token=private-token#private-fragment'
    window.history.replaceState({}, '', privatePath)

    const thrown = new Error(
      'Synthetic failure for person@example.test with SecretGuild'
    )
    function Explodes(): never {
      throw thrown
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      render(
        React.createElement(ErrorBoundary, {
          autoReset: false,
          showDetails: false,
          children: React.createElement(Explodes)
        })
      )
    } finally {
      consoleError.mockRestore()
    }

    expect(sentry.captureException).toHaveBeenCalledTimes(1)
    const [capturedError, context] = sentry.captureException.mock.calls[0]
    expect(capturedError).toBe(thrown)
    expect(context.tags).toMatchObject({
      component: 'ErrorBoundary',
      boundary: 'ErrorBoundary',
      source: 'react.error-boundary',
      operation: 'browser.render.guild',
      error_code: 'REACT_RENDER_FAILURE'
    })

    const serializedTags = JSON.stringify(context.tags)
    for (const secret of [
      'SecretGuild',
      'private-token',
      'private-fragment',
      'person@example.test'
    ]) {
      expect(serializedTags).not.toContain(secret)
    }

    cleanup()
  })
})
