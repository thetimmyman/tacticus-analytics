import { beforeEach, describe, expect, it } from 'vitest'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import { getContrastRatio, getCtaGradient } from '@/app/lib/utils/contrast'

const root = () => document.documentElement

function mix(from: string, to: string, t: number): string {
  const n = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const c = (i: number) =>
    Math.round(n(from, i) + (n(to, i) - n(from, i)) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${c(0)}${c(1)}${c(2)}`
}

/** Lowest contrast the label has anywhere along the painted gradient. */
function lowestAlong(label: string, from: string, to: string): number {
  let lowest = Infinity
  for (let i = 0; i <= 100; i++) {
    lowest = Math.min(lowest, getContrastRatio(label, mix(from, to, i / 100)))
  }
  return lowest
}

describe('label on a primary-to-accent gradient call-to-action', () => {
  beforeEach(() => root().removeAttribute('style'))

  it.each(Object.entries(allThemes))(
    '%s: the label reads on every colour between the stops',
    (_code, theme) => {
      applyThemeToCSS(theme)
      const style = root().style
      const from = style.getPropertyValue('--cta-from')
      const to = style.getPropertyValue('--cta-to')
      const label = style.getPropertyValue('--on-cta')
      const accent = theme.semanticOverrides?.accent ?? theme.accent

      // One of the theme's own colours is kept exactly; only the other moves.
      expect(from === theme.primary || to === accent).toBe(true)
      expect(lowestAlong(label, from, to)).toBeGreaterThanOrEqual(4.5)
    }
  )

  it('keeps both theme colours when one label already reads on both', () => {
    const cta = getCtaGradient('#60a5fa', '#93c5fd')
    expect(cta).toEqual({ from: '#60a5fa', to: '#93c5fd', label: '#000000' })
  })

  it('moves the colour that has to change least: red-to-gold stays red-to-gold', () => {
    // White does not read on gold, and black misses 4.5:1 on this red by a
    // hair, so the red is lightened slightly and the gold is left alone.
    const cta = getCtaGradient('#dc2626', '#fbbf24')
    expect(cta.label).toBe('#000000')
    expect(cta.to).toBe('#fbbf24')
    expect(cta.from).not.toBe('#dc2626')
    expect(getContrastRatio('#dc2626', cta.from)).toBeLessThan(1.2)
  })

  it('pulls the other colour only as far as the label needs, not to a flat button', () => {
    const cta = getCtaGradient('#1e3a8a', '#fbbf24')
    expect(cta.from === '#1e3a8a' || cta.to === '#fbbf24').toBe(true)
    expect(cta.from).not.toBe(cta.to)
    expect(lowestAlong(cta.label, cta.from, cta.to)).toBeGreaterThanOrEqual(4.5)
  })

  it('is a flat button when the two colours are the same', () => {
    expect(getCtaGradient('#1d4ed8', '#1d4ed8')).toEqual({
      from: '#1d4ed8',
      to: '#1d4ed8',
      label: '#ffffff'
    })
  })

  it('still reads for opposite colours', () => {
    const cta = getCtaGradient('#000000', '#ffffff')
    expect(lowestAlong(cta.label, cta.from, cta.to)).toBeGreaterThanOrEqual(4.5)
  })

  it('follows the accent that is painted when a theme overrides it', () => {
    applyThemeToCSS({
      ...allThemes.dark!,
      primary: '#111111',
      accent: '#222222',
      semanticOverrides: { accent: '#f5f5f5' }
    })
    const style = root().style
    expect(style.getPropertyValue('--accent')).toBe('#f5f5f5')
    expect(
      lowestAlong(
        style.getPropertyValue('--on-cta'),
        style.getPropertyValue('--cta-from'),
        style.getPropertyValue('--cta-to')
      )
    ).toBeGreaterThanOrEqual(4.5)
  })
})
