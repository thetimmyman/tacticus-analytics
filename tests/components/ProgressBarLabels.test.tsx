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
  const bar = container.querySelector('[data-bar]') as HTMLElement
  const fill = bar.firstElementChild as HTMLElement
  const labels = [...bar.querySelectorAll<HTMLElement>('[data-label]')]
  const over = labels.find((l) => l.dataset.label === 'fill')
  const under = labels.find((l) => l.dataset.label === 'track')
  const wrapper = under?.parentElement as HTMLElement | undefined
  return { container, bar, fill, labels, over, under, wrapper }
}

const pct = (value: string | undefined) => parseFloat(value ?? 'NaN')

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

  it('purple and pink run accent to primary, blue and cyan primary to accent', () => {
    expect(BAR_PAINT.purple.fill).toBe(BAR_PAINT.pink.fill)
    expect(BAR_PAINT.blue.fill).toBe(BAR_PAINT.cyan.fill)
    expect(tokens(BAR_PAINT.blue.fill)).toEqual(
      expect.arrayContaining(['from-(--cta-from)', 'to-(--cta-to)'])
    )
    expect(tokens(BAR_PAINT.purple.fill)).toEqual(
      expect.arrayContaining(['from-(--cta-to)', 'to-(--cta-from)'])
    )
  })

  it('the rendered bar paints with the table: the fill and the label over it', () => {
    for (const color of COLORS) {
      if (color === 'pink') continue
      const { fill, over, container } = parts(color, 80)
      for (const cls of tokens(BAR_PAINT[color].fill)) {
        expect(fill.getAttribute('class'), `${color} fill`).toContain(cls)
      }
      expect(
        fill.contains(over!),
        `${color}: the fill copy sits in the fill`
      ).toBe(true)
      expect(over!.getAttribute('class'), color).toContain(
        BAR_PAINT[color].label
      )
      container.remove()
    }
  })

  it('the part over the empty track keeps the theme text colour, never a fill label', () => {
    const { under, over } = parts('blue', 50)
    expect(tokens(under!.getAttribute('class') ?? '')).toContain(
      'text-primary-wh40k'
    )
    expect(under!.getAttribute('class')).not.toMatch(/text-on-cta|text-black/u)
    expect(over!.getAttribute('class')).not.toContain('text-primary-wh40k')
  })

  it.each([8, 33.333, 49.6, 50, 63, 99.5])(
    'at %s percent each copy is boxed by its own surface and spans the whole track',
    (avg) => {
      const { fill, over, under, wrapper, bar } = parts('blue', avg)
      // The fill and the track copy meet at one edge, computed once.
      expect(fill.style.width).toBe(`${avg}%`)
      expect(wrapper!.getAttribute('style')).toContain(`${avg}%`)
      // Inside each box the label is as wide as the whole track, so it is
      // centred where the original single label was.
      expect((pct(over!.style.width) * avg) / 100).toBeCloseTo(100, 6)
      expect((pct(under!.style.width) * (100 - avg)) / 100).toBeCloseTo(100, 6)
      // Both boxes clip their label; a transform or clip-path cut is not used
      // because it lands on a different device pixel than the fill's edge.
      expect(tokens(fill.getAttribute('class') ?? '')).toEqual(
        expect.arrayContaining(['relative', 'h-full', 'overflow-hidden'])
      )
      expect(tokens(wrapper!.getAttribute('class') ?? '')).toEqual(
        expect.arrayContaining(['absolute', 'inset-y-0', 'overflow-hidden'])
      )
      expect(tokens(bar.getAttribute('class') ?? '')).toEqual(
        expect.arrayContaining(['relative', 'overflow-hidden'])
      )
      expect(bar.innerHTML).not.toMatch(/clip-path|clip:/u)
      // Logical edges, so a right-to-left page splits at the same place.
      const edges = `${wrapper!.getAttribute('style')} ${over!.className} ${under!.className}`
      expect(edges).not.toMatch(/(?:^|[\s;"])(?:left|right)\s*:/u)
      expect(edges).not.toMatch(/(?:^|\s)(?:left|right)-\d/u)
      expect(tokens(over!.className)).toContain('start-0')
      expect(tokens(under!.className)).toContain('end-0')
      expect(tokens(over!.className)).toContain('inset-y-0')
      expect(tokens(under!.className)).toContain('inset-y-0')
    }
  )

  it('a full bar has no track copy; a value over the maximum still shows its real figure', () => {
    const full = parts('green', 100)
    expect(full.under).toBeUndefined()
    expect(full.over!.textContent).toBe('100%')
    const over = parts('green', 150)
    expect(over.fill.style.width).toBe('100%')
    expect(over.under).toBeUndefined()
    expect(over.over!.textContent).toBe('150%')
  })

  it('both copies read the same rounded figure', () => {
    const { over, under } = parts('blue', 49.6)
    expect(over!.textContent).toBe('50%')
    expect(under!.textContent).toBe('50%')
  })

  it('exposes one copy of the figure to assistive technology and to copy and paste', () => {
    const { labels, over, under, wrapper } = parts('blue', 63)
    expect(labels).toHaveLength(2)
    expect(wrapper!.getAttribute('aria-hidden')).toBe('true')
    expect(tokens(wrapper!.className)).toContain('select-none')
    expect(over!.closest('[aria-hidden="true"]')).toBeNull()
    expect(under!.closest('[aria-hidden="true"]')).toBe(wrapper)
    expect(over!.textContent).toBe('63%')
  })

  it('shows no label at or under 5 percent or when turned off, in either copy', () => {
    expect(parts('blue', 4).labels).toHaveLength(0)
    expect(parts('blue', 5).labels).toHaveLength(0)
    expect(parts('blue', 5.1).labels).toHaveLength(2)
    expect(parts('blue', 50, { showPercentage: false }).labels).toHaveLength(0)
    expect(parts('blue', 6).labels).toHaveLength(2)
  })

  it('label copies never take pointer input and carry no transparency of their own', () => {
    const { labels, wrapper } = parts('blue', 63)
    expect(tokens(wrapper!.className)).toContain('pointer-events-none')
    for (const l of labels) {
      expect(tokens(l.className)).toContain('pointer-events-none')
      // An alpha or opacity would change the contrast the table promises.
      expect(l.className).not.toMatch(/opacity|\/\d/u)
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

  it('with labels, each segment takes the label colour chosen for its fill', () => {
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

  it('without labels, segments keep the plain theme gradient the legend text is coloured to match', () => {
    const { container } = render(
      <StackedProgressBar
        label="Loop"
        segments={segments}
        total={segments.length * 20}
        showLabels={false}
      />
    )
    const fills = Object.fromEntries(
      [...container.querySelectorAll('[title]')].map((seg) => [
        seg.getAttribute('title')!.split(':')[0],
        tokens(seg.getAttribute('class') ?? '').filter((t) =>
          /^(bg-linear|from-|to-)/u.test(t)
        )
      ])
    )
    expect(fills['Seg-blue']).toEqual([
      'bg-linear-to-r',
      'from-(--primary)',
      'to-(--accent)'
    ])
    expect(fills['Seg-pink']).toEqual([
      'bg-linear-to-r',
      'from-(--accent)',
      'to-(--primary)'
    ])
    // Status colours do not depend on the theme, so they are shared.
    for (const color of ['green', 'red', 'yellow'] as const) {
      expect(fills[`Seg-${color}`], color).toEqual(
        tokens(BAR_PAINT[color].fill)
      )
    }
    expect(container.textContent).not.toContain('Seg-blue: 20Seg-blue')
    expect(container.querySelectorAll('[title] span')).toHaveLength(0)
  })

  it('a segment shows its label only above 10 percent of the total', () => {
    const at = (value: number) =>
      render(
        <StackedProgressBar
          label="Loop"
          total={100}
          segments={[{ label: 'A', value, color: 'blue' }]}
        />
      ).container.querySelectorAll('[title] span').length
    expect(at(10)).toBe(0)
    expect(at(11)).toBe(1)
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
