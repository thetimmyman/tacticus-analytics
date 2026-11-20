import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { Button } from '@tacticus/ui-kit'
import { allThemes, applyThemeToCSS } from '@/app/lib/theme-system'
import { getContrastRatio } from '@/app/lib/utils/contrast'
import { DeleteConfirmDialog } from '@/app/(dashboard)/leaderboards/components/cluster-management/components/DeleteConfirmDialog'
import { DiscordIntegration } from '@/app/components/discord/DiscordIntegration'

const mockSupabase = vi.hoisted(() => {
  const updates: Array<{ patch: unknown; id: unknown }> = []
  const invite = {
    id: 7,
    invite_code: 'EXAMPLE1',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-02-01T00:00:00Z',
    is_active: true,
    current_uses: 0,
    max_uses: 1
  }
  const read = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.order = () => Promise.resolve({ data: rows, error: null })
    return chain
  }
  const from = vi.fn((table: string) => {
    if (table === 'discord_invite_codes') {
      return {
        select: () => {
          const c = read([invite])
          c.eq = () => c
          return c
        },
        update: (patch: unknown) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ patch, id })
            return Promise.resolve({ error: null })
          }
        })
      }
    }
    // discord_server_guilds and the guild label lookup: nothing linked yet.
    const empty: Record<string, unknown> = {}
    empty.select = () => empty
    empty.eq = () => empty
    empty.in = () => empty
    empty.limit = () => Promise.resolve({ data: [], error: null })
    empty.maybeSingle = () => Promise.resolve({ data: null, error: null })
    ;(empty as { then: unknown }).then = (
      resolve: (v: { data: unknown[]; error: null }) => unknown
    ) => resolve({ data: [], error: null })
    return empty
  })
  return { from, updates }
})

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn(() => mockSupabase)
}))

const root = () => document.documentElement
const tokens = (className: string) => className.split(/\s+/u)

/** The variable a utility such as `hover:bg-(--danger)` reads. */
function tokenOf(className: string, utility: RegExp): string {
  const match = tokens(className).find((c) => utility.test(c))
  const name = match ? /\(--([a-z-]+)\)/u.exec(match) : null
  expect(name, `a token class matching ${utility}`).not.toBeNull()
  return `--${name![1]}`
}

const compile = async (classes: string) => {
  const from = path.resolve('app/globals.css')
  const stylesheet = readFileSync(from, 'utf8').replace(
    /^@source '(?!inline)[^']*';$/gmu,
    ''
  )
  const { css } = await postcss([tailwindcss()]).process(
    `${stylesheet}\n@source inline('${classes}');`,
    { from }
  )
  return postcss.parse(css)
}

type Painted = Record<string, Array<{ source: string; value: string }>>

/**
 * What an element with these classes paints, read from the compiled
 * stylesheet: the utilities that apply at rest, and those that apply only on
 * hover. Each property keeps every class that declares it, so two classes
 * fighting over one property (the winner then depends on stylesheet order)
 * show up as two entries. Viewport media and other pseudo-classes are left out.
 */
async function paint(className: string) {
  const classes = new Set(tokens(className))
  const root = await compile([...classes].join(' '))
  const rest: Painted = {}
  const hover: Painted = {}
  const important: string[] = []
  root.walkRules((rule) => {
    const match = /^\.((?:\\.|[^\\:\s,.])+)(.*)$/u.exec(rule.selector)
    if (!match) return
    const name = match[1]!.replace(/\\(.)/gu, '$1')
    if (!classes.has(name)) return
    let outer: postcss.Container | postcss.Document | undefined = rule.parent
    for (; outer; outer = outer.parent) {
      if (
        outer.type === 'atrule' &&
        /width/u.test((outer as postcss.AtRule).params)
      ) {
        return
      }
    }
    const target = match[2] === '' ? rest : match[2] === ':hover' ? hover : null
    if (!target) return
    for (const node of rule.nodes ?? []) {
      if (node.type !== 'decl') continue
      ;(target[node.prop] ??= []).push({ source: name, value: node.value })
      if (node.important) important.push(`${name}: ${node.prop}`)
    }
  })
  return { rest, hover, important }
}

