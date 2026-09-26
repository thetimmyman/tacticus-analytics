import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8')

const offenseClient = readSource(
  'app/(dashboard)/wars/performance/attackers/ClientPage.tsx'
)
const defenseClient = readSource(
  'app/(dashboard)/wars/performance/defenders/ClientPage.tsx'
)
const offensePage = readSource(
  'app/(dashboard)/wars/lineups/attackers/page.tsx'
)
const defensePage = readSource(
  'app/(dashboard)/wars/lineups/defenders/page.tsx'
)
const warsFaq = readSource('app/(dashboard)/wars/_components/WarsFAQ.tsx')
const warsLayout = readSource('app/(dashboard)/wars/layout.tsx')

describe('Guild War hero-performance terminology', () => {
  it('uses the lineups navigation vocabulary in both linked client pages', () => {
    expect(offenseClient).toContain('title="Offense Heroes"')
    expect(offenseClient).toContain('<CardTitle>Top Offense Heroes</CardTitle>')
    expect(offenseClient).not.toMatch(/Attacker Performance|Top Attackers/)

    expect(defenseClient).toContain('title="Defense Heroes"')
    expect(defenseClient).toContain('<CardTitle>Top Defense Heroes</CardTitle>')
    expect(defenseClient).not.toMatch(/Defender Performance|Top Defenders/)
  })

  it('uses Offense and Defense Heroes in lineups and Wars metadata', () => {
    expect(offensePage).toContain("title: 'Offense Heroes'")
    expect(offensePage).toContain(
      'Per-unit guild war offense hero success rates. Part of the Lineups page.'
    )
    expect(offensePage).toContain("path: '/wars/lineups/attackers'")

    expect(defensePage).toContain("title: 'Defense Heroes'")
    expect(defensePage).toContain(
      'Per-unit guild war defense hero hold rates. Part of the Lineups page.'
    )
    expect(defensePage).toContain("path: '/wars/lineups/defenders'")

    expect(warsLayout).toContain(
      'lineups, cores, offense hero results, and defense hero performance'
    )
    expect(warsLayout).not.toMatch(/attacker results|defender performance/i)
  })

  it('updates the FAQ heading without renaming raw battle-data fields', () => {
    expect(warsFaq).toContain('Offense &amp; Defense Heroes — Hero Performance')
    expect(warsFaq).not.toContain(
      'Attackers &amp; Defenders — Hero Performance'
    )
    expect(warsFaq).toContain('<code>attacker_units_json</code>')
    expect(warsFaq).toContain('<code>defender_units_json</code>')
  })
})
