// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Variants such as `hover:` or `data-[state=active]:` in front of a utility.
const PREFIX = String.raw`(?:[\w[\]=&>*()-]+:)*`
const FILL = new RegExp(
  String.raw`(?<![\w/-])${PREFIX}bg-(?:(?:primary|secondary|accent)-wh40k|\(--(?:primary|secondary|accent|accent-primary|primary-wh40k|secondary-wh40k|accent-wh40k)\)|\[var\(--(?:primary|secondary|accent|accent-primary)\)\])(?![/\w-])`,
  'u'
)
const GRADIENT_FILL = new RegExp(
  String.raw`(?<![\w/-])${PREFIX}(?:from|via|to)-\(--(?:primary|secondary|accent)\)(?![\w-])`,
  'u'
)
const FIXED_LABEL = new RegExp(
  String.raw`(?<![/\w-])${PREFIX}text-(?:(?:white|black)(?:/\d+)?|\((?:--bg-primary|--accent-foreground)\)|\[var\(--(?:bg-primary|accent-foreground)\)\]|\[#[0-9a-f]{3,8}\])(?![\w-])`,
  'iu'
)

/**
 * Gradient call-to-action buttons (primary to accent) with a fixed label.
 * Neither end of the gradient has a single label that reads on every theme,
 * so they need a design decision, not this token. The list may only shrink.
 */
const KNOWN_GRADIENT_LABELS = [
  'app/(dashboard)/wars/_components/SideTogglePills.tsx',
  'app/(public)/creators/page.tsx',
  'app/components/BossFavorites.tsx',
  'app/components/homepage/FinalCTA.tsx',
  'app/components/homepage/HeroCTA.tsx',
  'app/components/navigation/PublicNav.tsx',
  'app/components/navigation/WarSubnav.tsx',
  'app/components/navigation/WorkspaceSectionMenuLink.tsx',
  'packages/ui-kit/src/Avatar.tsx'
]

const CLASS_HELPERS = new Set(['clsx', 'cn', 'twMerge', 'classNames', 'cx'])
const CAP = 256

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

/** Every class string an expression can produce (branches kept apart). */
function variants(node: ts.Node | undefined): string[] {
  if (!node) return ['']
  if (ts.isStringLiteralLike(node)) return [node.text]
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
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    CLASS_HELPERS.has(node.expression.text)
  ) {
    return node.arguments.reduce<string[]>(
      (acc, arg) => join(acc, variants(arg)),
      ['']
    )
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

interface Findings {
  fixed: string[]
  gradient: Set<string>
  inline: string[]
}

function scan(file: string, found: Findings): void {
  const source = readFileSync(file, 'utf8')
  if (!/bg-|--primary|--accent|--secondary/u.test(source)) return
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const where = (n: ts.Node): string =>
    `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const check = (n: ts.Node, text: string): void => {
    if (FIXED_LABEL.test(text) && FILL.test(text)) {
      found.fixed.push(
        `${where(n)}: ${text.replace(/\s+/gu, ' ').slice(0, 110)}`
      )
    } else if (FIXED_LABEL.test(text) && GRADIENT_FILL.test(text)) {
      found.gradient.add(file.split(path.sep).join('/'))
    }
  }

  const visit = (node: ts.Node, inClassRoot: boolean): void => {
    let nested = inClassRoot
    // A single class string, wherever it lives (maps, constants, props).
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      check(node, node.getText(sf))
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
      nested = true
    }
    // Inline styles: a primary/accent background with a label that is not a token.
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
          /^var\(--(?:primary|secondary|accent|accent-primary)\)$/u.test(bg) &&
          color &&
          !color.startsWith('var(--on-')
        ) {
          found.inline.push(`${where(node)}: ${bg} with ${color}`)
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, nested))
  }
  visit(sf, false)
}

const found: Findings = { fixed: [], gradient: new Set(), inline: [] }
for (const root of ROOTS)
  for (const file of sourceFiles(root)) scan(file, found)

describe('text on a filled theme control follows the theme', () => {
  it('no component pairs a primary/secondary/accent fill with a fixed label colour', () => {
    // text-white / text-black / text-(--bg-primary) / text-(--accent-foreground)
    // on these fills fall under 4.5:1 on many of the 62 themes. Use
    // text-on-primary-wh40k, text-on-secondary-wh40k or text-on-accent-wh40k.
    expect(found.fixed).toEqual([])
  })

  it('inline styles that paint a theme fill take the label from --on-*', () => {
    expect(found.inline).toEqual([])
  })

  it('gradient call-to-actions with a fixed label are a shrinking list', () => {
    // Fix one and delete it from KNOWN_GRADIENT_LABELS; a new one fails here.
    expect([...found.gradient].sort()).toEqual(
      [...KNOWN_GRADIENT_LABELS].sort()
    )
  })

  it('shared stylesheet rules that paint a theme fill take the label from --on-*', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    const offenders: string[] = []
    for (const [, body = ''] of css.matchAll(/\{([^{}]*)\}/gu)) {
      if (
        !/background(?:-color)?:\s*var\(--(?:primary|secondary|accent)\)/u.test(
          body
        )
      )
        continue
      for (const [, value = ''] of body.matchAll(
        /(?<![\w-])color:\s*([^;]+);/gu
      )) {
        if (
          !/^var\(--(?:on-(?:primary|secondary|accent)|btn-label)\)$/u.test(
            value.trim()
          )
        ) {
          offenders.push(value.trim())
        }
      }
    }
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
