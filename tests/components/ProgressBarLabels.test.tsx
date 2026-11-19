import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BAR_PAINT,
  ProgressBar,
  StackedProgressBar
} from '@/app/components/visualizations/ProgressBar'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import { getContrastRatio } from '@/app/lib/utils/contrast'
import { palette } from '../helpers/tailwind-palette'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatDamage: vi.fn((value: number) => `fmt-${value}`)
}))

type BarColor = keyof typeof BAR_PAINT
const COLORS = Object.keys(BAR_PAINT) as BarColor[]
const root = () => document.documentElement
const tokens = (cls: string) => cls.split(/\s+/u).filter(Boolean)

const mix = (a: string, b: string, t: number) => {
  const n = (hex: string, i: number) =>
    parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const c = (i: number) =>
    Math.round(n(a, i) + (n(b, i) - n(a, i)) * t)
      .toString(16)
      .padStart(2, '0')
  return `#${c(0)}${c(1)}${c(2)}`
}

/** A colour class value: a theme token (read from the root) or a palette entry. */
function colour(value: string): string {
  const token = /^\((--[a-z-]+)\)$/u.exec(value)
  if (token) return root().style.getPropertyValue(token[1]!).trim()
  return palette(value)
}

/** The two gradient stops a fill class string paints, in order. */
function stopsOf(cls: string): [string, string] {
  const find = (prefix: string) => {
    const hit = tokens(cls).find((t) => t.startsWith(`${prefix}-`))
    if (!hit) throw new Error(`no ${prefix} stop in "${cls}"`)
    return colour(hit.slice(prefix.length + 1))
  }
  return [find('from'), find('to')]
}

/** Label colour from a `text-*` class. */
function labelOf(cls: string): string {
  const hit = tokens(cls).find((t) => /^text-(black|on-cta-wh40k)$/u.test(t))
  if (!hit) throw new Error(`no label colour in "${cls}"`)
  if (hit === 'text-black') return '#000000'
  return root().style.getPropertyValue('--on-cta').trim()
}

const lowestAlong = (label: string, from: string, to: string) => {
  let lowest = Infinity
  for (let i = 0; i <= 50; i++) {
    lowest = Math.min(lowest, getContrastRatio(label, mix(from, to, i / 50)))
  }
  return lowest
}

function parts(color: BarColor, avg: number, extra = {}) {
  const { container } = render(
    <ProgressBar
      label="Boss"
      avgValue={avg}
      maxValue={100}
      color={color === 'pink' ? 'purple' : color}
      {...extra}
    />
  )
  const bar = container.querySelector('[data-bar]')!
  const [fill] = [...bar.children]
  const labels = [...bar.querySelectorAll('[data-label]')]
  return { container, bar, fill: fill!, labels }
}

