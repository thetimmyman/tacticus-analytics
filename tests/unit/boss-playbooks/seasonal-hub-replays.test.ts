import { describe, expect, it } from 'vitest'
import { buildSeasonalBossHubData } from '@/app/(dashboard)/boss-playbooks/seasonal-hub-utils'
import type { PlaybooksData } from '@/app/(dashboard)/boss-playbooks/types'
import type { SeasonLineupEntry } from '@/app/lib/loki/season-configs'

const playbooks: PlaybooksData = {
  version: 'test',
  generatedAt: '2026-08-16T00:00:00.000Z',
  featureName: 'boss_playbooks',
  premium: false,
  bosses: [
    {
      id: 'magnus',
      name: 'Magnus the Red',
      faction: 'Thousand Sons',
      bannedFaction: 'ThousandSons',
      turnLimit: 5,
      movement: 3,
      encounterMix: { boss: 1, crystal: 1 },
      boards: ['GB_Magnus_01'],
      playbook: 'magnus-playbook.md',
      threats: [],
      keyThresholds: [],
      cooldowns: [],
      coreMechanic: 'test'
    }
  ]
}

const lineup: SeasonLineupEntry = {
  season: 103,
  configId: 'test-config',
  configVersion: 'test-version',
  capturedAt: '2026-08-16T00:00:00.000Z',
  encounters: [
    {
      rarityIndex: 5,
      set: 0,
      encounterIndex: 0,
      encounterType: 'Boss',
      bossType: 'Magnus',
      unitId: 'GuildBoss9Boss1ThousMagnus:23',
      boardId: 'GB_Magnus_01'
    },
    {
      rarityIndex: 5,
      set: 0,
      encounterIndex: 1,
      encounterType: 'Crystal',
      bossType: 'Magnus',
      unitId: 'GuildBoss9MiniBoss1ThousAbraxas:23',
      boardId: 'GB_Magnus_support_01'
    }
  ]
}

const replay = (
  id: string,
  patch: Partial<{
    damage: number
    encounter_role: string
    map_id: string
    is_featured: boolean
  }> = {}
) => ({
  id,
  boss_id: 'magnus',
  title: 'Magnus replay',
  difficulty: null,
  rarity_set: 'M1',
  map_id: patch.map_id ?? 'GB_Magnus_01',
  damage: patch.damage ?? 1_000_000,
  units: ['Eldryon', 'Ahriman'],
  season: 103,
  is_featured: patch.is_featured ?? false,
  created_at: '2026-08-16T00:00:00.000Z',
  video_type: 'youtube',
  video_url: 'https://youtu.be/example',
  visibility: 'public',
  tags: [],
  encounter_role: patch.encounter_role ?? 'boss'
})

describe('seasonal hub replay projection', () => {
  it('separates encounter roles, caps display rows, and keeps the full count', () => {
    const mainRows = Array.from({ length: 7 }, (_, index) =>
      replay(`main-${index}`, { damage: 1_000_000 + index })
    )
    const side = replay('side', {
      damage: 2_000_000,
      encounter_role: 'prime',
      map_id: 'GB_Magnus_support_01'
    })

    const data = buildSeasonalBossHubData({
      lineup,
      playbooks,
      replays: [...mainRows, side],
      mapImageUrlsByBoardId: {}
    })
    const card = data.groups[0]?.cards[0]

    expect(card?.mainEncounter.replayCount).toBe(7)
    expect(card?.mainEncounter.availableReplayCount).toBe(7)
    expect(card?.mainEncounter.topReplays).toHaveLength(5)
    expect(card?.sideEncounters[0]?.topReplays.map(({ id }) => id)).toEqual([
      'side'
    ])
    expect(card?.mainEncounter).not.toHaveProperty('bestClusterReplays')
  })
})
