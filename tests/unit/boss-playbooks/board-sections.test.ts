import { describe, it, expect } from 'vitest'
import boardSectionsData from '@/data/boss-playbooks/board-sections.json'
import playbooks from '@/data/boss-playbooks/playbooks.json'

type SectionConfig = { bossType?: string; main?: string[]; support?: string[] }

const sections = boardSectionsData as unknown as Record<string, unknown>
const bossEntries = Object.entries(sections).filter(
  ([, value]) => typeof value === 'object' && value !== null
) as Array<[string, SectionConfig]>

const playbookBosses = playbooks.bosses as Array<{
  id: string
  boards?: string[]
}>
const playbookIds = new Set(playbookBosses.map((b) => b.id))
const playbookBoardsByBoss = new Map(
  playbookBosses.map((boss) => [boss.id, new Set(boss.boards ?? [])])
)
const isSupportId = (id: string) => /(^|_)support(_|$)/i.test(id)
describe('board-sections.json', () => {
  it('has at least the ten named guild-raid bosses configured', () => {
    expect(bossEntries.length).toBeGreaterThanOrEqual(10)
  })

  it.each(bossEntries)('%s is well-formed', (bossId, config) => {
    expect(playbookIds.has(bossId)).toBe(true)
    expect(typeof config.bossType).toBe('string')
    expect(config.bossType && config.bossType.length).toBeTruthy()
    expect(Array.isArray(config.main)).toBe(true)
    expect(Array.isArray(config.support)).toBe(true)

    for (const id of config.main ?? []) {
      expect(id.startsWith('GB_')).toBe(true)
      expect(isSupportId(id)).toBe(false)
    }
    for (const id of config.support ?? []) {
      expect(id.startsWith('GB_')).toBe(true)
      expect(isSupportId(id)).toBe(true)
    }
  })

  it('has no duplicate board ids within a boss', () => {
    for (const [bossId, config] of bossEntries) {
      const all = [...(config.main ?? []), ...(config.support ?? [])]
      expect(new Set(all).size, `duplicate board id in ${bossId}`).toBe(
        all.length
      )
    }
  })

  it('includes the four v1.40 boards extracted into the main sections', () => {
    const lookup = Object.fromEntries(bossEntries)
    expect(lookup['belisarius'].main).toContain('GB_Belisarius_04')
    expect(lookup['ghazghkull'].main).toContain('GB_Dakka_05')
    expect(lookup['avatar-of-khaine'].main).toContain('GB_Khaine_05')
    expect(lookup['rogal-dorn'].main).toContain('GB_RogalDorn_06')
  })

  it('keeps main board sections mirrored into the flat playbook board lists', () => {
    for (const [bossId, config] of bossEntries) {
      const playbookBoards = playbookBoardsByBoss.get(bossId)
      expect(
        playbookBoards,
        `missing playbook boards for ${bossId}`
      ).toBeTruthy()

      for (const boardId of config.main ?? []) {
        expect(
          playbookBoards?.has(boardId),
          `${bossId} main board ${boardId} must remain available in the playbook catalog`
        ).toBe(true)
      }
    }
  })
})
