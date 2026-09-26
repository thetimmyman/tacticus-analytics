import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GuildSpecificBossLeaderboard from '@/app/(dashboard)/leaderboards/boss/GuildSpecificBossLeaderboard'
import GuildSpecificOverallLeaderboard from '@/app/(dashboard)/leaderboards/overall/GuildSpecificOverallLeaderboard'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  db: { rpc: vi.fn() }
}))

mocks.db.rpc = mocks.rpc

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => mocks.db
}))

vi.mock(
  '@/app/(dashboard)/leaderboards/hooks/useGuildLeaderboardContext',
  () => ({
    useGuildLeaderboardContext: () => ({
      data: {
        season: '106',
        guildDisplayName: 'Example Alliance',
        hasCluster: true
      },
      isLoading: false,
      error: null
    })
  })
)

vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({ playerName }: { playerName: string }) => <>{playerName}</>
}))

vi.mock('@/app/components/ui/BossLink', () => ({
  BossLink: ({ bossName }: { bossName: string }) => <>{bossName}</>
}))

vi.mock('@/app/components/ui/BossPortrait', () => ({
  BossPortrait: () => null
}))

vi.mock('@/app/components/TeamCompositionDisplay', () => ({
  default: () => <span>Team</span>
}))

const PRIMARY_HEADER = '[&_th]:!text-[var(--text-primary)]'

describe('guild-specific leaderboard DataTable chrome', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('preserves the boss leaderboard primary-colored headers', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          displayName: 'Player One',
          Guild: 'EOT_GR',
          bossName: 'Avatar',
          encounterIndex: 0,
          maxDamage: 123456,
          battleCount: 3,
          avgDamage: 41152,
          heroDetails: null,
          machineOfWarDetails: null,
          categories: []
        }
      ],
      error: null
    })

    render(<GuildSpecificBossLeaderboard guildCode="EOT_GR" />)

    expect((await screen.findByRole('table')).className).toContain(
      PRIMARY_HEADER
    )
  })

  it('preserves the overall leaderboard primary-colored headers', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          displayName: 'Player One',
          Guild: 'EOT_GR',
          totalDamage: 500000,
          battleCount: 4,
          avgDamage: 125000,
          bombsUsed: 4,
          bossesKilled: 1,
          percentVsCluster: 105,
          currentRank: 1,
          priorSeasonRank: 2,
          rankChange: 1,
          fiveSeasonAvgRank: 2
        }
      ],
      error: null
    })

    render(<GuildSpecificOverallLeaderboard guildCode="EOT_GR" />)

    expect((await screen.findByRole('table')).className).toContain(
      PRIMARY_HEADER
    )
  })
})
