import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { PublicThemeProvider } from '@/app/components/PublicThemeProvider'

function resetRoot(): void {
  const root = document.documentElement
  root.removeAttribute('style')
  root.removeAttribute('data-theme')
  window.localStorage.clear()
}

describe('PublicThemeProvider', () => {
  beforeEach(resetRoot)
  afterEach(resetRoot)

  it('server markup sets no theme variables, so the first frame inherits the pre-hydration theme from <html>', () => {
    // The wrapper used to emit a black and orange fallback here, which
    // overrode the variables the inline script put on <html> for the stored
    // theme: a Light Mode visitor got a white page with white text, and
    // every visitor saw an orange flash before the real theme arrived.
    const html = renderToString(
      <PublicThemeProvider>
        <p>content</p>
      </PublicThemeProvider>
    )

    expect(html).toContain('content')
    expect(html).not.toContain('--text-primary')
    expect(html).not.toContain('--accent')
    expect(html).not.toContain('--bg-from')
  })

  it('applies the stored theme to the wrapper once it has loaded', async () => {
    window.localStorage.setItem('theme-override', JSON.stringify('light'))
    const { container } = render(
      <PublicThemeProvider>
        <p>content</p>
      </PublicThemeProvider>
    )

    const wrapper = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(wrapper.style.getPropertyValue('--bg-from')).toBe('#ffffff')
    })
    expect(wrapper.style.getPropertyValue('--text-primary')).toBe('#0f172a')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('re-declares the label colours with the fills, so buttons stay readable on the wrapper', async () => {
    // The wrapper's --primary/--accent shadow the ones on <html>; labels that
    // inherited html's would sit on the wrong fill.
    window.localStorage.setItem('theme-override', JSON.stringify('light'))
    const { container } = render(
      <PublicThemeProvider>
        <p>content</p>
      </PublicThemeProvider>
    )

    const wrapper = container.firstElementChild as HTMLElement
    await waitFor(() => {
      expect(wrapper.style.getPropertyValue('--primary')).toBe('#1d4ed8')
    })
    expect(wrapper.style.getPropertyValue('--on-primary')).toBe('#ffffff')
    expect(wrapper.style.getPropertyValue('--on-accent')).toBe('#ffffff')
    // Gradient call-to-actions: Light Mode's blue pair keeps both stops.
    expect(wrapper.style.getPropertyValue('--cta-from')).toBe('#1d4ed8')
    expect(wrapper.style.getPropertyValue('--cta-to')).not.toBe('')
    expect(wrapper.style.getPropertyValue('--on-cta')).toBe('#ffffff')
  })
})
