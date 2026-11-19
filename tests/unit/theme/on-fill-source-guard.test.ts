// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const FILL_VARS =
  'primary|secondary|accent|primary-wh40k|secondary-wh40k|accent-wh40k'
// A fill is opaque, or a mix that keeps at least 70% of the theme colour.
const FILL = new RegExp(
  String.raw`^bg-(?:(?:primary|secondary|accent)-wh40k|\(--(?:${FILL_VARS})\)|\[var\(--(?:${FILL_VARS})\)\])(?:/(?:[7-9]\d|100))?$|^bg-\[color-mix\(in_srgb,var\(--(?:primary|secondary|accent)\)_(?:[7-9]\d|100)%,transparent\)\]$`,
  'u'
)
// --accent-primary is the unoverridden accent: not the colour --on-accent is for.
const ACCENT_PRIMARY_FILL =
  /^bg-(?:\(--accent-primary\)|\[var\(--accent-primary\)\])(?:\/\d+)?$/u
const GRADIENT_FILL =
  /^(?:from|via|to)-(?:\(--(?:primary|secondary|accent)\)|\[var\(--(?:primary|secondary|accent)\)\])$/u
const ON_LABEL =
  /^text-(?:on-(?:primary|secondary|accent)-wh40k|\(--on-(?:primary|secondary|accent)\))$/u
const FIXED_LABEL = new RegExp(
  String.raw`^text-(?:(?:white|black)(?:/\d+)?|\((?:--bg-primary|--accent-foreground)\)|\[var\(--(?:bg-primary|accent-foreground)\)\]|\[#[0-9a-f]{3,8}\]|\[(?:black|white)\]|(?:gray|slate|zinc|neutral|stone)-\d+)$`,
  'iu'
)

// A primary-to-accent gradient takes its stops and label from the --cta-*
// tokens: no single label reads on both raw theme colours. The label was
// chosen by sampling the sRGB path, so the gradient must be painted in sRGB.
const CTA_STOP = /^(?:from|via|to)-\(--cta-(?:from|to)\)$/u
const SRGB_GRADIENT = /^bg-linear-(?:to-(?:t|b|l|r|tl|tr|bl|br)|\d+)\/srgb$/u
const ON_CTA = /^text-(?:on-cta-wh40k|\(--on-cta\))$/u
// Any text colour: not a size, alignment, wrapping or transparent utility.
const TEXT_COLOUR =
  /^text-(?!transparent$|(?:xs|sm|base|lg|xl|[2-9]xl|2xs)$|(?:left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$|\[\d)/u

const CLASS_HELPERS = new Set([
  'clsx',
  'cn',
  'twMerge',
  'twJoin',
  'classNames',
  'cx'
])
const CAP = 256

interface Token {
  prefix: string
  utility: string
}

/** Splits `hover:data-[state=active]:bg-x` at the last colon outside brackets. */
function tokens(text: string): Token[] {
  return text
    .split(/\s+/u)
    .filter(Boolean)
    .map((raw) => {
      let depth = 0
      let cut = -1
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i]
        if (c === '[' || c === '(') depth++
        else if (c === ']' || c === ')') depth--
        else if (c === ':' && depth === 0) cut = i
      }
      // `!text-black` and `text-black!` are the same utility, made important.
      return {
        prefix: raw.slice(0, cut + 1),
        utility: raw.slice(cut + 1).replace(/^!|!$/gu, '')
      }
    })
}

/** Does a label under variant `q` apply while a fill under variant `p` is painted? */
const applies = (p: string, q: string): boolean =>
  q === '' || p === '' || p === q

type Verdict =
  'ok' | 'fixed-label' | 'accent-primary' | 'gradient' | 'cta-space'

