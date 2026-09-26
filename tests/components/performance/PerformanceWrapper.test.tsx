import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  DebouncedInput,
  OptimizedImage,
  batchedUpdates,
  withPerformanceMonitoring
} from '@/app/components/performance/PerformanceWrapper'
import { legacyConsoleLogger as logger } from '@tacticus/app-core/logger'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const getIdleWindow = () =>
  window as Window & { requestIdleCallback?: (cb: () => void) => void }

describe('PerformanceWrapper utilities', () => {
  it('debounces input changes', () => {
    vi.useFakeTimers()
    const handleChange = vi.fn()

    render(
      <DebouncedInput
        value=""
        onChange={handleChange}
        aria-label="Search input"
      />
    )

    fireEvent.change(screen.getByLabelText('Search input'), {
      target: { value: 'alpha' }
    })

    expect(handleChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(handleChange).toHaveBeenCalledWith('alpha')
    vi.useRealTimers()
  })

  it('syncs local input state when value prop changes', () => {
    const handleChange = vi.fn()
    const { rerender } = render(
      <DebouncedInput
        value="alpha"
        onChange={handleChange}
        aria-label="Search input"
      />
    )

    expect(
      (screen.getByLabelText('Search input') as HTMLInputElement).value
    ).toBe('alpha')

    rerender(
      <DebouncedInput
        value="beta"
        onChange={handleChange}
        aria-label="Search input"
      />
    )

    expect(
      (screen.getByLabelText('Search input') as HTMLInputElement).value
    ).toBe('beta')
  })

  it('sets eager loading when lazy is false', () => {
    render(<OptimizedImage src="/image.png" alt="Example" lazy={false} />)

    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('loading', 'eager')
    expect(image).toHaveAttribute('decoding', 'async')
  })

  it('uses requestIdleCallback when available', () => {
    const idleWindow = getIdleWindow()
    const original = idleWindow.requestIdleCallback
    const idleSpy = vi.fn((cb: () => void) => cb())
    const callback = vi.fn()

    idleWindow.requestIdleCallback = idleSpy
    batchedUpdates(callback)

    expect(idleSpy).toHaveBeenCalled()
    expect(callback).toHaveBeenCalled()

    if (original) {
      idleWindow.requestIdleCallback = original
    } else {
      delete idleWindow.requestIdleCallback
    }
  })

  it('falls back to setTimeout when requestIdleCallback is missing', () => {
    vi.useFakeTimers()
    const idleWindow = getIdleWindow()
    const original = idleWindow.requestIdleCallback
    const callback = vi.fn()

    delete idleWindow.requestIdleCallback
    batchedUpdates(callback)

    expect(callback).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(callback).toHaveBeenCalled()

    if (original) {
      idleWindow.requestIdleCallback = original
    }

    vi.useRealTimers()
  })

  it('avoids warnings for fast renders', () => {
    const Component = () => <div>Monitored</div>
    const Wrapped = withPerformanceMonitoring(Component, 'FastComponent')
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0)

    expect(Wrapped.displayName).toBe('withPerformanceMonitoring(FastComponent)')

    const { unmount } = render(<Wrapped />)
    unmount()

    expect(logger.warn).not.toHaveBeenCalled()
    nowSpy.mockRestore()
  })
})
