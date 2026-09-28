// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { expect, it } from 'vitest'

it('compiles app utilities, theme tokens, plugins, and ported safelist', async () => {
  const from = path.resolve('app/globals.css')
  // Drop the file-tree sources so only the ported safelist and the list below feed the build.
  const stylesheet = readFileSync(from, 'utf8').replace(
    /^@source '(?!inline)[^']*';$/gmu,
    ''
  )
  expect(stylesheet).toContain("@import 'tailwindcss' source(none);")
  const input = `${stylesheet}\n@source inline('bg-card/30 text-2xs duration-fast ease-bounce scrollbar-hide card-wh40k prose');`
  const { css } = await postcss([tailwindcss()]).process(input, { from })

  expect(css).toMatch(/\.bg-card\\\/30\s*\{[^}]*--card-bg-rgb/u)
  expect(css).toMatch(/\.text-2xs\s*\{[^}]*0\.625rem/u)
  expect(css).toMatch(/\.duration-fast\s*\{[^}]*--motion-fast/u)
  expect(css).toMatch(/\.ease-bounce\s*\{[^}]*--ease-bounce/u)
  expect(css).toContain('.scrollbar-hide')
  expect(css).toContain('.card-wh40k')
  expect(css).toContain('.prose')
  expect(css).toContain('.md\\:hidden')
  expect(css).toContain('.space-y-0\\.5')
})
