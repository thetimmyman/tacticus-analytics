// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss, { type Document, type Root, type Rule } from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  allThemes,
  guildThemes,
  specialThemes
} from '@/app/lib/themes/definitions'
import { getContrastRatio } from '@/app/lib/utils/contrast'

/**
 * Guards the Light Mode dark-surface token reset on `.scheme-dark` islands.
 * Ensures text, accent, and semantic tokens keep >= 4.5:1 contrast on dark
 * panels without altering Dark Mode or any guild theme.
 */

const AA_TEXT = 4.5

const DARK_SURFACES: Record<string, string> = {
  black: '#000000',
  'gray-900': '#111827',
  'dark-drawer': '#171a1f',
  'dark-card': '#1e293b'
}

const TEXT_AND_ACCENT_TOKENS = [
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-tertiary',
  '--text-accent',
  '--accent',
  '--accent-primary',
  '--accent-wh40k',
  '--primary',
  '--primary-wh40k',
  '--input-text',
  '--warning',
  '--warning-text',
  '--success',
  '--danger',
  '--error',
  '--info',
  '--chart-text',
  '--chart-axis'
] as const

const FILL_LABEL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--primary', '--on-primary'],
  ['--secondary', '--on-secondary'],
  ['--accent', '--on-accent'],
  ['--danger', '--on-danger'],
  ['--warning', '--on-warning']
]

const REQUIRED_SURFACE_TOKENS = [
  '--bg-primary',
  '--card-bg',
  '--card-bg-rgb',
  '--card-border',
  '--card-border-rgb',
  '--input-bg',
  '--input-border',
  '--hover-bg'
] as const

const LIGHT_DARK_SURFACE_SELECTORS = [
  ":root[data-theme='light'] .scheme-dark",
  "[data-theme='light'] .scheme-dark",
  '.light-theme .scheme-dark'
] as const

function compile(optimize: boolean): Promise<Root> {
  const from = path.resolve('app/globals.css')
  const source = readFileSync(from, 'utf8').replace(
    /^@source '(?!inline)[^']*';$/gmu,
    ''
  )
  const tokens = [
    'scheme-dark',
    'text-primary-wh40k',
    'text-secondary-wh40k',
    'text-accent-wh40k',
    'text-slate-950'
  ]
  const input = `${source}\n@source inline('${tokens.join(' ')}');`
  return postcss([tailwindcss({ optimize })])
    .process(input, { from })
    .then(({ css }) => postcss.parse(css))
}

function parentLayerOf(rule: Rule): string | null {
  let node: Rule['parent'] | Document = rule.parent
  while (node) {
    if (node.type === 'atrule' && node.name === 'layer') {
      return node.params.trim()
    }
    node = node.parent
  }
  return null
}

