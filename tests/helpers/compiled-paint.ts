import { expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'

export const classTokens = (className: string) => className.split(/\s+/u)

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

export type Painted = Record<string, Array<{ source: string; value: string }>>

/**
 * What an element with these classes paints, read from the compiled
 * stylesheet: the declarations that apply at rest, and those that apply only
 * on hover. Each property keeps every class that declares it, so two classes
 * fighting over one property (the winner then depends on stylesheet order)
 * show up as two entries. Viewport media and other pseudo-classes are left out.
 */
export async function paint(className: string) {
  const classes = new Set(classTokens(className))
  const sheet = await compile([...classes].join(' '))
  const rest: Painted = {}
  const hover: Painted = {}
  const important: string[] = []
  sheet.walkRules((rule) => {
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

/** The single value a property has, failing when two classes both set it. */
export const only = (painted: Painted, prop: string) => {
  const entries = painted[prop] ?? []
  expect(
    entries.map((e) => e.source),
    `one class sets ${prop}`
  ).toHaveLength(entries.length > 0 ? 1 : 0)
  return entries[0]?.value
}
