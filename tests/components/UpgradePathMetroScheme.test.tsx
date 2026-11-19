import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UpgradePathMetro } from '@/app/(dashboard)/meta-atlas/components/UpgradePathMetro'
import { METRO_FIXTURE_PROPS } from '@/app/components/ui/upgrade-path-metro.fixture'
import { getContrastRatio } from '@/app/lib/utils/contrast'

// Both Personal Potential panels paint their own dark surface on every theme:
// one `scheme-dark` scope, an opaque base and palette colours only. A theme
// token or remapped tier resolves for the page theme and lands dark-on-dark
// on Light Mode. Each label is modelled on its own surface (fills, glow,
// overlays, group opacity); the browser fixture measures the real pixels.

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

const PANEL_GRADIENT = [
  'from-slate-950/80',
  'via-slate-900/70',
  'to-slate-950/80'
]
const RADIAL = [
  'bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_50%)]',
  'bg-[radial-gradient(circle_at_bottom,rgba(56,189,248,0.12),transparent_55%)]'
]

// Lightest panel pixel: the middle gradient stop over the black base. The
// desktop radial overlays peak at the panel edges and fade out before the
// cards, so they count at RADIAL_ALLOWANCE rather than at their peak alpha.
const RADIAL_ALLOWANCE = 0.12
const GRADIENT_LIGHTEST = mix(palette('slate-900'), [0, 0, 0], 0.7)
const baseOf = (panel: Element) =>
  [...panel.children].some((c) => RADIAL.some((r) => tokensOf(c).includes(r)))
    ? mix(palette('emerald-500'), GRADIENT_LIGHTEST, RADIAL_ALLOWANCE)
    : GRADIENT_LIGHTEST

