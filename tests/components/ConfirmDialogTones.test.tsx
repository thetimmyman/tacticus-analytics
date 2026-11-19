import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  allThemes,
  applyThemeToCSS,
  type GuildTheme
} from '@/app/lib/theme-system'
import { getContrastRatio } from '@/app/lib/utils/contrast'
import {
  ConfirmDialog,
  type ConfirmDialogTone
} from '@/app/components/ui/ConfirmDialog'

const root = () => document.documentElement
const TONES: ConfirmDialogTone[] = ['default', 'warning', 'danger']

/** The variable a utility such as `bg-(--danger)` or `hover:bg-(--x)` reads. */
function tokenOf(className: string, utility: RegExp): string | null {
  const match = className.split(/\s+/u).find((c) => utility.test(c))
  const name = match ? /\(--([a-z-]+)\)/u.exec(match) : null
  return name ? `--${name[1]}` : null
}

function colour(name: string | null): string {
  expect(name, 'a token class').not.toBeNull()
  const value = root().style.getPropertyValue(name!)
  expect(value, `${name} is set by the theme`).not.toBe('')
  return value
}

function renderTone(tone: ConfirmDialogTone) {
  render(
    <ConfirmDialog
      open
      tone={tone}
      title="Remove example key?"
      confirmLabel="Remove key"
      onCancel={() => {}}
      onConfirm={() => {}}
    />
  )
  return screen.getByRole('button', { name: 'Remove key' })
}

type RGB = [number, number, number]

const hex = (c: RGB) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

function parseRgba(value: string): { rgb: RGB; alpha: number } {
  const [r, g, b, a] = value
    .replace(/^rgba?\(|\)$/gu, '')
    .split(',')
    .map(Number)
  return { rgb: [r!, g!, b!], alpha: a ?? 1 }
}

function parseHex(value: string): RGB {
  const n = (i: number) => parseInt(value.slice(1 + i * 2, 3 + i * 2), 16)
  return [n(0), n(1), n(2)]
}

/**
 * The card surface behind a dialog: the theme's translucent card over each
 * stop of its page gradient, dimmed by the 60% black backdrop. The darkest or
 * lightest of the three decides.
 */
function dialogSurfaces(theme: GuildTheme): string[] {
  const card = parseRgba(theme.cardBg)
  const stops = [theme.background.via ?? theme.background.from]
  return stops.map((stop) => {
    const dimmed = parseHex(stop).map((v) => v * 0.4) as RGB
    return hex(
      card.rgb.map(
        (v, i) => v * card.alpha + dimmed[i]! * (1 - card.alpha)
      ) as RGB
    )
  })
}

describe('confirm dialog tones read on every theme', () => {
  beforeEach(() => root().removeAttribute('style'))
  afterEach(cleanup)

  it.each(Object.entries(allThemes))(
    '%s: confirm label reaches 4.5:1 on its fill, at rest and on hover',
    (_code, theme) => {
      applyThemeToCSS(theme)

      for (const tone of TONES) {
        const cls = renderTone(tone).className
        const fill = tokenOf(cls, /^bg-\(--[a-z-]+\)$/u)
        const hover = tokenOf(cls, /^hover:bg-\(--[a-z-]+\)$/u)
        const label = colour(tokenOf(cls, /^text-\(--[a-z-]+\)$/u))

        // Hover is a step of the SAME fill, not another status colour's.
        expect(hover, `${tone} hover token`).toBe(`${fill}-fill-hover`)
        expect(
          getContrastRatio(label, colour(fill)),
          `${tone} rest`
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          getContrastRatio(label, colour(hover)),
          `${tone} hover`
        ).toBeGreaterThanOrEqual(4.5)
        cleanup()
      }
    }
  )

  it.each(Object.entries(allThemes))(
    '%s: the title reads on the dialog card as large text (3:1)',
    (_code, theme) => {
      applyThemeToCSS(theme)
      const text = root().style.getPropertyValue('--text-primary')

      // The 20px bold title is WCAG large text, so 3:1 applies. Sixteen
      // themes' own text colour is under 4.5:1 on their page background
      // (theme data, tracked separately); this keeps every one readable here.
      for (const surface of dialogSurfaces(theme)) {
        expect(
          getContrastRatio(text, surface),
          `text ${text} on ${surface}`
        ).toBeGreaterThanOrEqual(3)
      }
    }
  )

  it('paints an opaque fill: no translucent tint lets the card change the result', () => {
    for (const tone of TONES) {
      const cls = renderTone(tone).className
      expect(cls, tone).not.toMatch(/color-mix|bg-[^\s]+\/\d+/u)
      // Only the disabled state may fade the button.
      expect(
        cls.split(/\s+/u).filter((c) => c.includes('opacity')),
        tone
      ).toEqual(['disabled:opacity-50'])
      cleanup()
    }
  })

  it('draws a transparent border so forced-colours mode still shows the button edge', () => {
    for (const tone of TONES) {
      const cls = renderTone(tone).className.split(/\s+/u)
      expect(cls, tone).toContain('border')
      expect(cls, tone).toContain('border-transparent')
      cleanup()
    }
  })

  it('sets the title in the page text colour and nothing else', () => {
    // A title in the status colour fell under 4.5:1 on brighter cards.
    for (const tone of TONES) {
      render(
        <ConfirmDialog
          open
          tone={tone}
          title="Remove example key?"
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      )
      const title = screen.getByRole('heading', { name: 'Remove example key?' })
      const classes = title.className.split(/\s+/u)
      const colours = classes.filter((c) => /^text-(?!xl$)/u.test(c))
      expect(colours, tone).toEqual(['text-primary-wh40k'])
      // 20px at weight 700 is the large-text size the 3:1 check above assumes.
      expect(classes, tone).toContain('text-xl')
      expect(classes, tone).toContain('font-bold')
      cleanup()
    }
  })

  it('marks warning and danger with a badge that is not read aloud and uses the status fill', () => {
    for (const tone of TONES) {
      render(
        <ConfirmDialog
          open
          tone={tone}
          title="Remove example key?"
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      )
      const dialog = screen.getByRole('dialog', {
        name: 'Remove example key?'
      })
      const badge = dialog.querySelector('span[aria-hidden="true"]')

      if (tone === 'default') {
        expect(badge, tone).toBeNull()
      } else {
        expect(badge?.className, tone).toContain(`bg-(--${tone})`)
        expect(badge?.className, tone).toContain(`text-(--on-${tone})`)
        expect(badge?.querySelector('svg'), tone).not.toBeNull()
      }
      cleanup()
    }
  })
})