describe('progress bar label: readable on the surface under each glyph', () => {
  beforeEach(() => root().removeAttribute('style'))

  it.each(COLORS)(
    '%s: the label over the fill reads on every colour of that fill, on all themes',
    (color) => {
      const paint = BAR_PAINT[color]
      for (const theme of Object.values(allThemes)) {
        root().removeAttribute('style')
        applyThemeToCSS(theme)
        const [from, to] = stopsOf(paint.fill)
        const worst = lowestAlong(labelOf(paint.label), from, to)
        expect(worst, `${color} on ${theme.name}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it('theme-colour fills use the shared call-to-action stops, painted in sRGB', () => {
    for (const color of COLORS) {
      const fill = tokens(BAR_PAINT[color].fill)
      const usesTheme = fill.some((t) => t.includes('(--'))
      if (!usesTheme) continue
      expect(fill, color).toContain('bg-linear-to-r/srgb')
      expect(
        fill
          .filter((t) => t.includes('(--'))
          .map((t) => t.replace(/^(from|to)-/u, ''))
          .sort(),
        color
      ).toEqual(['(--cta-from)', '(--cta-to)'])
      expect(tokens(BAR_PAINT[color].label), color).toEqual([
        'text-on-cta-wh40k'
      ])
    }
  })

  it('the rendered bar paints with the table: the fill and the label over it', () => {
    for (const color of COLORS) {
      if (color === 'pink') continue
      const { fill, labels, container } = parts(color, 80)
      for (const cls of tokens(BAR_PAINT[color].fill)) {
        expect(fill.getAttribute('class'), `${color} fill`).toContain(cls)
      }
      const over = labels.find((l) => l.getAttribute('data-label') === 'fill')!
      expect(over.getAttribute('class'), color).toContain(
        BAR_PAINT[color].label
      )
      container.remove()
    }
  })

  it('the part over the empty track keeps the theme text colour, never a fill label', () => {
    const { labels } = parts('blue', 50)
    const track = labels.find((l) => l.getAttribute('data-label') === 'track')!
    expect(tokens(track.getAttribute('class') ?? '')).toContain(
      'text-primary-wh40k'
    )
    expect(track.getAttribute('class')).not.toMatch(/text-on-cta|text-black/u)
    const over = labels.find((l) => l.getAttribute('data-label') === 'fill')!
    expect(over.getAttribute('class')).not.toContain('text-primary-wh40k')
  })

  it.each([8, 50, 63, 100])(
    'at %i percent the two copies are cut at the fill edge and cover the track exactly',
    (avg) => {
      const { fill, labels } = parts('blue', avg)
      const clip = (kind: string) =>
        labels
          .find((l) => l.getAttribute('data-label') === kind)!
          .getAttribute('style') ?? ''
      expect((fill as HTMLElement).style.width).toBe(`${avg}%`)
      const num = (s: string) =>
        [...s.matchAll(/(\d+(?:\.\d+)?)%/gu)].map((m) => parseFloat(m[1]!))
      expect(num(clip('fill'))).toEqual([100 - avg])
      expect(clip('fill')).toMatch(/inset\(0(px)? [\d.]+% 0(px)? 0(px)?\)/u)
      expect(num(clip('track'))).toEqual([avg])
      expect(clip('track')).toMatch(/inset\(0(px)? 0(px)? 0(px)? [\d.]+%\)/u)
    }
  )

  it('a value over the maximum fills the track and leaves nothing for the track copy', () => {
    const { fill, labels } = parts('green', 150)
    expect((fill as HTMLElement).style.width).toBe('100%')
    const track = labels.find((l) => l.getAttribute('data-label') === 'track')!
    expect(track.getAttribute('style')).toMatch(/100%/u)
    // The shown figure is the real ratio, not the clamped fill.
    expect(track.textContent).toBe('150%')
  })

  it('exposes one copy of the figure to assistive technology', () => {
    const { labels } = parts('blue', 63)
    expect(labels).toHaveLength(2)
    const hidden = labels.filter(
      (l) => l.getAttribute('aria-hidden') === 'true'
    )
    expect(hidden).toHaveLength(1)
    expect(hidden[0]!.getAttribute('data-label')).toBe('track')
    const spoken = labels.find((l) => l.getAttribute('aria-hidden') !== 'true')!
    expect(spoken.textContent).toBe('63%')
    expect(labels.map((l) => l.textContent)).toEqual(['63%', '63%'])
  })

  it('shows no label under the threshold or when turned off, in either copy', () => {
    expect(parts('blue', 4).labels).toHaveLength(0)
    expect(parts('blue', 50, { showPercentage: false }).labels).toHaveLength(0)
    expect(parts('blue', 6).labels).toHaveLength(2)
  })

  it('label copies never take pointer input from the bar', () => {
    const { labels } = parts('blue', 63)
    for (const l of labels) {
      expect(l.getAttribute('class')).toContain('pointer-events-none')
    }
  })

  it('every utility the bar renders exists in the compiled stylesheet', async () => {
    const classes = new Set<string>()
    for (const color of COLORS) {
      if (color !== 'pink') {
        const { container } = parts(color, 63)
        container.querySelectorAll('[class]').forEach((n) => {
          tokens(n.getAttribute('class') ?? '').forEach((t) => classes.add(t))
        })
        container.remove()
      }
      tokens(BAR_PAINT[color].fill).forEach((t) => classes.add(t))
      tokens(BAR_PAINT[color].label).forEach((t) => classes.add(t))
    }
    const from = path.resolve('app/globals.css')
    const base = readFileSync(from, 'utf8').replace(
      /^@source '(?!inline)[^']*';$/gmu,
      ''
    )
    const { css } = await postcss([tailwindcss()]).process(
      `${base}\n@source inline('${[...classes].join(' ')}');`,
      { from }
    )
    const escape = (c: string) =>
      c.replace(/[^a-zA-Z0-9_-]/gu, (ch) => `\\${ch}`)
    // A rule exists when the escaped class is followed by a selector end.
    const missing = [...classes].filter((c) => {
      const needle = `.${escape(c)}`
      for (
        let at = css.indexOf(needle);
        at !== -1;
        at = css.indexOf(needle, at + 1)
      ) {
        if (!/[\w-]/u.test(css[at + needle.length] ?? ' ')) return false
      }
      return true
    })
    expect(missing).toEqual([])
  })
})

describe('stacked bar segment labels', () => {
  beforeEach(() => root().removeAttribute('style'))

  const segments = COLORS.map((color) => ({
    label: `Seg-${color}`,
    value: 20,
    color
  }))

  it('each segment label takes the label colour chosen for that segment fill', () => {
    const { container } = render(
      <StackedProgressBar
        label="Loop"
        segments={segments}
        total={segments.length * 20}
      />
    )
    for (const color of COLORS) {
      const text = [...container.querySelectorAll('span')].find(
        (s) =>
          s.textContent?.startsWith(`Seg-${color}:`) && s.closest('[title]')
      )!
      expect(text.getAttribute('class'), color).toContain(
        BAR_PAINT[color].label
      )
      const seg = text.closest('[title]')!
      for (const cls of tokens(BAR_PAINT[color].fill)) {
        expect(seg.getAttribute('class'), color).toContain(cls)
      }
    }
  })

  it('a segment cuts its own label, so it never spills onto a neighbour', () => {
    const { container } = render(
      <StackedProgressBar
        label="Loop"
        total={100}
        segments={[
          { label: 'A very long segment name', value: 12, color: 'blue' },
          { label: 'Other', value: 12, color: 'green' }
        ]}
      />
    )
    const seg = container.querySelector('[title]')!
    expect(tokens(seg.getAttribute('class') ?? '')).toContain('overflow-hidden')
    const text = seg.querySelector('span')!
    expect(tokens(text.getAttribute('class') ?? '')).toContain('truncate')
  })
})
