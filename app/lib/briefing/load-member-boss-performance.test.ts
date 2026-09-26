import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PlaybookClearTargetsByKey } from '@/app/lib/briefing/load-playbook-clear-targets'

const MY_ROWS = [
  {
    display_name: 'OfficerOne',
    boss_name: 'BossA',
    encounter_id: 0,
    player_avg: 1000,
    battle_count: 10,
    player_vs_guild_avg: 0,
    rarity: 'Mythic',
    set_num: 1
  },
  {
    display_name: 'OfficerOne',
    boss_name: 'BossB',
    encounter_id: 0,
    player_avg: 1000,
    battle_count: 10,
    player_vs_guild_avg: 0,
    rarity: 'Mythic',
    set_num: 1
  },
  {
    display_name: 'OfficerOne',
    boss_name: 'BossC',
    encounter_id: 0,
    player_avg: 1000,
    battle_count: 10,
    player_vs_guild_avg: 0,
    rarity: 'Mythic',
    set_num: 1
  },
  // The playbook target must blend per tier by battle count.
  {
    display_name: 'OfficerOne',
    boss_name: 'Ghazghkull',
    encounter_id: 0,
    player_avg: 1000,
    battle_count: 10,
    player_vs_guild_avg: 0,
    rarity: 'Legendary',
    set_num: 3
  },
  {
    display_name: 'OfficerOne',
    boss_name: 'Ghazghkull',
    encounter_id: 0,
    player_avg: 2000,
    battle_count: 30,
    player_vs_guild_avg: 0,
    rarity: 'Mythic',
    set_num: 1
  }
]

const PLAYBOOK: PlaybookClearTargetsByKey = new Map([
  ['BossA::0::M2', { requiredDpt: 1500, targetTokens: 10, bossHp: 15000 }],
  ['Ghazghkull::0::L4', { requiredDpt: 1000, targetTokens: 20, bossHp: 20000 }],
  ['Ghazghkull::0::M2', { requiredDpt: 3000, targetTokens: 15, bossHp: 45000 }]
])

vi.mock('@/app/lib/db', () => ({
  serviceDb: () => ({
    rpc: async () => ({ data: MY_ROWS, error: null })
  })
}))

vi.mock('@/app/lib/officer-briefing/analyze-member', () => ({
  analyzeMember: async () => ({
    verdicts: [
      {
        bossName: 'BossB',
        encounterId: 0,
        expectedForBestFieldable: 1200,
        battleCount: 10
      }
    ]
  })
}))

vi.mock('@/app/lib/briefing/load-playbook-clear-targets', () => ({
  loadPlaybookClearTargets: async () => PLAYBOOK
}))

import { loadMemberBossPerformance } from '@/app/lib/briefing/load-member-boss-performance'

const ARGS = {
  guildCode: 'EOT',
  season: '104',
  displayName: 'OfficerOne',
  currentBossName: 'BossA'
}

describe('loadMemberBossPerformance — target cascade (WI-3010)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefers the playbook clear target over coaching and guild', async () => {
    const { rows } = await loadMemberBossPerformance(ARGS)
    const a = rows.find((r) => r.bossName === 'BossA')!
    expect(a.targetSource).toBe('playbook')
    expect(a.yourTarget).toBe(1500)
    expect(Math.round(a.vsTargetPct!)).toBe(-33)
  })

  it('blends the playbook target across tiers by battle count (Ghazghkull L4 + M2, no last-write-wins)', async () => {
    const { rows } = await loadMemberBossPerformance(ARGS)
    const g = rows.find((r) => r.bossName === 'Ghazghkull')!
    expect(g.targetSource).toBe('playbook')
    expect(g.yourTarget).toBe(2500)
  })

  it('falls back to the coaching estimate when no playbook target is set', async () => {
    const { rows } = await loadMemberBossPerformance(ARGS)
    const b = rows.find((r) => r.bossName === 'BossB')!
    expect(b.targetSource).toBe('coaching')
    expect(b.yourTarget).toBe(1200)
  })

  it('falls back to the guild average when neither playbook nor coaching exists', async () => {
    const { rows } = await loadMemberBossPerformance(ARGS)
    const c = rows.find((r) => r.bossName === 'BossC')!
    expect(c.targetSource).toBe('guild')
    expect(c.yourTarget).toBe(c.guildAvg)
    expect(c.yourTarget).toBe(1000)
  })
})
