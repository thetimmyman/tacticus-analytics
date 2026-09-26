import { fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StickyPlayerHeader } from '@/app/components/playerstats/StickyPlayerHeader'

// Captured so tests fail if the component stops observing the sentinel or disconnecting.
let observerCallback: IntersectionObserverCallback | null = null
const observed: Element[] = []
const disconnectSpy = vi.fn()

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback
  }
  observe(target: Element) {
    observed.push(target)
  }
  disconnect = disconnectSpy
  unobserve() {}
  takeRecords() {
    return []
  }
  root = null
  rootMargin = ''
  thresholds = []
}

const emit = (entries: Array<{ isIntersecting: boolean }>) => {
  act(() => {
    observerCallback?.(
      entries as IntersectionObserverEntry[],
      {} as IntersectionObserver
    )
  })
}

describe('StickyPlayerHeader', () => {
  beforeEach(() => {
    observerCallback = null
    observed.length = 0
    disconnectSpy.mockClear()
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    document.querySelectorAll('[data-test-app-chrome]').forEach((node) => {
      node.remove()
    })
    vi.unstubAllGlobals()
  })

  const renderHeader = (onBackClick = vi.fn()) => {
    const view = render(
      <StickyPlayerHeader
        playerName="TestPlayerA"
        guildName="[TG] Test Guild"
        season="106"
        showBackButton
        onBackClick={onBackClick}
      />
    )
    return { onBackClick, view }
  }

  it('floats at every viewport with responsive first-paint offsets', () => {
    renderHeader()

    const header = screen.getByTestId('selected-player-header')
    expect(header).toHaveClass('sticky', 'top-12', 'lg:top-[88px]', 'z-40')
    expect(header.style.top).toBe('')
    expect(screen.getByText('TestPlayerA')).toBeInTheDocument()
    expect(screen.getByText('[TG] Test Guild')).toBeInTheDocument()
    expect(screen.getByText('Season 106')).toBeInTheDocument()
  })

  it('overrides the CSS fallback only after measuring visible app chrome', () => {
    const chrome = document.createElement('div')
    chrome.dataset.appChrome = ''
    chrome.dataset.testAppChrome = ''
    Object.defineProperty(chrome, 'offsetHeight', {
      configurable: true,
      value: 48
    })
    document.body.appendChild(chrome)

    renderHeader()

    expect(screen.getByTestId('selected-player-header')).toHaveStyle({
      top: '48px'
    })
  })

  it('observes the sentinel and disconnects on unmount', () => {
    const { view } = renderHeader()

    const header = screen.getByTestId('selected-player-header')
    expect(observed).toHaveLength(1)
    expect(observed[0]).toBe(header.previousElementSibling)

    view.unmount()
    expect(disconnectSpy).toHaveBeenCalled()
  })

  it('starts expanded and condenses once scrolled past the sentinel', () => {
    renderHeader()

    const header = screen.getByTestId('selected-player-header')
    expect(header).not.toHaveAttribute('data-condensed')
    expect(screen.getByText('Selected Player')).toBeInTheDocument()

    emit([{ isIntersecting: false }])
    expect(header).toHaveAttribute('data-condensed', 'true')
    expect(screen.queryByText('Selected Player')).not.toBeInTheDocument()
    expect(screen.getByText('TestPlayerA')).toBeInTheDocument()

    emit([{ isIntersecting: true }])
    expect(header).not.toHaveAttribute('data-condensed')
    expect(screen.getByText('Selected Player')).toBeInTheDocument()
  })

  it('uses the newest entry of a coalesced batch and survives an empty batch', () => {
    renderHeader()
    const header = screen.getByTestId('selected-player-header')

    emit([{ isIntersecting: false }, { isIntersecting: true }])
    expect(header).not.toHaveAttribute('data-condensed')

    emit([{ isIntersecting: false }])
    expect(header).toHaveAttribute('data-condensed', 'true')

    emit([])
    expect(header).toHaveAttribute('data-condensed', 'true')
  })

  it('keeps the back button working in both forms', () => {
    const { onBackClick } = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Back to My Stats' }))
    emit([{ isIntersecting: false }])
    fireEvent.click(screen.getByRole('button', { name: 'Back to My Stats' }))

    expect(onBackClick).toHaveBeenCalledTimes(2)
  })
})
