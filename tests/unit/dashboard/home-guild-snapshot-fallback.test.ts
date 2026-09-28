import { describe, expect, it, vi } from 'vitest'
import { fetchHomeGuildSnapshot } from '@/app/lib/dashboard/home-summary'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

/** The user-scoped fallback reads the explore view, which redacts both damage totals. */

const ROW = {
  guild_name: 'Alpha',
  rank: 3,
  war_rank: 5,
  total_battles: 120,
  active_players: 22,
  member_count: 30
}

const makeClient = (data: unknown, error: unknown = null) => {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const eqSeason = vi.fn(() => ({ maybeSingle }))
  const eqGuild = vi.fn(() => ({ eq: eqSeason }))
  const select = vi.fn(() => ({ eq: eqGuild }))
  const from = vi.fn(() => ({ select }))
  return {
    client: { from } as unknown as TypedSupabaseClient,
    from,
    select,
    maybeSingle
  }
}

describe('fetchHomeGuildSnapshot', () => {
  it('service path reads the base table and keeps the true damage columns', async () => {
    const full = {
      ...ROW,
      total_damage: 4_010_000,
      avg_damage_per_battle: 33_416
    }
    const fake = makeClient(full)

    const result = await fetchHomeGuildSnapshot(fake.client, true, 'ABC', 84)

    expect(fake.from).toHaveBeenCalledWith('public_guild_snapshots')
    expect(fake.select).toHaveBeenCalledWith(
      'guild_name, rank, war_rank, total_damage, total_battles, active_players, member_count, avg_damage_per_battle'
    )
    expect(result.data).toEqual(full)
  })

  it('fallback path reads the view, never the base table', async () => {
    const fake = makeClient(ROW)

    await fetchHomeGuildSnapshot(fake.client, false, 'ABC', 84)

    expect(fake.from).toHaveBeenCalledWith('public_guild_snapshots_explore')
    expect(fake.from).not.toHaveBeenCalledWith('public_guild_snapshots')
  })

  it('fallback path does not even ask for the two redacted columns', async () => {
    const fake = makeClient(ROW)

    await fetchHomeGuildSnapshot(fake.client, false, 'ABC', 84)

    const columns = fake.select.mock.calls[0][0] as string
    expect(columns).not.toContain('total_damage')
    expect(columns).not.toContain('avg_damage_per_battle')
    for (const column of [
      'guild_name',
      'rank',
      'war_rank',
      'total_battles',
      'active_players',
      'member_count'
    ]) {
      expect(columns).toContain(column)
    }
  })

  it('fallback path returns the full shape with the redacted columns nulled', async () => {
    const fake = makeClient(ROW)

    const result = await fetchHomeGuildSnapshot(fake.client, false, 'ABC', 84)

    expect(result.data).toEqual({
      ...ROW,
      total_damage: null,
      avg_damage_per_battle: null
    })
  })

  it('fallback path returns null for a hide_all guild, the way it does for no snapshot', async () => {
    // The view withholds hide_all rows entirely.
    const fake = makeClient(null)

    const result = await fetchHomeGuildSnapshot(fake.client, false, 'ABC', 84)

    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('propagates a query error rather than swallowing it', async () => {
    const boom = { message: 'permission denied' }
    const fake = makeClient(null, boom)

    const result = await fetchHomeGuildSnapshot(fake.client, false, 'ABC', 84)

    expect(result.data).toBeNull()
    expect(result.error).toBe(boom)
  })
})
