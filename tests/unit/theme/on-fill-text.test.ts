import { beforeEach, describe, expect, it } from 'vitest'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import { getContrastRatio, getOnFillVariables } from '@/app/lib/utils/contrast'

const root = () => document.documentElement

describe('label colour on filled primary, secondary and accent controls', () => {
  beforeEach(() => root().removeAttribute('style'))

  it.each(Object.entries(allThemes))(
    '%s: every fill carries a label that reaches 4.5:1',
    (_code, theme) => {
      applyThemeToCSS(theme)
      const style = root().style
      const accent = theme.semanticOverrides?.accent ?? theme.accent

      expect(
        getContrastRatio(style.getPropertyValue('--on-primary'), theme.primary)
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        getContrastRatio(
          style.getPropertyValue('--on-secondary'),
          theme.secondary
        )
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        getContrastRatio(style.getPropertyValue('--on-accent'), accent)
      ).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('follows the fill instead of one fixed colour', () => {
    // Fixed white fails on the default blue (2.54:1), fixed black fails on
    // the Light Mode blue (3.13:1); each fill gets the colour that reads.
    const vars = getOnFillVariables({
      primary: '#60a5fa',
      secondary: '#1d4ed8',
      accent: '#1f2937'
    })
    expect(vars['--on-primary']).toBe('#000000')
    expect(vars['--on-secondary']).toBe('#ffffff')
    expect(vars['--on-accent']).toBe('#ffffff')
  })

  it('uses the accent that is actually painted when a theme overrides it', () => {
    applyThemeToCSS({
      ...allThemes.dark!,
      accent: '#111111',
      semanticOverrides: { accent: '#fde68a' }
    })
    expect(root().style.getPropertyValue('--accent')).toBe('#fde68a')
    expect(root().style.getPropertyValue('--on-accent')).toBe('#000000')
  })
})
