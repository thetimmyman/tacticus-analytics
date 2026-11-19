// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
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

/** The `transition` declaration of the rule whose selector is exactly `selector`. */
function transitionOf(root: postcss.Root, selector: string) {
  let rule: postcss.Rule | undefined
  root.walkRules((r) => {
    if (r.selector.replace(/\s+/gu, ' ') === selector) rule = r
  })
  expect(rule, `rule ${selector} is emitted`).toBeDefined()
  const found: { value: string; important: boolean }[] = []
  rule!.walkDecls('transition', (d) =>
    found.push({ value: d.value, important: d.important })
  )
  return found
}

describe('colour swaps on hover happen in one frame', () => {
  it('btn-wh40k, whose label follows its fill to the accent, never fades colours', async () => {
    const root = await compile('btn-wh40k')
    expect(transitionOf(root, '.btn-wh40k')).toEqual([
      { value: 'none', important: true }
    ])
  })

  it('the no-transition opt-out beats the app-wide colour fade', async () => {
    const root = await compile('no-transition')
    expect(
      transitionOf(
        root,
        'html:not(.theme-loading) .no-transition, html:not(.theme-loading) .no-transition *'
      )
    ).toEqual([{ value: 'none', important: true }])
  })

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
        const text = readFileSync(file, 'utf8')
        if (!/hover:text-on-[a-z-]+/u.test(text)) continue
        swappers++
        if (!/(^|[\s'"`])no-transition([\s'"`]|$)/u.test(text)) {
          missing.push(file)
        }
      }
    }
    expect(swappers).toBeGreaterThanOrEqual(3)
    expect(missing).toEqual([])
  })
})
