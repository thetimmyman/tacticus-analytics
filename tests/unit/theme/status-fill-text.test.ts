import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import {
  getContrastRatio,
  getHoverFill,
  getOnFillVariables,
  getStatusFillVariables
} from '@/app/lib/utils/contrast'

const root = () => document.documentElement
const read = (name: string) => root().style.getPropertyValue(name)

/** Largest per-channel change (of 255) between two hex colours. */
function channelDelta(a: string, b: string): number {
  const n = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return Math.max(...[0, 1, 2].map((i) => Math.abs(n(a, i) - n(b, i))))
}

/**
 * Hover must move the fill by an amount a person can see (per channel and in
 * luminance, compared case-insensitively: '#FFFFFF' and '#ffffff' are the same
 * fill) and keep the label at 4.5:1. It stays at or above min(rest, 6):1.
 */
function expectVisibleHover(fill: string, hover: string, label: string) {
  const rest = getContrastRatio(label, fill)
  const hovered = getContrastRatio(label, hover)
  expect(channelDelta(fill, hover)).toBeGreaterThanOrEqual(16)
  expect(getContrastRatio(fill, hover)).toBeGreaterThanOrEqual(1.15)
  expect(hovered).toBeGreaterThanOrEqual(4.5)
  expect(hovered).toBeGreaterThanOrEqual(Math.min(rest, 6))
}

describe('label and hover colour on filled danger and warning controls', () => {
  beforeEach(() => root().removeAttribute('style'))

  it.each(Object.entries(allThemes))(
    '%s: the label reads on the painted fill, at rest and on hover',
    (_code, theme) => {
      applyThemeToCSS(theme)

      for (const status of ['danger', 'warning'] as const) {
        const fill = read(`--${status}`)
        const label = read(`--on-${status}`)

        expect(getContrastRatio(label, fill)).toBeGreaterThanOrEqual(4.5)
        expectVisibleHover(fill, read(`--${status}-fill-hover`), label)
      }
    }
  )

  it.each(Object.entries(allThemes))(
    '%s: the accent fill has a visible hover step that keeps its label above 4.5:1',
    (_code, theme) => {
      applyThemeToCSS(theme)

      expectVisibleHover(
        read('--accent'),
        read('--accent-fill-hover'),
        read('--on-accent')
      )
    }
  )

  it('darkens a fill that cannot get lighter, and stays readable', () => {
    // A white accent under a black label has no room to get lighter.
    const vars = getOnFillVariables({
      primary: '#111111',
      secondary: '#222222',
      accent: '#ffffff'
    })

    expect(vars['--on-accent']).toBe('#000000')
    expect(vars['--accent-fill-hover']).not.toBe('#ffffff')
    expect(
      getContrastRatio('#000000', vars['--accent-fill-hover']!)
    ).toBeGreaterThan(4.5)
  })

  it('follows the colour a theme paints, not one fixed pair', () => {
    // Light Mode paints a dark red and amber; the dark themes paint light ones.
    const light = getStatusFillVariables({
      danger: '#b91c1c',
      warning: '#a16207'
    })
    const dark = getStatusFillVariables({
      danger: '#ff6b6b',
      warning: '#fbbf24'
    })

    expect(light['--on-danger']).toBe('#ffffff')
    expect(light['--on-warning']).toBe('#ffffff')
    expect(dark['--on-danger']).toBe('#000000')
    expect(dark['--on-warning']).toBe('#000000')
  })

  it('uses the warning colour the Light theme paints, not the dark default', () => {
    applyThemeToCSS(allThemes.light!)

    expect(read('--warning')).toBe('#a16207')
    expect(read('--on-warning')).toBe('#ffffff')
  })

  it('derives label and hover from the warning a light theme paints when it has no override', () => {
    // Light Mode defines its own warning, so only a synthetic light theme
    // reaches the built-in light fallback.
    applyThemeToCSS({ ...allThemes.light!, semanticOverrides: undefined })

    expect(read('--warning')).toBe('#ca8a04')
    expect(read('--warning-fill-hover')).toBe(
      getHoverFill('#ca8a04', read('--on-warning'))
    )
    expect(read('--danger-fill-hover')).toBe(
      getHoverFill(read('--danger'), read('--on-danger'))
    )
  })

  it('does not widen the first-paint or public wrapper variables', () => {
    // Only the signed-in runtime paints status fills; the pre-hydration paths
    // keep their existing token set.
    const keys = Object.keys(
      getOnFillVariables({
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333'
      })
    )

    expect(keys).not.toContain('--on-danger')
    expect(keys).not.toContain('--on-warning')
  })

  it('has stylesheet defaults equal to what the dark theme computes', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const rootBlock = css.slice(css.indexOf(':root {'))
    const computed = {
      ...getStatusFillVariables({ danger: '#ff6b6b', warning: '#fbbf24' }),
      ...getOnFillVariables({
        primary: '#60a5fa',
        secondary: '#3b82f6',
        accent: '#93c5fd'
      })
    }

    for (const name of [
      '--on-danger',
      '--on-warning',
      '--danger-fill-hover',
      '--warning-fill-hover',
      '--accent-fill-hover'
    ]) {
      const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(rootBlock)
      expect(match, `${name} has a :root default`).not.toBeNull()
      expect(match![1]!.toLowerCase()).toBe(computed[name]!.toLowerCase())
    }
  })
})
