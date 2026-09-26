import { describe, it, expect, vi } from 'vitest'
import {
  calculatePlayerRankings,
  type PlayerStatsWithMetrics
} from '@/app/lib/dashboard/guild-summary'

const player = (
  over: Partial<PlayerStatsWithMetrics> = {}
): PlayerStatsWithMetrics => ({
  displayName: 'Viewer',
  normalizedName: 'viewer',
  totalBattles: 10,
  tokenBattles: 10,
  bombBattles: 0,
  totalDamage: 100,
  maxDamage: 100,
  avgDamagePerBattle: 10,
  vsGuildPct: 0,
  ...over
})

const makeSupabase = (rank: number | null = 4, error: unknown = null) => ({
  rpc: vi.fn().mockResolvedValue({ data: rank, error })
})

describe('calculatePlayerRankings cluster rank', () => {
  it('uses the complete-season server aggregate instead of a capped raw row read', async () => {
    const supabase = makeSupabase(4)

    const viewer = player({ totalDamage: 100 })
    const { clusterRankPosition } = await calculatePlayerRankings(
      supabase as never,
      [viewer],
      viewer,
      'CL1',
      '140',
      'player-1'
    )

    expect(clusterRankPosition).toBe(4)
    expect(supabase.rpc).toHaveBeenCalledWith('get_cluster_damage_rank', {
      p_cluster_code: 'CL1',
      p_player_id: 'player-1',
      p_season: '140'
    })
  })

  it('still ranks the viewer inside their own guild from the in-memory metrics', async () => {
    const supabase = makeSupabase()

    const viewer = player({ displayName: 'Viewer', totalDamage: 100 })
    const { guildRankPosition } = await calculatePlayerRankings(
      supabase as never,
      [
        player({ displayName: 'Top', totalDamage: 900 }),
        viewer,
        player({ displayName: 'Low', totalDamage: 10 })
      ],
      viewer,
      'CL1',
      '140',
      'player-1'
    )

    expect(guildRankPosition).toBe(2)
  })

  it('skips the cluster read entirely when the player has no cluster', async () => {
    const supabase = makeSupabase()

    const viewer = player({ totalDamage: 100 })
    const { guildRankPosition, clusterRankPosition } =
      await calculatePlayerRankings(
        supabase as never,
        [viewer],
        viewer,
        null,
        '140',
        'player-1'
      )

    expect(guildRankPosition).toBe(1)
    expect(clusterRankPosition).toBeNull()
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('still gets the complete cluster rank when capped rows omit the player', async () => {
    const supabase = makeSupabase(7)

    const { guildRankPosition, clusterRankPosition } =
      await calculatePlayerRankings(
        supabase as never,
        [],
        undefined,
        'CL1',
        '140',
        'player-1'
      )

    expect(guildRankPosition).toBeNull()
    expect(clusterRankPosition).toBe(7)
    expect(supabase.rpc).toHaveBeenCalledWith('get_cluster_damage_rank', {
      p_cluster_code: 'CL1',
      p_player_id: 'player-1',
      p_season: '140'
    })
  })

  it('keeps cluster rank null when the aggregate RPC fails', async () => {
    const supabase = makeSupabase(null, { message: 'database unavailable' })
    const viewer = player({ totalDamage: 100 })

    const { clusterRankPosition } = await calculatePlayerRankings(
      supabase as never,
      [viewer],
      viewer,
      'CL1',
      '140',
      'player-1'
    )

    expect(clusterRankPosition).toBeNull()
  })
})
