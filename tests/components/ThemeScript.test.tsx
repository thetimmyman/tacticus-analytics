import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ThemeScript } from '@/app/components/ThemeScript'
import { applyThemeToCSS, getGuildTheme } from '@/app/lib/theme-system'
import { getHighContrastText } from '@/app/lib/utils/contrast'

/** Runs the inline pre-hydration script the way the browser would. */
function runThemeScript(): void {
  const { container } = render(<ThemeScript nonce="test-nonce" />)
  const content = container.querySelector('script')?.textContent ?? ''
  new Function(content)()
}

function resetRoot(): void {
  const root = document.documentElement
  root.removeAttribute('style')
  root.removeAttribute('data-theme')
  root.className = ''
  window.localStorage.clear()
}

function rootVars(): Record<string, string> {
  const style = document.documentElement.style
  const vars: Record<string, string> = {}
  for (let i = 0; i < style.length; i++) {
    const name = style.item(i)
    if (name.startsWith('--')) {
      vars[name] = style.getPropertyValue(name).trim()
    }
  }
  return vars
}

describe('ThemeScript', () => {
  beforeEach(resetRoot)
  afterEach(resetRoot)

  it('renders inline theme script with nonce and expected markers', () => {
    const { container } = render(<ThemeScript nonce="test-nonce" />)
    const script = container.querySelector('script')
    expect(script).toBeInTheDocument()
    expect(script).toHaveAttribute('nonce', 'test-nonce')

    const content = script?.textContent || ''
    expect(content).toContain('theme-override')
    expect(content).toContain('data-theme')
    expect(content).toContain('theme-loading')
    expect(content).toContain('HORUS_HERESY')
  })

  describe('first paint before hydration', () => {
    it('paints the dark theme when nothing is stored', () => {
      runThemeScript()
      const root = document.documentElement
      expect(root.getAttribute('data-theme')).toBe('dark')
      expect(root.style.getPropertyValue('--bg-from')).toBe('#0f172a')
    })

    it('paints Light Mode when the app has stored it (JSON-quoted)', () => {
      // useLocalStorage writes JSON, so the stored text is "light" with quotes.
      window.localStorage.setItem('theme-override', JSON.stringify('light'))
      runThemeScript()

      const root = document.documentElement
      expect(root.getAttribute('data-theme')).toBe('light')
      expect(root.style.getPropertyValue('--bg-from')).toBe('#ffffff')
      expect(root.style.getPropertyValue('--text-primary')).toBe('#0f172a')
    })

    it.each(['dark', 'light', 'HORUS_HERESY'])(
      'paints the label colour for every filled control before React runs (%s)',
      (code) => {
        // Fixed white on the default blue is 2.54:1; Light Mode's blue needs white.
        window.localStorage.setItem('theme-override', JSON.stringify(code))
        runThemeScript()

        const theme = getGuildTheme(code)
        const style = document.documentElement.style
        expect(style.getPropertyValue('--on-primary')).toBe(
          getHighContrastText(theme.primary)
        )
        expect(style.getPropertyValue('--on-secondary')).toBe(
          getHighContrastText(theme.secondary)
        )
        expect(style.getPropertyValue('--on-accent')).toBe(
          getHighContrastText(theme.semanticOverrides?.accent ?? theme.accent)
        )
      }
    )

    it('paints white labels on Light Mode and black on the default blue', () => {
      runThemeScript()
      expect(
        document.documentElement.style.getPropertyValue('--on-primary')
      ).toBe('#000000')

      resetRoot()
      window.localStorage.setItem('theme-override', JSON.stringify('light'))
      runThemeScript()
      expect(
        document.documentElement.style.getPropertyValue('--on-primary')
      ).toBe('#ffffff')
    })

    it('still understands an older unquoted stored value', () => {
      window.localStorage.setItem('theme-override', 'light')
      runThemeScript()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })

    it('paints a stored special theme instead of the dark fallback', () => {
      window.localStorage.setItem(
        'theme-override',
        JSON.stringify('HORUS_HERESY')
      )
      runThemeScript()
      const root = document.documentElement
      expect(root.getAttribute('data-theme')).toBe('HORUS_HERESY')
      expect(root.style.getPropertyValue('--bg-from')).toBe('#1a0000')
    })

    it('keeps a stored theme with no pre-paint entry on the dark base and its own data-theme', () => {
      window.localStorage.setItem('theme-override', JSON.stringify('NO_SUCH'))
      runThemeScript()
      const root = document.documentElement
      expect(root.getAttribute('data-theme')).toBe('NO_SUCH')
      expect(root.style.getPropertyValue('--bg-from')).toBe('#0f172a')
    })

    it('does not resolve inherited object keys as themes', () => {
      window.localStorage.setItem(
        'theme-override',
        JSON.stringify('constructor')
      )
      runThemeScript()
      expect(document.documentElement.style.getPropertyValue('--bg-from')).toBe(
        '#0f172a'
      )
    })

    it('never leaves quote characters in the data-theme attribute', () => {
      for (const stored of [
        JSON.stringify('light'),
        JSON.stringify('dark'),
        '"',
        '{broken',
        'null',
        '42'
      ]) {
        resetRoot()
        window.localStorage.setItem('theme-override', stored)
        runThemeScript()
        expect(document.documentElement.getAttribute('data-theme')).not.toMatch(
          /["{}]/
        )
      }
    })

    it('does not throw when localStorage is unavailable', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('blocked')
        }
      })
      try {
        expect(() => runThemeScript()).not.toThrow()
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      } finally {
        if (original) Object.defineProperty(window, 'localStorage', original)
      }
    })

    it.each(['dark', 'light', 'HORUS_HERESY'])(
      'agrees with applyThemeToCSS for %s, so hydration does not shift colours',
      (code) => {
        window.localStorage.setItem('theme-override', JSON.stringify(code))
        runThemeScript()
        const prePaint = rootVars()
        expect(Object.keys(prePaint).length).toBeGreaterThan(5)

        resetRoot()
        applyThemeToCSS(getGuildTheme(code))
        const hydrated = rootVars()

        for (const [name, value] of Object.entries(prePaint)) {
          expect(hydrated[name], `${code} ${name}`).toBe(value)
        }
      }
    )
  })
})
