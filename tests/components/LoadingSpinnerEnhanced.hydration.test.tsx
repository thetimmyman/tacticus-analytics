import { act } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'

describe('LoadingSpinner hydration', () => {
  let container: HTMLDivElement
  let root: Root | undefined

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hydrates deterministic sacred text then selects a random protocol after mount', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const element = <LoadingSpinner variant="sacred" message="Test loading" />
    container.innerHTML = renderToString(element)
    const serverPrimary = container.querySelector('p')?.textContent

    random.mockReturnValue(0.99)
    const onRecoverableError = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError })
    })

    expect(onRecoverableError).not.toHaveBeenCalled()
    expect(serverPrimary).toBe('⚙️ INITIATING SACRED PROTOCOL OMEGA-SEVEN')
    expect(container.querySelector('p')?.textContent).toBe(
      '⚡ AWAKENING THE BLESSED COGITATOR'
    )
  })

  it.each(['default', 'minimal', 'sacred', 'protocol'] as const)(
    'hydrates the %s variant without a mismatch when randomness differs',
    async (variant) => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(0)
      const element = <LoadingSpinner variant={variant} showBinary />
      container.innerHTML = renderToString(element)

      random.mockReturnValue(0.99)
      const onRecoverableError = vi.fn()
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError })
      })

      expect(onRecoverableError).not.toHaveBeenCalled()
    }
  )
})