function judge(text: string): Verdict {
  const toks = tokens(text)
  const fills = toks.filter((t) => FILL.test(t.utility))
  const fixed = toks.filter((t) => FIXED_LABEL.test(t.utility))
  const on = toks.filter((t) => ON_LABEL.test(t.utility))
  // A variant's own on-label beats a plain label (`text-white data-[x]:bg-a data-[x]:text-on-a`).
  const conflicts = fills.some((f) =>
    fixed.some(
      (x) =>
        applies(f.prefix, x.prefix) &&
        !(
          x.prefix === '' &&
          f.prefix !== '' &&
          on.some((o) => o.prefix === f.prefix)
        )
    )
  )
  if (conflicts) return 'fixed-label'
  if (
    toks.some((t) => ACCENT_PRIMARY_FILL.test(t.utility)) &&
    (on.length > 0 || fixed.length > 0)
  ) {
    return 'accent-primary'
  }
  const labels = toks.filter((t) => TEXT_COLOUR.test(t.utility))
  // Raw theme stops have no label that reads on both ends (not even --on-cta,
  // which was chosen for the --cta-* stops), and a --cta-* gradient takes
  // only --on-cta.
  if (toks.some((t) => GRADIENT_FILL.test(t.utility)) && labels.length > 0)
    return 'gradient'
  if (
    toks.some((t) => CTA_STOP.test(t.utility)) &&
    labels.some((t) => !ON_CTA.test(t.utility))
  )
    return 'gradient'
  if (
    toks.some((t) => CTA_STOP.test(t.utility)) &&
    !toks.some((t) => t.prefix === '' && SRGB_GRADIENT.test(t.utility))
  )
    return 'cta-space'
  return 'ok'
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') yield* sourceFiles(full)
    } else if (
      /\.tsx?$/u.test(entry.name) &&
      !/\.stories\./u.test(entry.name)
    ) {
      yield full
    }
  }
}

const ROOTS = [
  'app',
  ...readdirSync('packages', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join('packages', e.name, 'src'))
    .filter((dir) => {
      try {
        return readdirSync(dir).length > 0
      } catch {
        return false
      }
    })
]

function join(a: string[], b: string[]): string[] {
  const out: string[] = []
  for (const x of a) for (const y of b) out.push(`${x} ${y}`)
  return out.slice(0, CAP)
}

interface Findings {
  fixed: string[]
  accentPrimary: string[]
  gradient: string[]
  ctaSpace: string[]
  inline: string[]
}

