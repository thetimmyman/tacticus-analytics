import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
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

describe('confirm dialog tones read on every theme', () => {
  beforeEach(() => root().removeAttribute('style'))
  afterEach(cleanup)

  it.each(Object.entries(allThemes))(
    '%s: confirm label reaches 4.5:1 on its fill, at rest and on hover',
    (_code, theme) => {
      applyThemeToCSS(theme)

      for (const tone of TONES) {
        const button = renderTone(tone)
        const cls = button.className
        const fill = tokenOf(cls, /^bg-\(--[a-z-]+\)$/u)
        const hover = tokenOf(cls, /^hover:bg-\(--[a-z-]+\)$/u)
        const label = tokenOf(cls, /^text-\(--[a-z-]+\)$/u)
        const label_ = colour(label)

        expect(
          getContrastRatio(label_, colour(fill)),
          `${tone} rest`
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          getContrastRatio(label_, colour(hover)),
          `${tone} hover`
        ).toBeGreaterThanOrEqual(4.5)
        cleanup()
      }
    }
  )

  it('paints an opaque fill: no translucent tint lets the card change the result', () => {
    for (const tone of TONES) {
      const cls = renderTone(tone).className
      expect(cls, tone).not.toMatch(/color-mix|bg-[^\s]+\/\d+/u)
      cleanup()
    }
  })

  it('keeps the tone title readable by using the page text colour', () => {
    // A danger or warning title coloured by the status token dropped under
    // 4.5:1 on brighter card surfaces; the confirm button carries the tone.
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
      expect(title.className, tone).toContain('text-primary-wh40k')
      expect(title.className, tone).not.toMatch(/--(danger|warning)/u)
      cleanup()
    }
  })
})
