/**
 * @vitest-environment happy-dom
 * Toast theming: component tests mock useToast, so voice-wrapping is asserted only here.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ToastProvider, useToast, useToastContext } from '@/app/hooks/useToast'

function setup() {
  return renderHook(() => ({ api: useToast(), ctx: useToastContext() }), {
    wrapper: ToastProvider
  })
}

const last = (r: ReturnType<typeof setup>['result']) =>
  r.current.ctx.toasts[r.current.ctx.toasts.length - 1]

describe('useToast Mechanicus theming', () => {
  it('themes an error toast description, preserving the literal message', () => {
    const { result } = setup()
    act(() =>
      result.current.api.toast.error(
        'Save failed',
        'Could not save settings',
        0
      )
    )
    const toast = last(result)
    expect(toast?.type).toBe('error')
    expect(toast?.title).toBe('Save failed') // title untouched when a body exists
    expect(toast?.description).toMatch(/^\+\+ .+ \+\+ Could not save settings$/)
    expect(toast?.description).toContain('Could not save settings')
  })

  it('themes a warning toast description', () => {
    const { result } = setup()
    act(() =>
      result.current.api.toast.warning('Heads up', 'Invalid thresholds', 0)
    )
    expect(last(result)?.description).toMatch(
      /^\+\+ .+ \+\+ Invalid thresholds$/
    )
  })

  it('themes the TITLE when an error toast has no description', () => {
    const { result } = setup()
    act(() =>
      result.current.api.toast.error('Profile setup required', undefined, 0)
    )
    const toast = last(result)
    expect(toast?.title).toMatch(/^\+\+ .+ \+\+ Profile setup required$/)
    expect(toast?.description).toBeUndefined()
  })

  it('does NOT theme success or info toasts', () => {
    const { result } = setup()
    act(() => result.current.api.toast.success('Done', 'Saved cleanly', 0))
    expect(last(result)?.description).toBe('Saved cleanly')
    act(() => result.current.api.toast.info('Note', 'For your information', 0))
    expect(last(result)?.description).toBe('For your information')
  })
})