function scan(file: string, found: Findings): void {
  const source = readFileSync(file, 'utf8')
  if (!/bg-|--primary|--accent|--secondary|from-|to-/u.test(source)) return
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const where = (n: ts.Node): string =>
    `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`

  // `const base = 'bg-accent-wh40k'` followed by `${base} text-white`.
  const consts = new Map<string, string>()
  const collect = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isStringLiteralLike(n.initializer)
    ) {
      consts.set(n.name.text, n.initializer.text)
    }
    ts.forEachChild(n, collect)
  }
  collect(sf)

  /** Every class string an expression can produce (branches kept apart). */
  const variants = (node: ts.Node | undefined): string[] => {
    if (!node) return ['']
    if (ts.isStringLiteralLike(node)) return [node.text]
    if (ts.isIdentifier(node)) return [consts.get(node.text) ?? '']
    if (ts.isTemplateExpression(node)) {
      let acc = [node.head.text]
      for (const span of node.templateSpans) {
        acc = join(acc, variants(span.expression)).map(
          (v) => `${v}${span.literal.text}`
        )
      }
      return acc
    }
    if (ts.isConditionalExpression(node)) {
      return [...variants(node.whenTrue), ...variants(node.whenFalse)].slice(
        0,
        CAP
      )
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken)
        return ['', ...variants(node.right)]
      if (
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return [...variants(node.left), ...variants(node.right)].slice(0, CAP)
      }
      if (op === ts.SyntaxKind.PlusToken)
        return join(variants(node.left), variants(node.right))
      return ['']
    }
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isJsxExpression(node)
    ) {
      return variants(node.expression)
    }
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        CLASS_HELPERS.has(node.expression.text)
      ) {
        return node.arguments.reduce<string[]>(
          (acc, arg) => join(acc, variants(arg)),
          ['']
        )
      }
      // ['bg-accent-wh40k', 'text-white'].join(' ')
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'join'
      ) {
        return variants(node.expression.expression)
      }
      return ['']
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.reduce<string[]>(
        (acc, el) => join(acc, variants(el)),
        ['']
      )
    }
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.reduce<string[]>(
        (acc, prop) => {
          const key =
            ts.isPropertyAssignment(prop) &&
            (ts.isStringLiteralLike(prop.name) || ts.isIdentifier(prop.name))
              ? prop.name.text
              : ''
          return join(acc, ['', key])
        },
        ['']
      )
    }
    return ['']
  }

  const check = (n: ts.Node, text: string): void => {
    const verdict = judge(text)
    if (verdict === 'fixed-label')
      found.fixed.push(
        `${where(n)}: ${text.replace(/\s+/gu, ' ').slice(0, 110)}`
      )
    else if (verdict === 'accent-primary')
      found.accentPrimary.push(
        `${where(n)}: ${text.replace(/\s+/gu, ' ').slice(0, 110)}`
      )
    else if (verdict === 'gradient')
      found.gradient.push(
        `${where(n)}: ${text.replace(/\s+/gu, ' ').slice(0, 110)}`
      )
    else if (verdict === 'cta-space')
      found.ctaSpace.push(
        `${where(n)}: ${text.replace(/\s+/gu, ' ').slice(0, 110)}`
      )
  }

  const visit = (node: ts.Node, rootStart: number | undefined): void => {
    const inClassRoot = rootStart !== undefined
    let nested = rootStart
    // A single class string, wherever it lives (maps, constants, props).
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      check(node, node.text)
    }
    // A className attribute or clsx()/cn() call: a fill and its label can sit in separate pieces.
    const isRoot =
      !inClassRoot &&
      ((ts.isJsxAttribute(node) &&
        ts.isIdentifier(node.name) &&
        (node.name.text === 'className' || node.name.text === 'class')) ||
        (ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          CLASS_HELPERS.has(node.expression.text)))
    if (isRoot) {
      const expr = ts.isJsxAttribute(node) ? node.initializer : node
      for (const v of variants(expr)) check(node, v)
      nested = node.getStart(sf)
    }
    // Inline styles: a theme background with a label that is not an --on-* token.
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'style'
    ) {
      const obj =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : undefined
      if (obj && ts.isObjectLiteralExpression(obj)) {
        const get = (name: string): string | undefined => {
          const p = obj.properties.find(
            (q): q is ts.PropertyAssignment =>
              ts.isPropertyAssignment(q) &&
              ts.isIdentifier(q.name) &&
              q.name.text === name
          )
          return p && ts.isStringLiteralLike(p.initializer)
            ? p.initializer.text
            : undefined
        }
        const bg = get('backgroundColor') ?? get('background')
        const color = get('color')
        if (
          bg &&
          /^var\(--(?:primary|secondary|accent|accent-primary|primary-wh40k|secondary-wh40k|accent-wh40k)\)$/u.test(
            bg
          ) &&
          color &&
          !color.startsWith('var(--on-')
        ) {
          found.inline.push(`${where(node)}: ${bg} with ${color}`)
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nested))
  }
  visit(sf, undefined)
}

const found: Findings = {
  fixed: [],
  accentPrimary: [],
  gradient: [],
  ctaSpace: [],
  inline: []
}
for (const root of ROOTS)
  for (const file of sourceFiles(root)) scan(file, found)

