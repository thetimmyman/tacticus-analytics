import { describe, expect, it } from 'vitest'
import { transformGuildSnapshot } from '@/app/(public)/explore/utils'
import type { GuildSnapshot } from '@tacticus/app-core/database-extensions'

const snapshot = (season: number | null) =>
  ({
    guild_code: 'ABC',
    guild_name: 'Alpha',
    cluster_code: null,
    cluster_name: null,
    season,
    rank: 1,
    top_boss_hits: [],
    votlw_champions: [],
    explore_privacy_mode: 'public'
  }) as unknown as GuildSnapshot

describe('snapshot season', () => {
  it('keeps the season the snapshot reports', () => {
    expect(transformGuildSnapshot(snapshot(114)).season).toBe('114')
  })

  it('leaves the season empty when the snapshot does not say, instead of guessing one', () => {
    expect(transformGuildSnapshot(snapshot(null)).season).toBe('')
  })
})