function isLightSchemeDarkSelector(selector: string): boolean {
  const normalized = selector.replace(/"/gu, "'").trim()
  return (
    normalized === ":root[data-theme='light'] .scheme-dark" ||
    normalized === "[data-theme='light'] .scheme-dark" ||
    normalized === '.light-theme .scheme-dark'
  )
}

function collectResetVars(root: Root): Map<string, string> {
  const vars = new Map<string, string>()
  root.walkRules((rule) => {
    if (!rule.selectors.some(isLightSchemeDarkSelector)) return
    rule.walkDecls(/^--/u, (decl) => {
      vars.set(decl.prop, decl.value.trim())
    })
  })
  return vars
}

function collectRootDefaults(root: Root): Map<string, string> {
  const vars = new Map<string, string>()
  root.walkRules((rule) => {
    if (!rule.selectors.includes(':root')) return
    rule.walkDecls(/^--/u, (decl) => {
      if (!vars.has(decl.prop)) {
        vars.set(decl.prop, decl.value.trim())
      }
    })
  })
  return vars
}

let stylesheet: Root
let resetVars: Map<string, string>
let rootDefaults: Map<string, string>

beforeAll(async () => {
  stylesheet = await compile(false)
  resetVars = collectResetVars(stylesheet)
  rootDefaults = collectRootDefaults(stylesheet)
}, 60_000)

describe('Light Mode dark-surface token reset', () => {
  it('defines the token reset for all light-mode .scheme-dark selectors', () => {
    const matchedSelectors = new Set<string>()
    stylesheet.walkRules((rule) => {
      let hasTextPrimary = false
      rule.walkDecls('--text-primary', () => {
        hasTextPrimary = true
      })
      if (!hasTextPrimary) return
      for (const selector of rule.selectors) {
        matchedSelectors.add(selector.replace(/"/gu, "'").trim())
      }
    })

    for (const selector of LIGHT_DARK_SURFACE_SELECTORS) {
      expect(matchedSelectors.has(selector)).toBe(true)
    }
  })

  it('resets surface, border, and input tokens alongside text tokens', () => {
    for (const token of REQUIRED_SURFACE_TOKENS) {
      expect(resetVars.get(token), `${token} is reset`).toBeTruthy()
    }
  })

  it.each(TEXT_AND_ACCENT_TOKENS)(
    '%s clears WCAG AA (>= 4.5:1) against dark surfaces',
    (token) => {
      const value = resetVars.get(token)
      expect(value, `${token} is defined as a hex color`).toMatch(
        /^#[0-9a-fA-F]{6}$/u
      )

      const failing = Object.entries(DARK_SURFACES)
        .map(([surface, bg]) => ({
          surface,
          ratio: getContrastRatio(value!, bg)
        }))
        .filter(({ ratio }) => ratio < AA_TEXT)

      expect(failing).toEqual([])
    }
  )

  it.each(FILL_LABEL_PAIRS)(
    '%s and %s pair maintains >= 4.5:1 contrast inside dark surfaces',
    (fillToken, labelToken) => {
      const fill = resetVars.get(fillToken)
      const label = resetVars.get(labelToken)
      expect(fill).toMatch(/^#[0-9a-fA-F]{6}$/u)
      expect(label).toMatch(/^#[0-9a-fA-F]{6}$/u)
      expect(getContrastRatio(label!, fill!)).toBeGreaterThanOrEqual(AA_TEXT)
    }
  )

  it('resets inherited body text color in @layer base so Tailwind text-* utilities still win', () => {
    const layers: Array<string | null> = []
    stylesheet.walkRules((rule) => {
      if (!rule.selectors.some(isLightSchemeDarkSelector)) return
      rule.walkDecls('color', (decl) => {
        expect(decl.value.trim()).toBe('var(--text-primary)')
        layers.push(parentLayerOf(rule))
      })
    })

    expect(layers.length).toBeGreaterThan(0)
    expect(layers.every((layer) => layer === 'base')).toBe(true)
  })

  it('matches :root dark-mode defaults for core text and accent tokens', () => {
    for (const token of [
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--text-accent',
      '--accent',
      '--primary'
    ]) {
      expect(resetVars.get(token)).toBe(rootDefaults.get(token))
    }
  })
})

describe('Dark Mode and guild themes remain unaffected', () => {
  it('never targets dark mode or guild themes in the token reset rules', () => {
    const nonLightThemes = Object.keys(allThemes).filter(
      (code) => code !== 'light'
    )
    expect(Object.keys(guildThemes).length).toBeGreaterThan(0)
    expect(nonLightThemes.length).toBeGreaterThanOrEqual(60)

    const nonLightSelectors: string[] = []
    stylesheet.walkRules((rule) => {
      const touchesSchemeDark = rule.selectors.some((sel) =>
        sel.includes('.scheme-dark')
      )
      if (!touchesSchemeDark) return

      let setsCustomProps = false
      rule.walkDecls(/^--/u, () => {
        setsCustomProps = true
      })
      if (!setsCustomProps) return

      for (const selector of rule.selectors) {
        if (!isLightSchemeDarkSelector(selector)) {
          nonLightSelectors.push(selector)
        }
      }
    })

    expect(nonLightSelectors).toEqual([])
  })

  it('keeps Dark Mode and every guild theme outside the light-mode attribute', () => {
    expect(specialThemes.dark).toBeDefined()
    expect(specialThemes.light).toBeDefined()
    expect(Object.keys(guildThemes)).not.toContain('light')
    expect(Object.keys(guildThemes)).not.toContain('dark')
  })

  it('preserves the dark-surface reset through production CSS optimization', async () => {
    const optimized = await compile(true)
    const optimizedVars = collectResetVars(optimized)

    for (const token of TEXT_AND_ACCENT_TOKENS) {
      expect(optimizedVars.get(token), `${token} survives optimization`).toBe(
        resetVars.get(token)
      )
    }
  }, 60_000)
})
