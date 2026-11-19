import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UpgradePathMetro } from '@/app/(dashboard)/meta-atlas/components/UpgradePathMetro'
import { METRO_FIXTURE_PROPS } from '@/app/components/ui/upgrade-path-metro.fixture'
import { getContrastRatio } from '@/app/lib/utils/contrast'

/**
 * Both Personal Potential panels paint their own dark surface on every theme.
 * They need one `scheme-dark` scope plus an opaque base (the status palette
 * follows the nearest color-scheme, and the translucent gradient lets a light
 * page through), and every label inside must use a palette colour: a theme
 * token resolves for the page theme and lands dark-on-black on Light Mode.
 * Real contrast is measured in the browser fixture; this guards the structure
 * and models each text colour against the lightest surface of the panel.
 */

const themeCss = readFileSync(
  createRequire(import.meta.url).resolve('tailwindcss/theme.css'),
  'utf8'
)

type Rgb = [number, number, number]

function palette(name: string): Rgb {
  if (name === 'white') return [255, 255, 255]
  if (name === 'black') return [0, 0, 0]
  const match = new RegExp(`--color-${name}:\\s*oklch\\(([^)]+)\\)`, 'u').exec(
    themeCss
  )
  if (!match?.[1]) throw new Error(`no palette entry ${name}`)
  const [l = '', c = '', h = ''] = match[1].split(/\s+/u)
  const lightness = l.endsWith('%') ? parseFloat(l) / 100 : parseFloat(l)
  const hue = (parseFloat(h) * Math.PI) / 180
  const a = parseFloat(c) * Math.cos(hue)
  const b = parseFloat(c) * Math.sin(hue)
  const l3 = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3
  ]
  const encode = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v))
    const encoded =
      clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * clamped ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255)
  }
  return [encode(linear[0]!), encode(linear[1]!), encode(linear[2]!)]
}

const hex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

const mix = (fg: Rgb, bg: Rgb, alpha: number): Rgb => [
  Math.round(alpha * fg[0] + (1 - alpha) * bg[0]),
  Math.round(alpha * fg[1] + (1 - alpha) * bg[1]),
  Math.round(alpha * fg[2] + (1 - alpha) * bg[2])
]

// The lightest pixel any label can sit on: the middle gradient stop at full
// strength, before the translucent tints and the darker black base lower it.
const LIGHTEST_SURFACE = palette('slate-900')