const only = (painted: Painted, prop: string) => {
  const entries = painted[prop] ?? []
  expect(
    entries.map((e) => e.source),
    `one class sets ${prop}`
  ).toHaveLength(entries.length > 0 ? 1 : 0)
  return entries[0]?.value
}

/** The danger outline as painted: asserted for the variant and each caller. */
async function expectDangerPaint(className: string) {
  const { rest, hover, important } = await paint(className)
  expect(only(rest, 'color')).toBe('var(--text-primary)')
  expect(only(rest, 'background-color')).toBe('transparent')
  expect(only(rest, 'border-color')).toBe('var(--danger)')
  expect(only(rest, 'border-width')).toBe('1px')
  // Nothing dims, blurs or paints over the button at rest.
  for (const prop of ['opacity', 'filter', 'background-image']) {
    expect(rest[prop], `${prop} at rest`).toBeUndefined()
  }
  // Hover changes the fill and the label and nothing else.
  expect(Object.keys(hover).sort()).toEqual(['background-color', 'color'])
  expect(only(hover, 'background-color')).toBe('var(--danger)')
  expect(only(hover, 'color')).toBe('var(--on-danger)')
  // `!important` would let one colour beat the hover pair.
  expect(important).toEqual([])
}

describe('danger button variant', () => {
  beforeEach(() => root().removeAttribute('style'))
  afterEach(cleanup)

  const renderDanger = () => {
    render(<Button variant="danger">Disable</Button>)
    return screen.getByRole('button', { name: 'Disable' })
  }

  it.each(Object.entries(allThemes))(
    '%s: the hover label reaches 4.5:1 on the danger fill it sits on',
    (_code, theme) => {
      applyThemeToCSS(theme)
      const cls = renderDanger().className
      const fill = tokenOf(cls, /^hover:bg-\(--[a-z-]+\)$/u)
      const label = tokenOf(cls, /^hover:text-\(--[a-z-]+\)$/u)

      // The border and the hover fill are one status colour, and the label
      // is the on-fill token set from the colour the theme actually paints.
      expect(fill).toBe('--danger')
      expect(label).toBe('--on-danger')
      expect(tokenOf(cls, /^border-\(--[a-z-]+\)$/u)).toBe(fill)
      const read = (name: string) => root().style.getPropertyValue(name)
      expect(read(fill), `${fill} is set by the theme`).not.toBe('')
      expect(read(label), `${label} is set by the theme`).not.toBe('')
      expect(getContrastRatio(read(label), read(fill))).toBeGreaterThanOrEqual(
        4.5
      )
    }
  )

  it('paints the danger outline and nothing else, at rest and on hover', async () => {
    const cls = renderDanger().className
    await expectDangerPaint(cls)

    const list = tokens(cls)
    // Two fades that run toward opposite ends cross at about 1:1.
    expect(list).toContain('no-transition')
    // A palette colour or an arbitrary value would skip the theme's tokens.
    const palette =
      /^(?:[a-z-]+:)*(?:bg|text|border|ring|outline|from|via|to|fill|stroke)-(?:red|rose|orange|amber|yellow|white|black|slate|gray|zinc|neutral|stone)\b|\[#|\[rgb/u
    expect(list.filter((c) => palette.test(c))).toEqual([])
    // Keyboard focus keeps a visible mark of its own.
    expect(
      list.some((c) => /^focus-visible:(?:ring|outline)-(?!hidden)/u.test(c))
    ).toBe(true)
  })

  it('catches a class that fights the pair (the checker itself)', async () => {
    const cls = renderDanger().className
    for (const extra of [
      'text-red-500',
      'text-(--danger)',
      'hover:text-white',
      'hover:bg-red-100',
      'bg-(--danger)',
      'border-red-500',
      'hover:opacity-60',
      'opacity-70',
      'hover:border-red-500'
    ]) {
      await expect(
        expectDangerPaint(`${cls} ${extra}`),
        extra
      ).rejects.toThrow()
    }
    await expect(
      expectDangerPaint(cls.replace(/(^|\s)border(?=\s|$)/u, ' ')),
      'no border width'
    ).rejects.toThrow()
  })

  it('does not change a disabled button: no hover, half strength, no click', async () => {
    const onClick = vi.fn()
    render(
      <Button variant="danger" disabled onClick={onClick}>
        Disable Guild
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Disable Guild' })
    expect(tokens(button.className)).toEqual(
      expect.arrayContaining([
        'disabled:opacity-50',
        'disabled:pointer-events-none'
      ])
    )
    await userEvent.setup().click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('destructive buttons use the danger variant', () => {
  afterEach(cleanup)

  const dialogProps = (confirmText: string, onConfirm = vi.fn()) => ({
    open: true,
    guildCode: 'EXAMPLE',
    confirmText,
    onOpenChange: () => {},
    onConfirmTextChange: () => {},
    onConfirm,
    onCancel: () => {}
  })

  it('Disable Guild paints the danger outline as its only extra styling', async () => {
    render(<DeleteConfirmDialog {...dialogProps('')} />)
    const button = screen.getByRole('button', { name: 'Disable Guild' })
    await expectDangerPaint(button.className)

    // The caller adds no class of its own: every token is the variant's or
    // the shared size and base, so a colour override cannot sneak in.
    const bare = render(<Button variant="danger">Disable Guild</Button>)
    const reference = tokens(
      within(bare.container).getByRole('button').className
    ).sort()
    expect(tokens(button.className).sort()).toEqual(reference)

    // Cancel stays the neutral outline beside it.
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(tokens(cancel.className)).not.toContain('border-(--danger)')
    expect(tokens(cancel.className)).not.toContain('hover:bg-(--danger)')
  })

  it('Disable Guild stays disabled until the exact phrase is typed, then confirms once', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <DeleteConfirmDialog {...dialogProps('', onConfirm)} />
    )
    for (const typed of [
      '',
      'disable',
      'disable this guil',
      'disable this guild ',
      ' disable this guild',
      'Disable this guild',
      'disable this guildx',
      'disable t'
    ]) {
      rerender(<DeleteConfirmDialog {...dialogProps(typed, onConfirm)} />)
      const button = screen.getByRole('button', { name: 'Disable Guild' })
      expect(button, JSON.stringify(typed)).toBeDisabled()
      await user.click(button)
    }
    expect(onConfirm).not.toHaveBeenCalled()

    rerender(
      <DeleteConfirmDialog {...dialogProps('disable this guild', onConfirm)} />
    )
    const ready = screen.getByRole('button', { name: 'Disable Guild' })
    expect(ready).toBeEnabled()
    await user.click(ready)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Disable Guild says the guild stays in the cluster and points to Leave cluster', () => {
    render(<DeleteConfirmDialog {...dialogProps('')} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('stays in this cluster')
    expect(dialog.textContent).toContain('Leave cluster')
    expect(dialog.textContent).not.toMatch(/permanent|delet/i)
  })

  it('Disable on an invite row paints the danger outline, beside a neutral Copy Code, and still disables that invite', async () => {
    mockSupabase.updates.length = 0
    render(<DiscordIntegration guildCode="EXAMPLE" userRole="leader" />)

    const disable = await screen.findByRole('button', { name: 'Disable' })
    await expectDangerPaint(disable.className)

    // Only layout is added by the caller: same tokens as the bare variant
    // plus the row's width classes.
    const bare = render(
      <Button variant="danger" size="sm">
        Disable
      </Button>
    )
    const reference = tokens(
      within(bare.container).getByRole('button').className
    )
    bare.unmount()
    expect(
      tokens(disable.className)
        .filter((c) => !reference.includes(c))
        .sort()
    ).toEqual(['md:w-auto', 'w-full'])

    const copy = screen.getByRole('button', { name: /Copy Code/u })
    expect(tokens(copy.className)).not.toContain('border-(--danger)')

    await userEvent.setup().click(disable)
    await waitFor(() =>
      expect(mockSupabase.updates).toEqual([
        { patch: { is_active: false }, id: 7 }
      ])
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Disable' })
      ).not.toBeInTheDocument()
    )
  })
})
