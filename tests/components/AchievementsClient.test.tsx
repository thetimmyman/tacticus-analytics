import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import AchievementsClient, {
  RECENT_UNLOCK_WINDOW_MS,
  isRecentAchievementUnlock
} from '@/app/(dashboard)/achievements/AchievementsClient'

vi.mock('@/app/lib/hooks/useHasMounted', () => ({
  useHasMounted: () => true
}))

vi.mock('@/app/hooks/useMemberLabels', () => ({
  useMemberLabels: () => ({
    labelFor: (name: string | null | undefined) => name ?? '',
    labelMap: new Map(),
    isLoading: false
  })
}))

const NOW_MS = Date.parse('2026-08-03T18:00:00.000Z')

function makeSeries({
  name,
  unlockedAt,
  allMaxed
}: {
  name: string
  unlockedAt: string
  allMaxed: boolean
}) {
  const seriesKey = name.toLowerCase().replaceAll(' ', '-')
  const unlockedTier = {
    key: `${seriesKey}-1`,
    displayName: `${name} I`,
    description: `${name} description`,
    icon: 'award',
    category: 'damage',
    categoryLabel: 'Damage',
    metric: 'damage',
    metricLabel: 'Damage dealt',
    rarity: 'rare',
    points: 10,
    tier: 1,
    threshold: 100,
    unlocked: true,
    unlockedAt,
    value: 100,
    progress: null,
    seriesKey
  }
  const lockedTier = {
    ...unlockedTier,
    key: `${seriesKey}-2`,
    displayName: `${name} II`,
    tier: 2,
    threshold: 200,
    unlocked: false,
    unlockedAt: null
  }
  const tiers = allMaxed ? [unlockedTier] : [unlockedTier, lockedTier]

  return {
    seriesKey,
    displayName: name,
    description: `${name} description`,
    icon: 'award',
    category: 'damage',
    categoryLabel: 'Damage',
    metric: 'damage',
    metricLabel: 'Damage dealt',
    totalTiers: tiers.length,
    unlockedTiers: 1,
    currentTier: 1,
    nextTierIndex: allMaxed ? null : 1,
    currentValue: 100,
    nextThreshold: allMaxed ? null : 200,
    progressToNext: allMaxed ? 100 : 50,
    pointsEarned: 10,
    pointsAvailable: allMaxed ? 10 : 20,
    allMaxed,
    topRarity: 'rare',
    currentRarity: 'rare',
    tiers
  }
}

function makeResponse(series: ReturnType<typeof makeSeries>[]) {
  return {
    achievements: series.flatMap((entry) => entry.tiers),
    series,
    categories: [
      {
        key: 'damage',
        label: 'Damage',
        description: 'Damage achievements',
        accentClass: 'text-red-400'
      }
    ],
    stats: {},
    summary: {
      total: series.reduce((sum, entry) => sum + entry.totalTiers, 0),
      additional: 0,
      unlocked: series.length,
      points: series.length * 10,
      completionPercent: 50
    },
    targetPlayer: {
      playerId: 'player-1',
      displayName: 'Test Player',
      guildCode: 'TEST',
      role: 'member',
      isSelf: true
    }
  }
}

function renderClient(series: ReturnType<typeof makeSeries>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeResponse(series)
    })
  )

  return render(
    <AchievementsClient
      initialPlayerId="player-1"
      players={[
        {
          playerId: 'player-1',
          displayName: 'Test Player',
          guildCode: 'TEST',
          role: 'member',
          isSelf: true
        }
      ]}
      canSelectPlayers={false}
      viewerGuildLabel="Test Guild"
    />
  )
}

describe('achievement unlock recency', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses a bounded 24-hour window and rejects invalid or future timestamps', () => {
    expect(RECENT_UNLOCK_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
    expect(
      isRecentAchievementUnlock(
        new Date(NOW_MS - RECENT_UNLOCK_WINDOW_MS).toISOString(),
        NOW_MS
      )
    ).toBe(true)
    expect(
      isRecentAchievementUnlock(
        new Date(NOW_MS - RECENT_UNLOCK_WINDOW_MS - 1).toISOString(),
        NOW_MS
      )
    ).toBe(false)
    expect(
      isRecentAchievementUnlock(new Date(NOW_MS + 1).toISOString(), NOW_MS)
    ).toBe(false)
    expect(isRecentAchievementUnlock('not-a-date', NOW_MS)).toBe(false)
    expect(isRecentAchievementUnlock(null, NOW_MS)).toBe(false)
  })

  it('celebrates a recent unlock while keeping an older maxed card static', async () => {
    renderClient([
      makeSeries({
        name: 'Recent Progress',
        unlockedAt: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
        allMaxed: false
      }),
      makeSeries({
        name: 'Historic Max',
        unlockedAt: new Date(NOW_MS - 48 * 60 * 60 * 1000).toISOString(),
        allMaxed: true
      })
    ])

    const recentCard = await screen.findByRole('article', {
      name: 'Recent Progress achievement'
    })
    const historicMaxCard = screen.getByRole('article', {
      name: 'Historic Max achievement'
    })

    expect(within(recentCard).getByText('Just unlocked')).toBeInTheDocument()
    expect(recentCard.className).toContain(
      'motion-safe:animate-[achievement-glow_3s_ease-in-out_3]'
    )
    expect(recentCard.className).not.toContain('infinite')

    expect(historicMaxCard.className).toContain('border-amber-400/60')
    expect(historicMaxCard.className).not.toContain('animate-[')
    expect(
      within(historicMaxCard).queryByText('Just unlocked')
    ).not.toBeInTheDocument()
    expect(within(historicMaxCard).getByText('Maxed')).toBeInTheDocument()
  })

  it('gates every celebration animation behind reduced-motion-safe variants', async () => {
    renderClient([
      makeSeries({
        name: 'Motion Safe',
        unlockedAt: new Date(NOW_MS - 60 * 1000).toISOString(),
        allMaxed: true
      })
    ])

    const card = await screen.findByRole('article', {
      name: 'Motion Safe achievement'
    })
    expect(card.className).toContain('motion-safe:animate-[')
    expect(card.className).not.toMatch(/(?:^|\s)animate-\[/)

    const sparkles = card.querySelector('svg.absolute')
    expect(sparkles?.getAttribute('class')).toContain('motion-safe:animate-[')
    expect(sparkles?.getAttribute('class')).not.toMatch(/(?:^|\s)animate-\[/)
  })

  it('expires the recent marker while the page remains mounted', async () => {
    const expiresInMs = 30
    renderClient([
      makeSeries({
        name: 'Expiring Unlock',
        unlockedAt: new Date(
          NOW_MS - RECENT_UNLOCK_WINDOW_MS + expiresInMs
        ).toISOString(),
        allMaxed: false
      })
    ])

    const card = await screen.findByRole('article', {
      name: 'Expiring Unlock achievement'
    })
    expect(within(card).getByText('Just unlocked')).toBeInTheDocument()

    vi.mocked(Date.now).mockReturnValue(NOW_MS + expiresInMs + 1)
    await waitFor(() => {
      expect(within(card).queryByText('Just unlocked')).not.toBeInTheDocument()
    })
    expect(card.className).not.toContain('motion-safe:animate-[')
    expect(card.querySelector('svg.absolute')).toBeNull()
  })
})