const COLOUR_TOKEN = /^text-(white|black|[a-z]+-\d+)(?:\/(\d+))?$/u
const THEME_TOKEN =
  /(?:-wh40k$|\(--|\[var\(--|\[color-mix|^(?:[a-z-]+:)*(?:bg|border|text)-(?:card|text-))/u

/** Contrast of one `text-*` class against the lightest panel surface. */
function contrastOf(token: string, dim = 1): number | null {
  const match = COLOUR_TOKEN.exec(token)
  if (!match) return null
  const alpha = (match[2] ? Number(match[2]) / 100 : 1) * dim
  const ink = mix(palette(match[1]!), LIGHTEST_SURFACE, alpha)
  return getContrastRatio(hex(ink), hex(LIGHTEST_SURFACE))
}

const tokensOf = (el: Element) =>
  (el.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean)

// Only the active card shows its availability pill and requirement, so every
// card has to be active once for the checks to see all of them.
const ACTIVE_INDEXES = [0, 1, 2, 3]

function renderPanels(defaultActiveIndex = 1) {
  const { container } = render(
    <UpgradePathMetro
      {...METRO_FIXTURE_PROPS}
      defaultActiveIndex={defaultActiveIndex}
    />
  )
  // Found by structure, not by the class under test: a panel that loses its
  // scope must fail the checks below, not drop out of them.
  const root = container.firstElementChild
  const panels = [...(root?.children ?? [])].map((layout) => {
    const panel = layout.firstElementChild
    if (!panel) throw new Error('layout without a panel')
    return panel
  })
  expect(panels).toHaveLength(2)
  return { container, panels }
}

const hasOwnText = (el: Element) =>
  [...el.childNodes].some(
    (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''
  )

function colourOf(el: Element, panel: Element): string | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const token = tokensOf(node).find((t) => COLOUR_TOKEN.test(t))
    if (token) return token
    if (node === panel) break
  }
  return null
}

describe('Personal Potential panels: a dark island on every page theme', () => {
  it('both layouts (phone and desktop) are scheme-dark with an opaque black base', () => {
    const { container, panels } = renderPanels()
    expect([...container.querySelectorAll('.scheme-dark')]).toEqual(panels)
    expect(panels[0]?.parentElement?.className).toContain('sm:hidden')
    expect(panels[1]?.parentElement?.className).toContain('sm:block')
    for (const panel of panels) {
      expect(tokensOf(panel)).toContain('scheme-dark')
      expect(tokensOf(panel)).toContain('bg-black')
    }
  })

  it('every label and badge sits inside one of the two dark panels', () => {
    const { container, panels } = renderPanels()
    const labelled = [...container.querySelectorAll('*')].filter(hasOwnText)
    expect(labelled.length).toBeGreaterThan(40)
    for (const el of labelled) {
      expect(
        panels.some((p) => p.contains(el)),
        el.outerHTML
      ).toBe(true)
    }
  })

  it.each(ACTIVE_INDEXES)(
    'no class inside a panel takes a theme token (active card %i)',
    (active) => {
      const { panels } = renderPanels(active)
      for (const panel of panels) {
        const offenders = [panel, ...panel.querySelectorAll('*')].flatMap(
          (el) => tokensOf(el).filter((t) => THEME_TOKEN.test(t))
        )
        expect(offenders).toEqual([])
      }
    }
  )

  it.each(ACTIVE_INDEXES)(
    'every label has a palette colour that reads on the lightest surface (active card %i)',
    (active) => {
      const { panels } = renderPanels(active)
      for (const panel of panels) {
        const labelled = [...panel.querySelectorAll('*')].filter(hasOwnText)
        for (const el of labelled) {
          const token = colourOf(el, panel)
          expect(
            token,
            `${el.textContent} has no palette colour`
          ).not.toBeNull()
          expect(
            contrastOf(token!),
            `${el.textContent?.trim()} (${token})`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  )

  it('tier labels stay above 4.5:1 on a dimmed (inactive) card', () => {
    const { panels } = renderPanels()
    const tiers = new Set(['Current', 'Step 1', 'Step 2', 'Optimal'])
    for (const panel of panels) {
      const found = [...panel.querySelectorAll('div')].filter((el) =>
        tiers.has((el.textContent ?? '').trim())
      )
      expect(found.length).toBeGreaterThan(0)
      for (const el of found) {
        const token = colourOf(el, panel)!
        expect(
          contrastOf(token, 0.6),
          `${el.textContent} (${token})`
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('renders every state the contrast checks are meant to cover', () => {
    const text = ACTIVE_INDEXES.map((active) =>
      (renderPanels(active).panels[1]?.textContent ?? '').replace(/\s+/gu, ' ')
    ).join(' | ')
    for (const wanted of [
      'Current',
      'Step 1',
      'Step 2',
      'Optimal',
      'Strong',
      'Suitable',
      'Weak',
      'Locked',
      'Unknown',
      'Available Now',
      'Needs Investment',
      'Requires Hotel',
      '+100k',
      'Best'
    ]) {
      expect(text, wanted).toContain(wanted)
    }
  })

  it('the model rejects a theme-style dim colour (negative control)', () => {
    expect(contrastOf('text-slate-600')).toBeLessThan(4.5)
    expect(contrastOf('text-slate-100')).toBeGreaterThan(4.5)
    expect(THEME_TOKEN.test('text-secondary-wh40k')).toBe(true)
    expect(THEME_TOKEN.test('bg-(--bg-secondary)')).toBe(true)
    expect(THEME_TOKEN.test('bg-card/70')).toBe(true)
    expect(THEME_TOKEN.test('text-slate-300')).toBe(false)
  })
})
