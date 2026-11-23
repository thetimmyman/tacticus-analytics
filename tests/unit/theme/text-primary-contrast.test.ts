import { beforeEach, describe, expect, it } from 'vitest'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import { getContrastRatio } from '@/app/lib/utils/contrast'

const AA_NORMAL_TEXT = 4.5
const root = () => document.documentElement

function parseColor(value: string): [number, number, number, number] {
  const trimmed = value.trim()
  const hex = /^#([0-9a-f]{6})$/iu.exec(trimmed)
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgb = /^rgba?\(([^)]+)\)$/iu.exec(trimmed)
  if (!rgb) {
    throw new Error(`Unparseable color: ${value}`)
  }
  const [r = 0, g = 0, b = 0, a = 1] = rgb[1]!.split(',').map(Number)
  return [r, g, b, a]
}

function compositeOver(top: string, below: string): string {
  const [r, g, b, a] = parseColor(top)
  const [br, bg, bb] = parseColor(below)
  const channel = (fg: number, bgVal: number) =>
    Math.round(fg * a + bgVal * (1 - a))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r, br)}${channel(g, bg)}${channel(b, bb)}`
}

describe('theme --text-primary WCAG AA contrast guard', () => {
  beforeEach(() => root().removeAttribute('style'))

  it('covers all themes in the catalog', () => {
    expect(Object.keys(allThemes).length).toBeGreaterThanOrEqual(62)
  })

  it.each(Object.entries(allThemes))(
    '%s: --text-primary clears >= 4.5:1 against page backgrounds and composited card surfaces',
    (code, theme) => {
      applyThemeToCSS(theme)
      const style = root().style
      const textPrimary = style.getPropertyValue('--text-primary').trim()
      const bgPrimary = style.getPropertyValue('--bg-primary').trim()
      const bgVia = style.getPropertyValue('--bg-via').trim() || bgPrimary
      const bgTo = style.getPropertyValue('--bg-to').trim() || bgPrimary
      const cardBg = style.getPropertyValue('--card-bg').trim()
      const bgSecondary = style.getPropertyValue('--bg-secondary').trim()

      expect(textPrimary, `${code} --text-primary`).toMatch(
        /^#[0-9a-fA-F]{6}$/u
      )
      expect(bgSecondary, `${code} --bg-secondary matches --card-bg`).toBe(
        cardBg
      )

      const surfaces: Array<[string, string]> = [
        ['--bg-primary', bgPrimary],
        ['--bg-via', bgVia],
        ['--bg-to', bgTo],
        ['--card-bg over --bg-primary', compositeOver(cardBg, bgPrimary)],
        ['--card-bg over --bg-via', compositeOver(cardBg, bgVia)],
        ['--card-bg over --bg-to', compositeOver(cardBg, bgTo)]
      ]

      for (const [label, surface] of surfaces) {
        const ratio = getContrastRatio(textPrimary, surface)
        expect(
          ratio,
          `${code}: ${textPrimary} on ${label} (${surface}) = ${ratio.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
      }
    }
  )
})
