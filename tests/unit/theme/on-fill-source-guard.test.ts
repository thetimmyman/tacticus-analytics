// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const FILL =
  /(?<![\w/-])bg-(?:primary-wh40k|accent-wh40k|\(--primary\)|\(--accent\)|\[var\(--primary\)\]|\[var\(--accent\)\]|\(--primary-wh40k\)|\(--accent-wh40k\))(?![/\w-])/u
const FIXED_TEXT =
  /(?<![/\w:-])text-(?:white|black|\(--bg-primary\)|\[#[0-9a-f]{3,8}\])(?![/\w-])/iu

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') yield* sourceFiles(full)
    } else if (/\.tsx?$/u.test(entry.name)) {
      yield full
    }
  }
}

/** String literals (and template parts) that paint a theme fill AND a fixed label colour. */
function fixedLabelsOnFills(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  if (
    !/bg-(?:primary|accent)-wh40k|bg-\(--(?:primary|accent)\)|bg-\[var\(--/u.test(
      source
    )
  ) {
    return []
  }
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const hits: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const text = node.getText(sf)
      if (FILL.test(text) && FIXED_TEXT.test(text)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        hits.push(
          `${file}:${line + 1}: ${text.replace(/\s+/gu, ' ').slice(0, 120)}`
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return hits
}

describe('text on a filled theme control follows the theme', () => {
  it('no component pairs a primary/accent fill with a fixed label colour', () => {
    // text-white / text-black / text-(--bg-primary) on bg-*-wh40k fall under
    // 4.5:1 on 27-40 of the 62 themes; use text-on-primary-wh40k or
    // text-on-accent-wh40k, which follow the fill.
    const hits = [...sourceFiles('app')].flatMap(fixedLabelsOnFills)
    expect(hits).toEqual([])
  })

  it('the shared button and badge utilities read the label from the theme', async () => {
    const from = path.resolve('app/globals.css')
    const stylesheet = readFileSync(from, 'utf8').replace(
      /^@source '(?!inline)[^']*';$/gmu,
      ''
    )
    const input = `${stylesheet}\n@source inline('btn-wh40k btn-accent-wh40k badge-wh40k badge-accent-wh40k text-on-primary-wh40k text-on-secondary-wh40k text-on-accent-wh40k hover:text-on-secondary-wh40k');`
    const { css } = await postcss([tailwindcss()]).process(input, { from })
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`)
      expect(start, selector).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('\n}', start))
    }

    expect(rule('.text-on-primary-wh40k')).toContain('color: var(--on-primary)')
    expect(rule('.text-on-secondary-wh40k')).toContain(
      'color: var(--on-secondary)'
    )
    expect(rule('.text-on-accent-wh40k')).toContain('color: var(--on-accent)')
    expect(css).toContain('.hover\\:text-on-secondary-wh40k')

    expect(rule('.btn-wh40k')).toContain('color: var(--on-primary)')
    expect(rule('.btn-wh40k')).toContain('color: var(--on-accent)')
    expect(rule('.btn-accent-wh40k')).toContain('color: var(--on-accent)')
    expect(rule('.badge-wh40k')).toContain('color: var(--on-primary)')
    expect(rule('.badge-accent-wh40k')).toContain('color: var(--on-accent)')
    for (const name of [
      '.btn-wh40k',
      '.btn-accent-wh40k',
      '.badge-wh40k',
      '.badge-accent-wh40k'
    ]) {
      expect(rule(name), name).not.toMatch(/color: #(?:000|fff)/iu)
    }
  })

  it('the stylesheet default (before a theme loads) is a readable label on the default fills', () => {
    const css = readFileSync('app/globals.css', 'utf8')
    expect(css).toMatch(/--on-primary: #000000;/u)
    expect(css).toMatch(/--on-accent: #000000;/u)
  })
})
