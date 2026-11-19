// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import postcss, { type Root } from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import { Badge, type BadgeVariant } from '@tacticus/ui-kit'
import { Card, CardDescription, CardTitle } from '@tacticus/ui-kit/card'
import { RadixSwitch } from '@tacticus/ui-kit/radix-switch'

/**
 * Shared primitives must only render utilities that the application's own
 * stylesheet defines. A class the theme never generated renders nothing, so a
 * switch thumb or a status pill silently disappears; this test compiles the
 * real stylesheet and checks what each primitive actually emits.
 */

// Marker classes carry no declarations of their own.
const MARKER_CLASSES = new Set(['peer', 'group'])

const BADGE_VARIANTS: BadgeVariant[] = [
  'default',
  'secondary',
  'success',
  'warning',
  'destructive'
]

function classTokens(markup: string): string[] {
  const tokens = new Set<string>()
  for (const match of markup.matchAll(/class="([^"]*)"/gu)) {
    for (const token of (match[1] ?? '').split(/\s+/u)) {
      if (token && !MARKER_CLASSES.has(token)) tokens.add(token)
    }
  }
  return [...tokens]
}

function selectorFor(token: string): string {
  return `.${token.replace(/[^a-zA-Z0-9_-]/gu, '\\$&')}`
}

/** Declarations of every rule whose selector starts with this class token. */
function declarationsFor(
  root: Root,
  token: string,
  selectorPart = ''
): string[] {
  const needle = selectorFor(token)
  const found: string[] = []
  root.walkRules((rule) => {
    const matches = rule.selectors.some(
      (selector) =>
        selector.startsWith(needle) &&
        (selector.length === needle.length ||
          !/[a-zA-Z0-9_-]/u.test(selector.charAt(needle.length))) &&
        selector.includes(selectorPart)
    )
    if (!matches) return
    rule.walkDecls((decl) => {
      found.push(`${decl.prop}: ${decl.value}`)
    })
  })
  return found
}

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string[] {
  return classTokens(renderToStaticMarkup(element))
}

function markup(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
}

const rendered = {
  switchChecked: markup(createElement(RadixSwitch, { checked: true })),
  switchUnchecked: markup(createElement(RadixSwitch, { checked: false })),
  badges: BADGE_VARIANTS.map((variant) => ({
    variant,
    markup: markup(createElement(Badge, { variant }, 'Ready'))
  })),
  card: markup(
    createElement(
      Card,
      null,
      createElement(CardTitle, null, 'Title'),
      createElement(CardDescription, null, 'Description')
    )
  )
}

const allTokens = [
  ...new Set([
    ...classTokens(rendered.switchChecked),
    ...classTokens(rendered.switchUnchecked),
    ...rendered.badges.flatMap((badge) => classTokens(badge.markup)),
    ...classTokens(rendered.card)
  ])
]

let stylesheet: Root

beforeAll(async () => {
  const from = path.resolve('app/globals.css')
  // Only the classes below feed the build, as in tailwind-v4.test.ts.
  const source = readFileSync(from, 'utf8').replace(
    /^@source '(?!inline)[^']*';$/gmu,
    ''
  )
  const input = `${source}\n@source inline('${allTokens.join(' ')}');`
  const { css } = await postcss([tailwindcss()]).process(input, { from })
  stylesheet = postcss.parse(css)
}, 60_000)

describe('shared primitives render only utilities the stylesheet defines', () => {
  it('resolves every class on the switch, in both states', () => {
    const missing = [
      ...render(createElement(RadixSwitch, { checked: true })),
      ...render(createElement(RadixSwitch, { checked: false }))
    ].filter((token) => declarationsFor(stylesheet, token).length === 0)

    expect(missing).toEqual([])
  })

  it('resolves every class on every badge variant', () => {
    const missing = rendered.badges
      .flatMap((badge) => classTokens(badge.markup))
      .filter((token) => declarationsFor(stylesheet, token).length === 0)

    expect(missing).toEqual([])
  })

  it('resolves every class on the card, its title and its description', () => {
    const missing = classTokens(rendered.card).filter(
      (token) => declarationsFor(stylesheet, token).length === 0
    )

    expect(missing).toEqual([])
  })
})

