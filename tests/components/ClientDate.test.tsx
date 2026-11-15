import { act, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const subscribeRecords: Array<{
  notifiedDuringSubscribe: boolean
}> = []

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useSyncExternalStore: <Snapshot,>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => Snapshot,
      getServerSnapshot?: () => Snapshot
    ): Snapshot =>
      actual.useSyncExternalStore(
        (onStoreChange) => {
          let notifiedDuringSubscribe = false
          let inSubscribe = true
          const unsubscribe = subscribe(() => {
            if (inSubscribe) {
              notifiedDuringSubscribe = true
            }
            onStoreChange()
          })
          inSubscribe = false
          subscribeRecords.push({ notifiedDuringSubscribe })
          return unsubscribe
        },
        getSnapshot,
        getServerSnapshot
      )
  }
})

import { ClientDate } from '@tacticus/ui-kit/ClientDate'

describe('ClientDate', () => {
  beforeEach(() => {
    subscribeRecords.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not synchronously fire store change notifications inside subscribe on mount', () => {
    const sampleDate = new Date('2026-05-01T15:30:00.000Z')
    const { container } = render(
      <ClientDate date={sampleDate} className="synthetic-date" />
    )

    expect(subscribeRecords.length).toBeGreaterThan(0)
    expect(
      subscribeRecords.every((entry) => entry.notifiedDuringSubscribe === false)
    ).toBe(true)

    const span = container.querySelector('span.synthetic-date')
    expect(span).not.toBeNull()
    expect(span?.textContent?.trim().length).toBeGreaterThan(0)
    expect(span?.getAttribute('title')).toContain('2026')
  })

  it('renders a non-breaking space on the server and hydrates cleanly to the formatted client date', async () => {
    const sampleDate = '2026-05-01T15:30:00.000Z'
    const serverMarkup = renderToString(
      <ClientDate date={sampleDate} className="hydrated-date" title={false} />
    )
    expect(serverMarkup).toContain('hydrated-date')
    expect(serverMarkup).toContain('\u00a0')

    const host = document.createElement('div')
    host.innerHTML = serverMarkup
    document.body.appendChild(host)

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot> | null = null

    try {
      await act(async () => {
        root = hydrateRoot(
          host,
          <ClientDate
            date={sampleDate}
            className="hydrated-date"
            title={false}
          />
        )
      })

      expect(consoleError).not.toHaveBeenCalled()
      const span = host.querySelector('span.hydrated-date')
      expect(span).not.toBeNull()
      expect(span?.textContent).not.toBe('\u00a0')
      expect(span?.textContent).toContain('May')
      expect(span?.getAttribute('title')).toBeNull()
    } finally {
      await act(async () => {
        root?.unmount()
      })
      host.remove()
    }
  })
})