describe('judging a class string', () => {
  it.each([
    ['bg-accent-wh40k text-white', 'fixed-label'],
    ['bg-accent-wh40k text-gray-900', 'fixed-label'],
    ['bg-accent-wh40k/90 text-white', 'fixed-label'],
    [
      'bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] text-white',
      'fixed-label'
    ],
    ['bg-[var(--accent-wh40k)] text-white', 'fixed-label'],
    ['bg-accent-wh40k hover:text-white', 'fixed-label'],
    ['bg-accent-wh40k text-(--bg-primary)', 'fixed-label'],
    ['bg-(--accent-primary) text-on-accent-wh40k', 'accent-primary'],
    ['bg-linear-to-r from-(--primary) to-(--accent) text-white', 'gradient'],
    [
      'bg-linear-to-r from-(--primary) to-(--accent) text-on-primary-wh40k',
      'gradient'
    ],
    [
      'bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-white',
      'gradient'
    ],
    [
      'bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-on-accent-wh40k',
      'gradient'
    ],
    [
      'bg-linear-to-r from-(--cta-from) to-(--cta-to) text-on-cta-wh40k',
      'cta-space'
    ],
    [
      'bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-on-cta-wh40k',
      'ok'
    ],
    [
      'bg-linear-to-br/srgb from-(--cta-from) to-(--cta-to) hover:from-(--cta-to) hover:to-(--cta-from) text-on-cta-wh40k',
      'ok'
    ],
    [
      'bg-linear-to-r from-(--primary) to-(--accent) bg-clip-text text-transparent',
      'ok'
    ],
    [
      'bg-linear-to-r from-(--primary) to-(--accent) text-on-cta-wh40k',
      'gradient'
    ],
    [
      'bg-linear-to-r from-(--primary) to-(--accent) text-(--text-primary)',
      'gradient'
    ],
    ['bg-linear-to-r from-[var(--primary)] to-blue-500 text-black', 'gradient'],
    ['bg-linear-to-r from-(--primary) to-(--accent) text-white!', 'gradient'],
    ['bg-linear-to-r from-(--primary) to-(--accent) !text-black', 'gradient'],
    ['bg-linear-to-r from-(--primary) to-(--accent) text-[black]', 'gradient'],
    [
      'bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-(--text-primary)',
      'gradient'
    ],
    [
      'bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-sm font-bold text-on-cta-wh40k',
      'ok'
    ],
    [
      'md:bg-linear-to-r/srgb from-(--cta-from) to-(--cta-to) text-on-cta-wh40k',
      'cta-space'
    ],
    ['bg-linear-to-r from-(--primary) to-(--accent) text-xs', 'ok'],
    ['bg-accent-wh40k text-white!', 'fixed-label'],
    ['bg-accent-wh40k text-on-accent-wh40k', 'ok'],
    ['bg-(--accent)/20 text-white', 'ok'],
    ['bg-red-600 text-white', 'ok'],
    [
      'bg-gray-800 text-white hover:bg-accent-wh40k hover:text-on-accent-wh40k',
      'ok'
    ],
    [
      'text-white data-[state=active]:bg-accent-wh40k data-[state=active]:text-on-accent-wh40k',
      'ok'
    ]
  ])('%s -> %s', (text, expected) => {
    expect(judge(text)).toBe(expected)
  })
})