describe('switch', () => {
  it.each(['checked', 'unchecked'] as const)(
    'paints a visible thumb when %s',
    (state) => {
      const html =
        state === 'checked' ? rendered.switchChecked : rendered.switchUnchecked
      const thumb =
        /<span[^>]*class="([^"]*)"[^>]*data-state="[a-z]+"|<span[^>]*data-state="[a-z]+"[^>]*class="([^"]*)"/u.exec(
          html
        )
      const thumbClasses = (thumb?.[1] ?? thumb?.[2] ?? '').split(/\s+/u)
      const painted = thumbClasses.flatMap((token) =>
        declarationsFor(stylesheet, token, `[data-state="${state}"]`)
      )

      expect(painted.some((line) => line.startsWith('background-color:'))).toBe(
        true
      )
    }
  )

  it('outlines the unchecked track so the control keeps a visible boundary', () => {
    const track = /<button[^>]*class="([^"]*)"/u.exec(rendered.switchUnchecked)
    const outlined = (track?.[1] ?? '')
      .split(/\s+/u)
      .flatMap((token) =>
        declarationsFor(stylesheet, token, '[data-state="unchecked"]')
      )

    expect(outlined.some((line) => line.startsWith('border-color:'))).toBe(true)
  })

  it('keeps focus offset on the page background token', () => {
    const track = /<button[^>]*class="([^"]*)"/u.exec(rendered.switchChecked)
    const offsetTokens = (track?.[1] ?? '')
      .split(/\s+/u)
      .filter((token) => /ring-offset-(?!\d)/u.test(token))

    expect(offsetTokens.length).toBeGreaterThan(0)
    for (const token of offsetTokens) {
      expect(declarationsFor(stylesheet, token).join(' ')).toContain(
        '--bg-primary'
      )
    }
  })
})

describe('badge', () => {
  const looks = () =>
    BADGE_VARIANTS.map((variant) => {
      const entry = rendered.badges.find((badge) => badge.variant === variant)
      const declarations = classTokens(entry?.markup ?? '').flatMap((token) =>
        declarationsFor(stylesheet, token)
      )
      return {
        variant,
        background: declarations.filter((line) =>
          line.startsWith('background-color:')
        ),
        border: declarations.filter((line) => line.startsWith('border-color:'))
      }
    })

  it('gives every variant a resolved border and every tinted variant a background', () => {
    for (const look of looks()) {
      expect(look.border, `${look.variant} border`).not.toHaveLength(0)
      if (look.variant !== 'default') {
        expect(look.background, `${look.variant} background`).not.toHaveLength(
          0
        )
      }
    }
  })

  it('renders every variant differently, so a status never reads as another', () => {
    const signatures = looks().map((look) =>
      JSON.stringify([look.background, look.border])
    )

    expect(new Set(signatures).size).toBe(BADGE_VARIANTS.length)
  })
})

describe('shared primitive sources', () => {
  it('name no shadcn-style colour the theme never defined', () => {
    // The theme defines text-muted-foreground by hand; nothing else of this family.
    const undefinedFamily =
      /(?<![\w-])(?:[a-z-]*:)*(?:bg|text|ring-offset|border)-(?:background|foreground|popover|muted|destructive|card-foreground|[a-z]+-foreground)(?![\w-])/gu
    const offenders: string[] = []
    const dir = path.resolve('packages/ui-kit/src')
    for (const file of readdirSync(dir)) {
      if (!/\.(tsx?|ts)$/u.test(file)) continue
      const source = readFileSync(path.join(dir, file), 'utf8')
      for (const match of source.matchAll(undefinedFamily)) {
        if (match[0].endsWith('text-muted-foreground')) continue
        offenders.push(`${file}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
