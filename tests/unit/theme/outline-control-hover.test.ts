// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { paint } from '../../helpers/compiled-paint'

interface Control {
  name: string
  file: string
  rings: string[]
}

// Outline-like controls outside Button share the quiet-button hover cue.
const CONTROLS: Control[] = [
  {
    name: 'BossAnalysisPanel',
    file: 'app/(dashboard)/leaderboards/meta-analysis/_components/BossAnalysisPanel.tsx',
    rings: ['hover:inset-ring-1', 'enabled:hover:inset-ring-1']
  },
  {
    name: 'FilterPanel',
    file: 'app/(dashboard)/leaderboards/meta-analysis/_components/FilterPanel.tsx',
    rings: ['hover:inset-ring-2']
  },
  {
    name: 'PaginationControls',
    file: 'app/(public)/explore/components/PaginationControls.tsx',
    rings: ['hover:inset-ring-2']
  },
  {
    name: 'SectionSubnav',
    file: 'app/components/navigation/SectionSubnav.tsx',
    rings: ['hover:inset-ring-2']
  },
  {
    name: 'WorkspaceBar',
    file: 'app/components/navigation/WorkspaceBar.tsx',
    rings: ['hover:inset-ring-2']
  },
  {
    name: 'ModeTogglePillGroup',
    file: 'app/components/ui/ModeTogglePillGroup.tsx',
    rings: ['enabled:hover:inset-ring-1', 'enabled:hover:inset-ring-2']
  },
  {
    name: 'BattleLog tabs',
    file: 'app/components/BattleLog.tsx',
    rings: ['hover:inset-ring-1']
  },
  {
    name: 'BattleLog shared tabs',
    file: 'app/components/ui/BattleLogTable.tsx',
    rings: ['hover:inset-ring-1']
  },
  {
    name: 'GlobalThresholdsManager',
    file: 'app/(dashboard)/admin/feature-releases/GlobalThresholdsManager.tsx',
    rings: ['hover:inset-ring-1']
  }
]

/** Class strings only: comments and prose never count as a control class. */
function literals(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
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

const tokens = (file: string) =>
  new Set(
    literals(file)
      .flatMap((text) => text.split(/\s+/u))
      .filter(Boolean)
  )

describe('outline-like controls hover with an inner ring', () => {
  it.each(CONTROLS)(
    '$name does not hover-fill with the card tint',
    ({ file }) => {
      expect(tokens(file).has('hover:bg-(--card-bg)')).toBe(false)
    }
  )

  it.each(CONTROLS)(
    '$name exposes the inner-ring hover cue',
    ({ file, rings }) => {
      const found = tokens(file)
      expect(rings.filter((ring) => !found.has(ring))).toEqual([])
    }
  )

  it.each([1, 2])('hover:inset-ring-%i paints the ring only', async (width) => {
    const { hover } = await paint(`hover:inset-ring-${width}`)
    expect(Object.keys(hover).sort()).toEqual([
      '--tw-inset-ring-shadow',
      'box-shadow'
    ])
    expect(hover['--tw-inset-ring-shadow']?.[0]?.value).toBe(
      `inset 0 0 0 ${width}px var(--tw-inset-ring-color, currentcolor)`
    )
    expect(hover['background-color']).toBeUndefined()
  })

  it('still catches the replaced card-bg hover fill', async () => {
    const { hover } = await paint('hover:bg-(--card-bg)')
    expect(hover['background-color']).toBeDefined()
  })
})
