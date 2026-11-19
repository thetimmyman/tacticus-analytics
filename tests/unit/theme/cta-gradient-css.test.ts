// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { expect, it } from 'vitest'

it('compiles the gradient call-to-action classes to an sRGB gradient and the --on-cta label', async () => {
  const from = path.resolve('app/globals.css')
  const stylesheet = readFileSync(from, 'utf8').replace(
    /^@source '(?!inline)[^']*';$/gmu,
    ''
  )
  const classes =
    'bg-linear-to-r/srgb bg-linear-to-br/srgb from-(--cta-from) to-(--cta-to) hover:from-(--cta-to) hover:to-(--cta-from) hover:filter-none text-on-cta-wh40k'
  const { css } = await postcss([tailwindcss()]).process(
    `${stylesheet}\n@source inline('${classes}');`,
    { from }
  )

  expect(css).toMatch(/\.text-on-cta-wh40k\s*\{[^}]*color:\s*var\(--on-cta\)/u)
  // The label was chosen on the sRGB path, so the paint must use it too.
  expect(css).toMatch(/\.bg-linear-to-r\\\/srgb\s*\{[^}]*in srgb/u)
  expect(css).toMatch(/\.bg-linear-to-br\\\/srgb\s*\{[^}]*in srgb/u)
  expect(css).toMatch(/\.from-\\\(--cta-from\\\)\s*\{[^}]*var\(--cta-from\)/u)
  expect(css).toMatch(/\.to-\\\(--cta-to\\\)\s*\{[^}]*var\(--cta-to\)/u)
  expect(css).toMatch(/\.hover\\:filter-none:hover[^{]*\{[^}]*filter:\s*none/u)
})
