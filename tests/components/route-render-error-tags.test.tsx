import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { sanitizeSentryEvent } from '@/app/lib/monitoring/sentry-privacy'

const { captureSentryException } = vi.hoisted(() => ({
  captureSentryException: vi.fn()
}))
vi.mock('@/app/lib/monitoring/sentry', () => ({ captureSentryException }))
vi.mock('@/app/lib/client/chunk-reload', () => ({
  handleChunkLoadError: vi.fn(),
  isChunkLoadError: vi.fn()
}))

import RouteError from '@/app/error'
import GlobalError from '@/app/global-error'
import BossAssignmentsError from '@/app/(dashboard)/boss-assignments/error'
import {
  handleChunkLoadError,
  isChunkLoadError
} from '@/app/lib/client/chunk-reload'

const initialLocation = window.location.href

const syntheticInsertBefore = () =>
  Object.assign(
    new Error(
      "Failed to execute 'insertBefore' on 'Node': synthetic target is not a child of this node. Contact synthetic.person@example.test"
    ),
    { name: 'NotFoundError', digest: 'synthetic-digest' }
  )

const syntheticRemoveChild = () =>
  Object.assign(
    new Error(
      "Failed to execute 'removeChild' on 'Node': synthetic target is not a child of this node. Contact synthetic.person@example.test"
    ),
    { name: 'NotFoundError', digest: 'synthetic-digest' }
  )

const PRIVATE_PATHS = {
  'app/error': '/wars/synthetic-secret-remainder?token=synthetic-token#frag',
  'app/global-error':
    '/guild-management/synthetic-secret-remainder?token=synthetic-token#frag',
  'boss-assignments/error':
    '/boss-assignments/synthetic-secret-remainder?token=synthetic-token#frag'
} as const

const LEAK_MARKERS = [
  'synthetic-secret-remainder',
  'synthetic-token',
  'frag',
  'synthetic.person@example.test',
  'synthetic-digest'
]

const expectSafeTags = (expected: {
  component: string
  operation: string
  error_code: string
}) => {
  const [capturedError, context] = captureSentryException.mock.calls[0]
  expect(context.tags).toEqual({
    component: expected.component,
    source: 'react.error-boundary',
    operation: expected.operation,
    error_code: expected.error_code
  })
  expect(Object.keys(context.tags).sort()).toEqual([
    'component',
    'error_code',
    'operation',
    'source'
  ])
  const serialized = JSON.stringify(context.tags)
  for (const marker of LEAK_MARKERS) {
    expect(serialized).not.toContain(marker)
  }
  // The same static tags survive the beforeSend privacy sanitizer unchanged.
  expect(sanitizeSentryEvent({ tags: context.tags }).tags).toEqual(context.tags)
  return capturedError
}

describe('route render failure capture tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isChunkLoadError).mockReturnValue(false)
    vi.mocked(handleChunkLoadError).mockReturnValue('ignored')
  })

  afterEach(() => {
    window.history.replaceState({}, '', initialLocation)
  })

  it('tags the app/error boundary capture with static route metadata', async () => {
    window.history.replaceState({}, '', PRIVATE_PATHS['app/error'])
    const error = syntheticInsertBefore()
    const reset = vi.fn()

    render(<RouteError error={error} reset={reset} />)

    await waitFor(() => expect(captureSentryException).toHaveBeenCalledTimes(1))
    expect(
      expectSafeTags({
        component: 'app-error',
        operation: 'browser.render.wars',
        error_code: 'DOM_INSERT_TARGET_MISSING'
      })
    ).toBe(error)

    fireEvent.click(screen.getByRole('button', { name: /rite of repair/i }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText('++ Cogitator fault ++ The Machine Spirit faltered.')
    ).toBeInTheDocument()
  })

  it('tags the app/global-error boundary capture with static route metadata', async () => {
    window.history.replaceState({}, '', PRIVATE_PATHS['app/global-error'])
    const error = syntheticInsertBefore()
    const reset = vi.fn()

    render(<GlobalError error={error} reset={reset} />)

    await waitFor(() => expect(captureSentryException).toHaveBeenCalledTimes(1))
    expect(
      expectSafeTags({
        component: 'app-global-error',
        operation: 'browser.render.guild',
        error_code: 'DOM_INSERT_TARGET_MISSING'
      })
    ).toBe(error)

    expect(
      screen.getByText(
        '++ Machine Spirit displeased ++ A grave fault has occurred.'
      )
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /rite of repair/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('tags the boss-assignments boundary capture with static route metadata', async () => {
    window.history.replaceState({}, '', PRIVATE_PATHS['boss-assignments/error'])
    const error = syntheticRemoveChild()
    const reset = vi.fn()

    render(<BossAssignmentsError error={error} reset={reset} />)

    await waitFor(() => expect(captureSentryException).toHaveBeenCalledTimes(1))
    expect(
      expectSafeTags({
        component: 'boss-assignments-error',
        operation: 'browser.render.boss',
        error_code: 'DOM_REMOVE_TARGET_MISSING'
      })
    ).toBe(error)

    expect(screen.getByText('Assignments unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('leaves global-error chunk reload suppression without a capture', () => {
    window.history.replaceState({}, '', PRIVATE_PATHS['app/global-error'])
    vi.mocked(isChunkLoadError).mockReturnValue(true)
    vi.mocked(handleChunkLoadError).mockReturnValue('attempted')

    const { container } = render(
      <GlobalError
        error={Object.assign(new Error('Loading chunk 9 failed'), {
          name: 'ChunkLoadError'
        })}
        reset={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
    expect(captureSentryException).not.toHaveBeenCalled()
  })
})
