import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@tacticus/ui-kit'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import { getContrastRatio } from '@/app/lib/utils/contrast'
import { classTokens, only, paint } from '../helpers/compiled-paint'

const root = () => document.documentElement

type Variant = 'outline' | 'ghost'

const renderButton = (variant: Variant, className?: string) => {
  render(
    <Button variant={variant} className={className}>
      Refresh data
    </Button>
  )
  return screen.getByRole('button', { name: 'Refresh data' })
}

/**
 * The quiet variants as painted. The label sits on the same background in
 * every frame (hover declares no fill, text colour, filter or opacity), so
 * its contrast is the rest contrast on every theme; the hover cue is a ring
 * in the label's own colour.
 */
async function expectQuietPaint(className: string, variant: Variant) {
  const { rest, hover, important } = await paint(className)
  expect(only(rest, 'color')).toBe('var(--text-primary)')
  if (variant === 'outline') {
    expect(only(rest, 'background-color')).toBe('transparent')
    expect(only(rest, 'border-color')).toBe('var(--card-border)')
    expect(only(rest, 'border-width')).toBe('1px')
  } else {
    expect(rest['background-color']).toBeUndefined()
    expect(rest['border-width']).toBeUndefined()
  }
  for (const prop of ['opacity', 'filter', 'background-image']) {
    expect(rest[prop], `${prop} at rest`).toBeUndefined()
  }

  // Hover paints an inner ring and, with a border, strengthens the border:
  // nothing that sits behind or changes the label.
  const allowed =
    variant === 'outline'
      ? ['--tw-inset-ring-shadow', 'border-color', 'box-shadow']
      : ['--tw-inset-ring-shadow', 'box-shadow']
  expect(Object.keys(hover).sort()).toEqual(allowed)
  expect(only(hover, '--tw-inset-ring-shadow')).toBe(
    'inset 0 0 0 1px var(--tw-inset-ring-color, currentcolor)'
  )
  expect(only(hover, 'box-shadow')).toMatch(/var\(--tw-inset-ring-shadow\)/u)
  if (variant === 'outline') {
    expect(only(hover, 'border-color')).toBe('currentcolor')
  }
  // `!important` would let one colour beat the hover cue.
  expect(important).toEqual([])
}

describe.each(['outline', 'ghost'] as const)('%s button hover', (variant) => {
  beforeEach(() => root().removeAttribute('style'))
  afterEach(cleanup)

  it('adds a ring in the label colour and never touches the label background', async () => {
    await expectQuietPaint(renderButton(variant).className, variant)
  })

  it('does not hover while disabled or loading', async () => {
    cleanup()
    const onClick = vi.fn()
    render(
      <Button variant={variant} disabled onClick={onClick}>
        Refresh data
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Refresh data' })
    expect(classTokens(button.className)).toEqual(
      expect.arrayContaining([
        'disabled:opacity-50',
        'disabled:pointer-events-none'
      ])
    )
    await userEvent.setup().click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps its keyboard focus ring beside the hover ring', async () => {
    const list = classTokens(renderButton(variant).className)
    expect(list).toContain('focus-visible:ring-2')
    // Both rings are composed into one box-shadow by the same utilities, so
    // neither replaces the other.
    const { hover } = await paint(list.join(' '))
    expect(only(hover, 'box-shadow')).toMatch(/var\(--tw-ring-shadow\)/u)
  })

  it('catches a class that changes the label background or colour (the checker itself)', async () => {
    const cls = renderButton(variant).className
    await expectQuietPaint(cls, variant) // the control passes
    for (const extra of [
      'hover:bg-(--card-bg)',
      'hover:bg-white/10',
      'hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]',
      'hover:text-(--accent)',
      'hover:opacity-80',
      'hover:brightness-110',
      'hover:bg-none',
      'bg-(--card-bg)',
      'text-red-500',
      'opacity-70',
      'hover:ring-2',
      'hover:inset-ring-2'
    ]) {
      await expect(
        expectQuietPaint(`${cls} ${extra}`, variant),
        extra
      ).rejects.toThrow()
    }
    // The cue itself is required, and the right kind.
    const without = (drop: RegExp) =>
      classTokens(cls)
        .filter((c) => !drop.test(c))
        .join(' ')
    await expect(
      expectQuietPaint(without(/^hover:inset-ring-1$/u), variant),
      'no ring'
    ).rejects.toThrow()
    await expect(
      expectQuietPaint(
        without(/^hover:inset-ring-1$/u) + ' hover:ring-1',
        variant
      ),
      'outer ring instead of inner'
    ).rejects.toThrow()
    if (variant === 'outline') {
      await expect(
        expectQuietPaint(without(/^hover:border-current$/u), variant),
        'border stays faint'
      ).rejects.toThrow()
      await expect(
        expectQuietPaint(
          without(/^hover:border-current$/u) + ' hover:border-(--accent)',
          variant
        ),
        'border takes a theme token'
      ).rejects.toThrow()
    }
  })
})

// The ring is the label colour, so it is as strong as the label itself.
const channels = (value: string): [number, number, number, number] => {
  const hex = /^#([0-9a-f]{6})$/iu.exec(value.trim())
  if (hex) {
    const n = parseInt(hex[1]!, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const rgb = /^rgba?\(([^)]+)\)$/u.exec(value.trim())
  if (!rgb) throw new Error(`unparseable colour ${value}`)
  const [r = 0, g = 0, b = 0, a = 1] = rgb[1]!.split(',').map(Number)
  return [r, g, b, a]
}
const over = (top: string, below: string) => {
  const [r, g, b, a] = channels(top)
  const [br, bg, bb] = channels(below)
  const mix = (x: number, y: number) =>
    Math.round(x * a + y * (1 - a))
      .toString(16)
      .padStart(2, '0')
  return `#${mix(r, br)}${mix(g, bg)}${mix(b, bb)}`
}

describe('the hover ring is stronger than the rest border on every theme', () => {
  beforeEach(() => root().removeAttribute('style'))

  it.each(Object.entries(allThemes))(
    '%s: label-coloured ring vs the faint card border, on the page and on a card',
    (_code, theme) => {
      applyThemeToCSS(theme)
      const read = (name: string) => root().style.getPropertyValue(name)
      const label = read('--text-primary')
      const page = theme.background.via || theme.background.from
      const surfaces = [page, over(read('--card-bg'), page)]

      for (const surface of surfaces) {
        const border = over(read('--card-border'), surface)
        const rest = getContrastRatio(border, surface)
        const ring = getContrastRatio(over(label, surface), surface)
        expect(ring).toBeGreaterThanOrEqual(rest * 1.5)
      }
    }
  )
})
