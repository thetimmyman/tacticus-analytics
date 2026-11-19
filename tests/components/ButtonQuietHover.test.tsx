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
 * The quiet variants as painted: hover adds an inner ring and nothing that
 * sits behind or recolours the label, so label contrast is the rest contrast.
 * Every other state is pinned too, including ones hidden behind `sm:`,
 * `enabled:` or `active:`.
 */
async function expectQuietPaint(className: string, variant: Variant) {
  const { rest, hover, states, important } = await paint(className)
  expect(only(rest, 'color')).toBe('var(--text-primary)')
  if (variant === 'outline') {
    expect(only(rest, 'background-color')).toBe('transparent')
    expect(only(rest, 'border-color')).toBe('var(--card-border)')
    expect(only(rest, 'border-width')).toBe('1px')
  } else {
    expect(rest['background-color']).toBeUndefined()
    expect(rest['border-width']).toBeUndefined()
  }
  // Nothing else is painted at rest: no shadow, ring, filter or opacity.
  const layout = [
    '--tw-font-weight',
    'align-items',
    'border-radius',
    'color',
    'display',
    'font-weight',
    'height',
    'justify-content',
    'padding-block',
    'padding-inline',
    'transition-duration',
    'transition-property',
    'transition-timing-function'
  ]
  expect(Object.keys(rest).sort()).toEqual(
    variant === 'outline'
      ? [
          ...layout,
          'background-color',
          'border-color',
          'border-style',
          'border-width'
        ].sort()
      : layout
  )

  // Hover paints an inner ring (2px with a border, 1px without) and nothing
  // that sits behind or recolours the label; the border colour stays the
  // call site's. Ghost restates its rest text colour so a call-site
  // `hover:text-*` class keeps losing.
  expect(Object.keys(hover).sort()).toEqual(
    variant === 'outline'
      ? ['--tw-inset-ring-shadow', 'box-shadow']
      : ['--tw-inset-ring-shadow', 'box-shadow', 'color']
  )
  expect(only(hover, '--tw-inset-ring-shadow')).toBe(
    `inset 0 0 0 ${variant === 'outline' ? 2 : 1}px var(--tw-inset-ring-color, currentcolor)`
  )
  expect(only(hover, 'box-shadow')).toMatch(/var\(--tw-inset-ring-shadow\)/u)
  if (variant === 'ghost') {
    expect(only(hover, 'color')).toBe(only(rest, 'color'))
  }

  // The only other states: disabled (half strength, no pointer) and the
  // keyboard focus ring, an outer 2px ring in the accent that stacks with the
  // hover ring because both compose into one box-shadow.
  expect(Object.keys(states).sort()).toEqual([':disabled', ':focus-visible'])
  expect(only(states[':disabled']!, 'opacity')).toBe('50%')
  expect(only(states[':disabled']!, 'pointer-events')).toBe('none')
  expect(Object.keys(states[':disabled']!).sort()).toEqual([
    'opacity',
    'pointer-events'
  ])
  const focus = states[':focus-visible']!
  expect(Object.keys(focus).sort()).toEqual([
    '--tw-outline-style',
    '--tw-ring-color',
    '--tw-ring-shadow',
    'box-shadow',
    'outline-style'
  ])
  expect(only(focus, '--tw-ring-color')).toBe('var(--accent)')
  expect(only(focus, '--tw-ring-shadow')).toBe(
    'var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor)'
  )
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

  it('catches a class that changes the label background or colour (the checker itself)', async () => {
    const cls = renderButton(variant).className
    await expectQuietPaint(cls, variant) // the control passes
    const extras = [
      'hover:bg-(--card-bg)',
      'hover:bg-white/10',
      'hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,transparent)]',
      'hover:bg-(--card-bg)!',
      'hover:not-disabled:bg-(--card-bg)',
      'enabled:hover:bg-(--card-bg)',
      'sm:hover:bg-(--card-bg)',
      'active:bg-(--card-bg)',
      'focus:bg-(--card-bg)',
      'hover:text-(--accent)',
      'hover:opacity-80',
      'hover:brightness-110',
      'hover:bg-none',
      'bg-(--card-bg)',
      'text-red-500',
      'opacity-70',
      'hover:ring-2',
      'hover:inset-ring-4',
      'hover:border-current',
      'hover:border-(--accent)',
      'ring-inset',
      'focus-visible:ring-inset',
      'focus-visible:ring-current',
      'focus-visible:bg-(--card-bg)'
    ]
    const survivors: string[] = []
    for (const extra of extras) {
      const accepted = await expectQuietPaint(`${cls} ${extra}`, variant).then(
        () => true,
        () => false
      )
      if (accepted) survivors.push(extra)
    }
    expect(survivors, 'classes the checker accepted').toEqual([])
    // The cue itself is required, and the right kind and width.
    const ring =
      variant === 'outline' ? 'hover:inset-ring-2' : 'hover:inset-ring-1'
    const without = classTokens(cls)
      .filter((c) => c !== ring)
      .join(' ')
    await expect(
      expectQuietPaint(without, variant),
      'no ring'
    ).rejects.toThrow()
    await expect(
      expectQuietPaint(`${without} hover:ring-1`, variant),
      'outer ring instead of inner'
    ).rejects.toThrow()
    await expect(
      expectQuietPaint(`${without} ${ring}!`, variant),
      'the right ring, but !important'
    ).rejects.toThrow()
    await expect(
      expectQuietPaint(
        `${without} ${variant === 'outline' ? 'hover:inset-ring-1' : 'hover:inset-ring-2'}`,
        variant
      ),
      'wrong ring width'
    ).rejects.toThrow()
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