describe('text on a filled theme control follows the theme', () => {
  it('no component pairs a primary/secondary/accent fill with a fixed label colour', () => {
    // text-white / text-black / text-(--bg-primary) / text-gray-900 on these
    // fills fall under 4.5:1 on many of the 62 themes. Use text-on-primary-wh40k,
    // text-on-secondary-wh40k or text-on-accent-wh40k.
    expect(found.fixed).toEqual([])
  })

  it('--accent-primary is not the painted accent, so it never carries an --on-* label', () => {
    expect(found.accentPrimary).toEqual([])
  })

  it('inline styles that paint a theme fill take the label from --on-*', () => {
    expect(found.inline).toEqual([])
  })

  it('gradient call-to-actions take their stops and label from --cta-*', () => {
    // The label that reads on a theme's primary does not read on its accent
    // (33 of 62 themes): use from-(--cta-from) to-(--cta-to) text-on-cta-wh40k.
    expect(found.gradient).toEqual([])
  })

  it('--cta-* gradients are painted in sRGB, the path the label was chosen on', () => {
    expect(found.ctaSpace).toEqual([])
  })

  it('shared stylesheet rules that paint a theme fill take the label from --on-*', () => {
    const root = postcss.parse(readFileSync('app/globals.css', 'utf8'))
    const offenders: string[] = []
    root.walk((node) => {
      if (
        node.type !== 'rule' &&
        !(node.type === 'atrule' && node.name === 'utility')
      )
        return
      const own = (node.nodes ?? []).filter(
        (n): n is postcss.Declaration => n.type === 'decl'
      )
      const paints = own.some(
        (d) =>
          /^background(?:-color)?$/u.test(d.prop) &&
          /var\(--(?:primary|secondary|accent)\)/u.test(d.value)
      )
      if (!paints) return
      for (const d of own) {
        if (
          d.prop === 'color' &&
          !/^var\(--(?:on-(?:primary|secondary|accent)|btn-label)\)$/u.test(
            d.value.trim()
          )
        ) {
          offenders.push(
            `${d.parent && 'selector' in d.parent ? String(d.parent.selector) : '@utility'}: color ${d.value}`
          )
        }
      }
      for (const a of node.nodes ?? []) {
        if (
          a.type === 'atrule' &&
          a.name === 'apply' &&
          /(?:^|\s)text-(?:white|black)(?:\s|$)/u.test(a.params)
        ) {
          offenders.push(`@apply ${a.params}`)
        }
      }
    })
    expect(offenders).toEqual([])
  })

  it('the shared button and badge utilities read the label from the theme', async () => {
    const from = path.resolve('app/globals.css')
    const stylesheet = readFileSync(from, 'utf8').replace(
      /^@source '(?!inline)[^']*';$/gmu,
      ''
    )
    const input = `${stylesheet}\n@source inline('btn-wh40k btn-accent-wh40k badge-wh40k badge-accent-wh40k text-on-primary-wh40k text-on-secondary-wh40k text-on-accent-wh40k hover:text-on-secondary-wh40k text-red-400');`
    const { css } = await postcss([tailwindcss()]).process(input, { from })
    // Body of the first `selector { ... }`, nested blocks included.
    const block = (text: string, selector: string): string => {
      const open = text.indexOf(`${selector} {`)
      expect(open, selector).toBeGreaterThanOrEqual(0)
      let depth = 0
      for (let i = text.indexOf('{', open); i < text.length; i++) {
        if (text[i] === '{') depth++
        if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
      }
      throw new Error(`unterminated ${selector}`)
    }
    const one = (selector: string): string => block(css, selector)

    expect(one('.text-on-primary-wh40k')).toContain('color: var(--on-primary)')
    expect(one('.text-on-secondary-wh40k')).toContain(
      'color: var(--on-secondary)'
    )
    expect(one('.text-on-accent-wh40k')).toContain('color: var(--on-accent)')
    expect(css).toContain('.hover\\:text-on-secondary-wh40k')

    expect(one('.badge-wh40k')).toContain('color: var(--on-primary)')
    expect(one('.badge-accent-wh40k')).toContain('color: var(--on-accent)')
    expect(one('.btn-accent-wh40k')).toContain('color: var(--on-accent)')
    // The hover swap changes a variable, not `color`, so a tinted button that
    // sets its own text-* keeps that label on hover.
    expect(one('.btn-wh40k')).toContain('--btn-label: var(--on-primary)')
    expect(one('.btn-wh40k')).toContain('color: var(--btn-label)')
    const hover = block(one('.btn-wh40k'), '&:hover')
    expect(hover).toContain('--btn-label: var(--on-accent)')
    expect(hover).not.toMatch(/(?<![\w-])color:/u)
    for (const name of [
      '.btn-wh40k',
      '.btn-accent-wh40k',
      '.badge-wh40k',
      '.badge-accent-wh40k'
    ]) {
      expect(one(name), name).not.toMatch(/color: #(?:000|fff)/iu)
    }
  })

  it('the stylesheet default (before a theme loads) is a readable label on the default fills', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/--on-primary: #000000;/u)
    expect(css).toMatch(/--on-accent: #000000;/u)
    expect(css).toMatch(/--accent-foreground: #000000;/u)
  })
})