const COLOUR = String.raw`(white|black|[a-z]+-\d+)`
const COLOUR_TOKEN = new RegExp(`^text-${COLOUR}(?:/(\\d+))?$`, 'u')
const FILL_TOKEN = new RegExp(`^bg-${COLOUR}(?:/(\\d+))?$`, 'u')
const THEME_TOKEN =
  /(?:-wh40k\b|\(--|var\(--|\(color:|color-mix|(?:^|[-:])card(?:[-/]|$)|-text-(?:primary|secondary|muted))/u
const VARIANT = String.raw`(?:(?:\[[^\]]*\]|[a-z0-9-]+):)+`
const REPAINT =
  'opacity|bg|from|via|to|stroke|fill|shadow|inset-shadow|ring|inset-ring|outline|scheme|filter|blur|grayscale|brightness|contrast|saturate|invert|sepia|hue-rotate|mix-blend|bg-blend|backdrop|drop-shadow|decoration|accent|caret'
// Paint the model cannot read: variants that repaint or recolour, important
// or arbitrary-property colours, icon strokes, inset shadows and blend modes.
const UNREADABLE = new RegExp(
  [
    `^${VARIANT}!?(?:${REPAINT})(?:-|$|\\[)`,
    `^${VARIANT}!?text-(?!(?:xs|sm|base|lg|xl|\\dxl|left|center|right|\\[\\d+px\\])$)`,
    '!',
    String.raw`(?:^|:)\[[a-z-]+:`,
    String.raw`^(?:text|bg|border|from|via|to)-\[(?:#|color:|rgb|hsl|oklch)`,
    '^(?:stroke|fill)-',
    '^(?:-?hue-rotate|brightness|contrast|saturate|invert|sepia|mix-blend|bg-blend)',
    '^backdrop-(?!blur-sm$)',
    String.raw`^shadow-\[[^\]]*inset|^inset-(?:shadow|ring)`
  ].join('|'),
  'u'
)
const isTier = (el: Element) =>
  tokensOf(el).includes('uppercase') && tokensOf(el).includes('tracking-wide')
const MIN_FLOOR = 3.5

const tokensOf = (el: Element) =>
  (el.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean)

const opacityOf = (el: Element) => {
  const token = tokensOf(el).find((t) => t.startsWith('opacity-'))
  return token ? Number(token.slice(8)) / 100 : 1
}

type Layer = { rgb: Rgb; alpha: number }

const layersOf = (el: Element, strength = 1): Layer[] =>
  tokensOf(el).flatMap((token) => {
    const m = FILL_TOKEN.exec(token)
    return m
      ? [
          {
            rgb: palette(m[1]!),
            alpha: (m[2] ? Number(m[2]) / 100 : 1) * strength
          }
        ]
      : []
  })

// An absolute sibling that spans its parent (inset-*) before a node paints
// under it (a card's glow, outside the node's own opacity); after it, over it.
const spans = (el: Element) => tokensOf(el).some((t) => /^-?inset-/u.test(t))

const siblingLayers = (el: Element | null) =>
  el && tokensOf(el).includes('absolute') && spans(el)
    ? layersOf(el, opacityOf(el))
    : []

const glowOf = (node: Element) => siblingLayers(node.previousElementSibling)

const coversOf = (node: Element) => {
  const covers: Layer[] = []
  for (let s = node.nextElementSibling; s; s = s.nextElementSibling) {
    covers.push(...siblingLayers(s))
  }
  return covers
}

const grey = ([r, g, b]: Rgb): Rgb => {
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  return [y, y, y]
}

type Pixel = { ink: Rgb; bg: Rgb }

// Paint the chain top-down: each node's group composites over the backdrop at
// its own opacity, so nested dimming and the card dim compose as the browser does.
function pixel(chain: Element[], i: number, backdrop: Rgb, ink: Layer): Pixel {
  const node = chain[i]
  if (!node) return { ink: mix(ink.rgb, backdrop, ink.alpha), bg: backdrop }
  const base = glowOf(node).reduce((u, l) => mix(l.rgb, u, l.alpha), backdrop)
  const under = layersOf(node).reduce((u, l) => mix(l.rgb, u, l.alpha), base)
  let inner = pixel(chain, i + 1, under, ink)
  if (tokensOf(node).includes('grayscale')) {
    inner = { ink: grey(inner.ink), bg: grey(inner.bg) }
  }
  const dim = opacityOf(node)
  let out: Pixel = {
    ink: mix(inner.ink, base, dim),
    bg: mix(inner.bg, base, dim)
  }
  for (const cover of coversOf(node)) {
    out = {
      ink: mix(cover.rgb, out.ink, cover.alpha),
      bg: mix(cover.rgb, out.bg, cover.alpha)
    }
  }
  return out
}

function colourOf(el: Element, panel: Element): string | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const token = tokensOf(node).find((t) => COLOUR_TOKEN.test(t))
    if (token) return token
    if (node === panel) break
  }
  return null
}

function contrastOf(el: Element, panel: Element): number | null {
  const token = colourOf(el, panel)
  const match = token ? COLOUR_TOKEN.exec(token) : null
  if (!match) return null
  const chain: Element[] = []
  for (let n: Element | null = el; n && n !== panel; n = n.parentElement) {
    chain.unshift(n)
  }
  const ink = {
    rgb: palette(match[1]!),
    alpha: match[2] ? Number(match[2]) / 100 : 1
  }
  const { ink: inkPx, bg } = pixel(chain, 0, baseOf(panel), ink)
  return getContrastRatio(hex(inkPx), hex(bg))
}

// Only the active card shows its availability pill and requirement, so every
// card has to be active once for the checks to see all of them.
const ACTIVE_INDEXES = [0, 1, 2, 3]
// Without hero mappings a card shows its composition text, not portraits.
const CASES = ACTIVE_INDEXES.flatMap(
  (a) =>
    [
      [a, true],
      [a, false]
    ] as const
)

function renderPanels(active = 1, portraits = true) {
  const { container } = render(
    <UpgradePathMetro
      {...METRO_FIXTURE_PROPS}
      defaultActiveIndex={active}
      heroMappings={portraits ? METRO_FIXTURE_PROPS.heroMappings : undefined}
    />
  )
  // Found by structure, not by the class under test: a panel that loses its
  // scope must fail the checks below, not drop out of them.
  const panels = [...(container.firstElementChild?.children ?? [])].map(
    (layout) => {
      const panel = layout.firstElementChild
      if (!panel) throw new Error('layout without a panel')
      return panel
    }
  )
  expect(panels).toHaveLength(2)
  const cards = panels.map((panel) => {
    const row = [...panel.children].find((c) =>
      tokensOf(c).includes('items-end')
    )
    return [...(row ?? panel).children]
  })
  for (const list of cards) {
    expect(list).toHaveLength(METRO_FIXTURE_PROPS.steps.length + 1)
    list.forEach((card, index) => {
      expect(opacityOf(card) === 1, `card ${index} of ${active}`).toBe(
        index === active
      )
    })
  }
  return { container, panels, cards }
}

const everyIn = (panel: Element) => [panel, ...panel.querySelectorAll('*')]

const hasOwnText = (el: Element) =>
  [...el.childNodes].some(
    (n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== ''
  )

describe('Personal Potential panels: a dark island on every page theme', () => {
  it('both layouts (phone and desktop) are scheme-dark with an opaque black base', () => {
    const { container, panels } = renderPanels()
    expect([...container.querySelectorAll('.scheme-dark')]).toEqual(panels)
    expect(panels[0]?.parentElement?.className).toContain('sm:hidden')
    expect(panels[1]?.parentElement?.className).toContain('sm:block')
    for (const panel of panels) {
      expect(tokensOf(panel)).toContain('scheme-dark')
      expect(tokensOf(panel)).toContain('bg-black')
      const paint = tokensOf(panel).filter((t) => /^(from|via|to)-/u.test(t))
      expect(paint).toEqual(PANEL_GRADIENT)
    }
    const overlays = [...(panels[1]?.children ?? [])].filter((c) =>
      tokensOf(c).some((t) => t.startsWith('bg-['))
    )
    expect(
      overlays.flatMap(tokensOf).filter((t) => t.startsWith('bg-['))
    ).toEqual(RADIAL)
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

  it.each(CASES)(
    'nothing inside a panel can undo the scope or follow the theme (active card %i, portraits %s)',
    (active, portraits) => {
      const { panels } = renderPanels(active, portraits)
      for (const panel of panels) {
        const found = (test: (token: string, el: Element) => boolean) =>
          everyIn(panel).flatMap((el) =>
            tokensOf(el)
              .filter((token) => test(token, el))
              .map((token) => `${token} on <${el.tagName.toLowerCase()}>`)
          )
        expect(
          found((t) => THEME_TOKEN.test(t)),
          'theme tokens'
        ).toEqual([])
        expect(
          found((t) => UNREADABLE.test(t)),
          'unreadable paint'
        ).toEqual([])
        expect(
          found((t, el) => t.includes('scheme-') && el !== panel),
          'nested scheme'
        ).toEqual([])
        expect(
          found(
            (t, el) =>
              (/^(?:from|via|to)-/u.test(t) && el !== panel) ||
              (t.startsWith('bg-') &&
                !FILL_TOKEN.test(t) &&
                !(t === 'bg-linear-to-br' && el === panel) &&
                !(RADIAL.includes(t) && el.parentElement === panel))
          ),
          'fills the model cannot read'
        ).toEqual([])
        const floating = everyIn(panel).filter(
          (el) =>
            tokensOf(el).includes('absolute') &&
            layersOf(el).length > 0 &&
            !spans(el) &&
            !(
              tokensOf(el).includes('-bottom-1') &&
              tokensOf(el).includes('-right-1')
            )
        )
        expect(
          floating.map((el) => el.outerHTML.slice(0, 80)),
          'positioned fills the model cannot place'
        ).toEqual([])
        expect(
          found((t) => t.startsWith('opacity-') && !/^opacity-\d+$/u.test(t)),
          'opacity values'
        ).toEqual([])
        expect(
          found((t) => /^opacity-\d+$/u.test(t) && Number(t.slice(8)) < 60),
          'opacity below 60'
        ).toEqual([])
        for (const el of everyIn(panel)) {
          expect(
            tokensOf(el).filter((t) => COLOUR_TOKEN.test(t)).length,
            `one text colour on ${el.outerHTML.slice(0, 80)}`
          ).toBeLessThanOrEqual(1)
          expect(
            (el.getAttribute('style') ?? '').replace(
              /flex-(?:grow|basis):\s*[\d.]+(?:px)?;?\s*/gu,
              ''
            ),
            'inline paint'
          ).toBe('')
        }
      }
    }
  )

  it.each(CASES)(
    'labels and icons read on their own surface (active card %i, portraits %s)',
    (active, portraits) => {
      const { panels, cards } = renderPanels(active, portraits)
      let checked = 0
      panels.forEach((panel, p) => {
        const labels = everyIn(panel).filter(
          (el) => hasOwnText(el) || el.tagName.toLowerCase() === 'svg'
        )
        for (const el of labels) {
          const name = `${el.textContent?.trim() || el.tagName} (${tokensOf(el).join(' ')})`
          const ratio = contrastOf(el, panel)
          expect(ratio, `${name} has no palette colour`).not.toBeNull()
          const card = cards[p]!.find((c) => c.contains(el))
          const dimmed = card ? opacityOf(card) < 1 : false
          const tier = isTier(el)
          const icon = el.tagName.toLowerCase() === 'svg'
          // Small text on dimmed cards stays under 4.5 (known, same on dark);
          // the tier labels hold the line and nothing drops below the floor.
          const need = dimmed && !tier ? MIN_FLOOR : icon ? 3 : 4.5
          checked += 1
          expect(ratio, name).toBeGreaterThanOrEqual(need)
        }
      })
      expect(checked).toBeGreaterThan(portraits ? 100 : 30)
      if (!portraits) {
        expect(panels[1]?.textContent).toContain('Alpha, Bravo')
      }
    }
  )

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

  it('the model and the token rules reject what they are meant to reject', () => {
    const { panels, cards } = renderPanels(3)
    const panel = panels[1]!
    const find = (text: string) =>
      everyIn(panel).find(
        (el) => (el.textContent ?? '').trim() === text && hasOwnText(el)
      )!
    const set = (el: Element, from: RegExp, to: string) =>
      el.setAttribute(
        'class',
        (el.getAttribute('class') ?? '').replace(from, to)
      )
    const optimal = everyIn(panel).find(
      (el) => isTier(el) && el.textContent === 'Optimal'
    )!
    const before = contrastOf(optimal, panel)!
    expect(before).toBeGreaterThan(4.5)
    set(optimal, /text-amber-\d+/u, 'text-slate-600')
    expect(contrastOf(optimal, panel)).toBeLessThan(4.5)
    set(optimal, /text-slate-600/u, 'text-amber-100')
    expect(contrastOf(optimal, panel)).toBeCloseTo(before, 1)
    const pill = find('Available Now')
    pill.setAttribute('class', `${pill.getAttribute('class')} bg-slate-200/90`)
    expect(contrastOf(pill, panel)).toBeLessThan(4.5)
    set(cards[1]![3]!, /opacity-100/u, 'opacity-40')
    expect(contrastOf(optimal, panel)).toBeLessThan(4.5)
    for (const bad of [
      'text-secondary-wh40k',
      'bg-(--bg-secondary)',
      'bg-card/70'
    ]) {
      expect(THEME_TOKEN.test(bad), bad).toBe(true)
    }
    for (const bad of [
      'sm:text-slate-700',
      'sm:scheme-light',
      'sm:bg-white',
      'text-[#111]'
    ]) {
      expect(UNREADABLE.test(bad), bad).toBe(true)
    }
    expect(THEME_TOKEN.test('text-slate-300')).toBe(false)
    expect(UNREADABLE.test('sm:text-[11px]')).toBe(false)
  })
})
