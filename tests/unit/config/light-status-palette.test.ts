// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss, { type AtRule, type Root, type Rule } from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { beforeAll, describe, expect, it } from 'vitest'
import { specialThemes } from '@/app/lib/themes/definitions'

/**
 * The 200-400 tiers of the status and accent hues are tuned for dark surfaces
 * and are used as text roughly 1,500 times. On the light theme they fail
 * WCAG 1.4.3 (red-400 on white is 2.8:1), so the stylesheet resolves each of
 * them with light-dark() against the page's color-scheme. These checks compile
 * the real stylesheet and hold the result to the contrast the light theme
 * needs, and to Tailwind's own values on dark themes.
 */

const HUES = [
  'red',
  'green',
  'yellow',
  'amber',
  'orange',
  'emerald',
  'blue',
  'sky',
  'purple',
  'cyan'
] as const
const TIERS = ['200', '300', '400'] as const
const NAMES = HUES.flatMap((hue) => TIERS.map((tier) => `${hue}-${tier}`))

const AA_TEXT = 4.5

type Rgb = [number, number, number]

/** OKLCH (as written in Tailwind's palette) to linear sRGB, clipped to gamut. */
function oklchToLinear(value: string): Rgb {
  const match =
    /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/u.exec(value.trim()) ?? []
  const [lightness, chroma, hue] = [match[1], match[2], match[3]].map(Number)
  if (
    lightness === undefined ||
    chroma === undefined ||
    hue === undefined ||
    [lightness, chroma, hue].some(Number.isNaN)
  ) {
    throw new Error(`Not an oklch() colour: ${value}`)
  }
  const l = lightness / 100
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (channel: number) => Math.min(1, Math.max(0, channel))
  return [
    clip(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    clip(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    clip(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)
  ]
}

function hexToLinear(hex: string): Rgb {
  const channel = (start: number) => {
    const c = parseInt(hex.slice(start, start + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [channel(1), channel(3), channel(5)]
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/** Linear-light mix, as a translucent layer over an opaque surface. */
function over(layer: Rgb, surface: Rgb, alpha: number): Rgb {
  return layer.map((c, i) => alpha * c + (1 - alpha) * (surface[i] ?? 0)) as Rgb
}

/** The light theme's own surfaces: its page gradient stops and its card. */
const lightTheme = specialThemes.light
const SURFACES: Record<string, Rgb> = {
  'page from': hexToLinear(lightTheme?.background.from ?? '#ffffff'),
  'page via': hexToLinear(lightTheme?.background.via ?? '#ffffff'),
  'page to': hexToLinear(lightTheme?.background.to ?? '#ffffff'),
  white: hexToLinear('#ffffff')
}

function compile(optimize: boolean): Promise<Root> {
  const from = path.resolve('app/globals.css')
  // Only the classes below feed the build, as in tailwind-v4.test.ts.
  const source = readFileSync(from, 'utf8').replace(
    /^@source '(?!inline)[^']*';$/gmu,
    ''
  )
  const tokens = [...NAMES.map((name) => `text-${name}`), 'scheme-dark']
  const input = `${source}\n@source inline('${tokens.join(' ')}');`
  return postcss([tailwindcss({ optimize })])
    .process(input, { from })
    .then(({ css }) => postcss.parse(css))
}

function lightDarkPairs(
  root: Root
): Map<string, { light: string; dark: string }> {
  const pairs = new Map<string, { light: string; dark: string }>()
  root.walkAtRules('supports', (supports: AtRule) => {
    if (!supports.params.includes('light-dark(')) return
    supports.walkRules(':root', (rule: Rule) => {
      rule.walkDecls(/^--color-/u, (decl) => {
        const pair =
          /^light-dark\(\s*(oklch\([^)]*\))\s*,\s*(oklch\([^)]*\))\s*\)$/u.exec(
            decl.value.trim()
          )
        if (pair?.[1] && pair[2]) {
          pairs.set(decl.prop.replace('--color-', ''), {
            light: pair[1],
            dark: pair[2]
          })
        }
      })
    })
  })
  return pairs
}

function tailwindDefaults(root: Root): Map<string, string> {
  const defaults = new Map<string, string>()
  root.walkAtRules('layer', (layer) => {
    if (layer.params !== 'theme') return
    layer.walkDecls(/^--color-/u, (decl) => {
      defaults.set(decl.prop.replace('--color-', ''), decl.value.trim())
    })
  })
  return defaults
}

let stylesheet: Root
let pairs: Map<string, { light: string; dark: string }>
let defaults: Map<string, string>

beforeAll(async () => {
  stylesheet = await compile(false)
  pairs = lightDarkPairs(stylesheet)
  defaults = tailwindDefaults(stylesheet)
}, 60_000)

describe('status and accent palette under color-scheme', () => {
  it('covers every hue and tier the application uses as text', () => {
    expect([...pairs.keys()].sort()).toEqual([...NAMES].sort())
  })

  it('keeps Tailwind own values on dark themes', () => {
    const drifted = NAMES.filter(
      (name) => pairs.get(name)?.dark !== defaults.get(name)
    )

    expect(drifted).toEqual([])
  })

  it.each(NAMES)('%s reads at 4.5:1 or better on the light theme', (name) => {
    const light = oklchToLinear(pairs.get(name)?.light ?? '')
    const failing = Object.entries(SURFACES)
      .map(([surface, rgb]) => ({ surface, ratio: contrast(light, rgb) }))
      .filter(({ ratio }) => ratio < AA_TEXT)

    expect(failing).toEqual([])
  })

  it.each(NAMES)(
    '%s reads at 4.5:1 or better on a 10-20% tint of its own hue',
    (name) => {
      const light = oklchToLinear(pairs.get(name)?.light ?? '')
      const failing = Object.entries(SURFACES).flatMap(([surface, rgb]) =>
        [0.1, 0.2].map((alpha) => ({
          surface: `${surface} + ${alpha * 100}% tint`,
          ratio: contrast(light, over(light, rgb, alpha))
        }))
      )

      expect(failing.filter(({ ratio }) => ratio < AA_TEXT)).toEqual([])
    }
  )

  it('is gated on light-dark() support so older browsers keep the palette', () => {
    const gate = [] as string[]
    stylesheet.walkAtRules('supports', (supports) => {
      if (supports.params.includes('light-dark(')) gate.push(supports.params)
    })

    expect(gate).toEqual(['(color: light-dark(white, black))'])
  })

  it('resolves each tier lighter on dark themes than on the light theme', () => {
    const inverted = NAMES.filter((name) => {
      const pair = pairs.get(name)
      return (
        !pair ||
        luminance(oklchToLinear(pair.dark)) <=
          luminance(oklchToLinear(pair.light))
      )
    })

    expect(inverted).toEqual([])
  })
})

describe('color-scheme follows the theme', () => {
  const declarationsOf = (selector: string, prop: string): string[] => {
    const found: string[] = []
    stylesheet.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return
      rule.walkDecls(prop, (decl) => {
        found.push(decl.value)
      })
    })
    return found
  }

  it('defaults to dark, so dark and guild themes keep the dark palette', () => {
    expect(declarationsOf(':root', 'color-scheme')).toContain('dark')
  })

  it('switches to light for the light theme', () => {
    expect(declarationsOf("html[data-theme='light']", 'color-scheme')).toEqual([
      'light'
    ])
  })

  it('leaves color-scheme to globals.css and applyThemeToCSS', () => {
    // An un-layered rule would beat the layered, theme-specific ones.
    const autofill = readFileSync(
      path.resolve('app/styles/form-autofill.css'),
      'utf8'
    )

    expect(autofill.replace(/\/\*[\s\S]*?\*\//gu, '')).not.toContain(
      'color-scheme'
    )
  })

  it('lets a surface that stays dark opt back in with scheme-dark', () => {
    expect(declarationsOf('.scheme-dark', 'color-scheme')).toEqual(['dark'])
  })
})

describe('production build', () => {
  it('keeps the palette as light-dark() custom properties behind the gate', async () => {
    const optimized = await compile(true)
    const optimizedPairs = new Map<string, string>()
    optimized.walkAtRules('supports', (supports) => {
      if (!supports.params.includes('light-dark(')) return
      supports.walkDecls(/^--color-/u, (decl) => {
        if (decl.value.startsWith('light-dark(')) {
          optimizedPairs.set(decl.prop.replace('--color-', ''), decl.value)
        }
      })
    })

    expect([...optimizedPairs.keys()].sort()).toEqual([...NAMES].sort())
  }, 60_000)
})
