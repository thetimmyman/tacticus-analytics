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
 * What an element with these classes paints, from the compiled stylesheet.
 * `rest` is unconditional, `hover` ends in exactly `:hover`, and `states`
 * holds every other selector tail (`@width ` first inside a viewport query).
 * Each property keeps every class that sets it, so a fight over one shows up
 * as two entries.
 */
export async function paint(className: string) {
  const classes = new Set(classTokens(className))
  const sheet = await compile([...classes].join(' '))
  const rest: Painted = {}
  const hover: Painted = {}
  const states: Record<string, Painted> = {}
  const important: string[] = []
  sheet.walkRules((rule) => {
    const match = /^\.((?:\\.|[^\\:\s,.])+)(.*)$/u.exec(rule.selector)
    if (!match) return
    const name = match[1]!.replace(/\\(.)/gu, '$1')
    if (!classes.has(name)) return
    let responsive = false
    let outer: postcss.Container | postcss.Document | undefined = rule.parent
    for (; outer; outer = outer.parent) {
      if (
        outer.type === 'atrule' &&
        /width/u.test((outer as postcss.AtRule).params)
      ) {
        responsive = true
      }
    }
    const tail = match[2]!
    const key = `${responsive ? '@width ' : ''}${tail}`
    const target =
      key === '' ? rest : key === ':hover' ? hover : (states[key] ??= {})
    for (const node of rule.nodes ?? []) {
      if (node.type !== 'decl') continue
      ;(target[node.prop] ??= []).push({ source: name, value: node.value })
      if (node.important) important.push(`${name}: ${node.prop}`)
    }
  })
  return { rest, hover, states, important }
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
