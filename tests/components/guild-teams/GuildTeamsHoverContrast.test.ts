// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { paint } from '../../helpers/compiled-paint'

const FILES = [
  {
    name: 'GuildTeamsClient',
    path: 'app/(dashboard)/guild-teams/GuildTeamsClient.tsx',
    requiredTokens: [
      'bg-(--card-bg)',
      'hover:text-primary-wh40k',
      'hover:inset-ring-1',
      'enabled:hover:text-primary-wh40k',
      'enabled:hover:inset-ring-1'
    ]
  },
  {
    name: 'GuildTeamsToolbar',
    path: 'app/(dashboard)/guild-teams/GuildTeamsToolbar.tsx',
    requiredTokens: [
      'bg-(--card-bg)',
      'hover:text-primary-wh40k',
      'hover:inset-ring-1'
    ]
  }
] as const

function classTokensInFile(file: string): Set<string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const tokens = new Set<string>()
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const token of node.text.split(/\s+/u)) {
        if (token) tokens.add(token)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return tokens
}

describe('GuildTeams Light Mode hover contrast guard', () => {
  it.each(FILES)('$name avoids hover:text-white and bg-card/50', ({ path }) => {
    const source = readFileSync(path, 'utf8')
    expect(source).not.toContain('hover:text-white')
    expect(source).not.toContain('bg-card/50')
  })

  it.each(FILES)(
    '$name uses theme-aware hover and card background classes',
    ({ path, requiredTokens }) => {
      const tokens = classTokensInFile(path)
      expect(requiredTokens.filter((token) => !tokens.has(token))).toEqual([])
    }
  )

  it('compiles theme-aware hover cue without a card background fill', async () => {
    const { hover } = await paint('hover:text-primary-wh40k hover:inset-ring-1')
    expect(hover.color?.[0]?.value).toBe('var(--text-primary)')
    expect(hover['--tw-inset-ring-shadow']?.[0]?.value).toBe(
      'inset 0 0 0 1px var(--tw-inset-ring-color, currentcolor)'
    )
    expect(hover['background-color']).toBeUndefined()
  })
})
