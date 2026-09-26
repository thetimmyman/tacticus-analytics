import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import LinkRequiredNudge from '@/app/components/auth/LinkRequiredNudge'

const highlightClasses = [
  'ring-2',
  'ring-red-500',
  'ring-offset-2',
  'ring-offset-[var(--bg-primary)]'
]

describe('LinkRequiredNudge', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('highlights the target element when active', () => {
    vi.useFakeTimers()
    const scrollIntoViewMock = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoViewMock,
      configurable: true
    })

    const target = document.createElement('div')
    target.id = 'connected-accounts'
    document.body.appendChild(target)

    render(<LinkRequiredNudge active />)

    highlightClasses.forEach((cls) => {
      expect(target).toHaveClass(cls)
    })
    expect(scrollIntoViewMock).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start'
    })

    act(() => {
      vi.advanceTimersByTime(1800)
    })

    highlightClasses.forEach((cls) => {
      expect(target).not.toHaveClass(cls)
    })
  })

  it('does nothing when inactive', () => {
    const scrollIntoViewMock = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: scrollIntoViewMock,
      configurable: true
    })

    const target = document.createElement('div')
    target.id = 'connected-accounts'
    document.body.appendChild(target)

    render(<LinkRequiredNudge active={false} />)

    highlightClasses.forEach((cls) => {
      expect(target).not.toHaveClass(cls)
    })
    expect(scrollIntoViewMock).not.toHaveBeenCalled()
  })
})
