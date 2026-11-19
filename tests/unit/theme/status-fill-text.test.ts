import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import {
  getContrastRatio,
  getOnFillVariables,
  getStatusFillVariables
} from '@/app/lib/utils/contrast'

const root = () => document.documentElement
const read = (name: string) => root().style.getPropertyValue(name)

describe('label and hover colour on filled danger and warning controls', () => {
  beforeEach(() => root().removeAttribute('style'))

  it.each(Object.entries(allThemes))(
    '%s: the label reads on the painted fill, at rest and on hover',
    (_code, theme) => {
      applyThemeToCSS(theme)

      for (const status of ['danger', 'warning'] as const) {
        const fill = read(`--${status}`)
        const label = read(`--on-${status}`)
        const hover = read(`--${status}-fill-hover`)
        const rest = getContrastRatio(label, fill)

        expect(rest).toBeGreaterThanOrEqual(4.5)
        expect(hover).not.toBe(fill)
        // Hover moves away from the label colour, so it is never the weaker state.
        expect(getContrastRatio(label, hover)).toBeGreaterThanOrEqual(rest)
      }
    }
  )

  it.each(Object.entries(allThemes))(
    '%s: the accent fill has a hover step that keeps its label above 4.5:1',
    (_code, theme) => {
      applyThemeToCSS(theme)
      const rest = getContrastRatio(read('--on-accent'), read('--accent'))
      const hover = getContrastRatio(
        read('--on-accent'),
        read('--accent-fill-hover')
      )

      expect(read('--accent-fill-hover')).not.toBe(read('--accent'))
      expect(hover).toBeGreaterThanOrEqual(rest)
      expect(hover).toBeGreaterThanOrEqual(4.5)
    }
  )

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
