import { describe, expect, it, vi } from 'vitest'

// The module calls Sentry init() at import time; keep the options it passes.
const { init } = vi.hoisted(() => ({ init: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({
  addIntegration: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
  init,
  lazyLoadIntegration: vi.fn(() => Promise.resolve(vi.fn()))
}))

import { isExtensionInpageEvent } from '@/instrumentation-client'

type Frame = { filename?: string; function?: string }
const value = (frames: Frame[] | undefined, type = 'Error') => ({
  type,
  value: 'Application error',
  ...(frames ? { stacktrace: { frames } } : {})
})

const INPAGE = 'app:///scripts/inpage.js'
const APP_CHUNK = 'https://app.example.test/_next/static/chunks/main-abc123.js'

describe('isExtensionInpageEvent', () => {
  it.each([
    INPAGE,
    'chrome-extension://abcdefghijklmnop/scripts/inpage.js',
    'moz-extension://0000-1111/inpage.js',
    'inpage.js'
  ])('matches a stack made only of %s', (filename) => {
    expect(
      isExtensionInpageEvent({
        exception: {
          values: [value([{ filename, function: 'Object.connect' }])]
        }
      })
    ).toBe(true)
  })

  it('matches when EVERY exception in a cause chain is inpage-only', () => {
    expect(
      isExtensionInpageEvent({
        exception: {
          values: [
            value([{ filename: INPAGE }]),
            value([{ filename: INPAGE }], 'i')
          ]
        }
      })
    ).toBe(true)
  })

  it('does NOT match when any frame is application code', () => {
    expect(
      isExtensionInpageEvent({
        exception: {
          values: [value([{ filename: APP_CHUNK }, { filename: INPAGE }])]
        }
      })
    ).toBe(false)
  })

  it('does NOT match when one exception in the chain is application code', () => {
    expect(
      isExtensionInpageEvent({
        exception: {
          values: [
            value([{ filename: INPAGE }]),
            value([{ filename: APP_CHUNK }])
          ]
        }
      })
    ).toBe(false)
  })

  it.each([
    'https://app.example.test/_next/static/chunks/inpage.js',
    'https://app.example.test/_next/static/chunks/inpage-abc123.js',
    'app:///scripts/not-inpage.js',
    'app:///scripts/inpage.js.map',
    'app:///inpage/page.js',
    ''
  ])('does NOT match the look-alike filename %s', (filename) => {
    expect(
      isExtensionInpageEvent({ exception: { values: [value([{ filename }])] } })
    ).toBe(false)
  })

  it('does NOT match without stack evidence', () => {
    expect(isExtensionInpageEvent({})).toBe(false)
    expect(isExtensionInpageEvent({ exception: {} })).toBe(false)
    expect(isExtensionInpageEvent({ exception: { values: [] } })).toBe(false)
    expect(
      isExtensionInpageEvent({ exception: { values: [value(undefined)] } })
    ).toBe(false)
    expect(isExtensionInpageEvent({ exception: { values: [value([])] } })).toBe(
      false
    )
    expect(
      isExtensionInpageEvent({
        exception: { values: [value([{ function: 'connect' }])] }
      })
    ).toBe(false)
    expect(
      isExtensionInpageEvent({
        exception: { values: [value([{ filename: INPAGE }]), value(undefined)] }
      })
    ).toBe(false)
  })
})

describe('client beforeSend', () => {
  const beforeSend = init.mock.calls[0]?.[0]?.beforeSend as (
    event: Record<string, unknown>,
    hint: { originalException?: unknown }
  ) => Record<string, unknown> | null

  const eventWith = (filename: string) => ({
    level: 'error',
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Application error',
          stacktrace: { frames: [{ filename, function: 'Object.connect' }] }
        }
      ]
    }
  })

  it('is the filter the client registers at import', () => {
    expect(typeof beforeSend).toBe('function')
  })

  it('drops an event raised entirely inside an extension inpage script', () => {
    const error = new Error('Application error')
    expect(
      beforeSend(eventWith(INPAGE), { originalException: error })
    ).toBeNull()
  })

  it('keeps the same error when it comes from application code', () => {
    const error = new Error('Application error')
    const sent = beforeSend(eventWith(APP_CHUNK), { originalException: error })
    expect(sent).not.toBeNull()
    expect(sent?.level).toBe('error')
    expect(
      (sent?.exception as { values: Array<{ value: string }> }).values[0].value
    ).toBe('Application error')
  })

  it('keeps an application error that merely passes through an inpage frame', () => {
    const event = eventWith(INPAGE)
    event.exception.values[0].stacktrace.frames.unshift({
      filename: APP_CHUNK,
      function: 'onClick'
    })
    expect(
      beforeSend(event, { originalException: new Error('Application error') })
    ).not.toBeNull()
  })
})
