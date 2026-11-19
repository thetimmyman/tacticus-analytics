// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// A control whose label token and fill token both change on hover must swap in
// one frame. The app-wide `html * { transition: color/background .3s }` rule
// fades both, and two fades that run toward opposite ends meet at about 1:1
// half-way through (33 of 62 themes for primary -> accent).

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

/**
 * The rule's OWN `transition` declarations (a nested `:hover` rule is another
 * rule). `nested` selects a rule written inside it, e.g. `& *`.
 */
function transitionOf(root: postcss.Root, selector: string, nested?: string) {
  let rule: postcss.Rule | undefined
  root.walkRules((r) => {
    if (r.selector.replace(/\s+/gu, ' ') === selector) rule = r
  })
  expect(rule, `rule ${selector} is emitted`).toBeDefined()
  if (nested) {
    rule = rule!.nodes?.find(
      (n): n is postcss.Rule => n.type === 'rule' && n.selector === nested
    )
    expect(rule, `rule ${selector} { ${nested} } is emitted`).toBeDefined()
  }
  return (rule!.nodes ?? [])
    .filter((n): n is postcss.Declaration => n.type === 'decl')
    .filter((d) => d.prop === 'transition' || d.prop.startsWith('transition-'))
    .map((d) => ({ prop: d.prop, value: d.value, important: d.important }))
}

const NONE = [{ prop: 'transition', value: 'none', important: true }]

describe('colour swaps on hover happen in one frame', () => {
  it('btn-wh40k and its children never fade colours', async () => {
    // A child span or icon inherits the label colour: if it fades while the
    // fill snaps, the label sits on the new fill at about 1:1 for a moment.
    const root = await compile('btn-wh40k')
    expect(transitionOf(root, '.btn-wh40k')).toEqual(NONE)
    expect(transitionOf(root, '.btn-wh40k', '& *')).toEqual(NONE)
  })

  it('the no-transition opt-out beats the app-wide colour fade', async () => {
    const root = await compile('no-transition')
    expect(
      transitionOf(
        root,
        'html:not(.theme-loading) .no-transition, html:not(.theme-loading) .no-transition *'
      )
    ).toEqual(NONE)
  })

  function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') yield* sourceFiles(full)
      } else if (
        /\.[jt]sx?$/u.test(entry.name) &&
        !/\.stories\./u.test(entry.name)
      ) {
        yield full
      }
    }
  }

  /** Text of every string and template literal: comments never count. */
  function literals(file: string): string[] {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      /x$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    const found: string[] = []
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        found.push(node.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  // The on-token written as a utility, an arbitrary-property var or a raw var.
  const ON_TOKEN_SWAP =
    /(?:^|[\s:])hover:text-(?:on-[a-z0-9-]+|\(--on-[a-z0-9-]+\)|\[var\(--on-[a-z0-9-]+\)\])(?=\s|$)/u

  it('every file that swaps an on-token label on hover opts out of the fade', () => {
    const roots = [
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
    const missing: string[] = []
    let swappers = 0
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const strings = literals(file)
        if (!strings.some((text) => ON_TOKEN_SWAP.test(text))) continue
        swappers++
        // A class token, so a comment, `md:no-transition` or a prefix do not count.
        const optedOut = strings.some((text) =>
          text.split(/\s+/u).includes('no-transition')
        )
        if (!optedOut) missing.push(file)
      }
    }
    expect(swappers).toBeGreaterThanOrEqual(3)
    expect(missing).toEqual([])
  })
})
