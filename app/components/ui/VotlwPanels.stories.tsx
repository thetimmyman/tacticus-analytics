import type { Meta, StoryObj } from '@storybook/react-vite'
import VOTLWBattlefieldHonors from '@/app/components/votlw/VOTLWBattlefieldHonors'
import VOTLWIndividualAwards from '@/app/components/votlw/VOTLWIndividualAwards'
import VOTLWLeaderboard from '@/app/components/votlw/VOTLWLeaderboard'
import VOTLWSeasonStats from '@/app/components/votlw/VOTLWSeasonStats'
import type {
  PlayerPoints,
  SeasonResults,
  SetWinner
} from '@tacticus/app-core/votlw.types'

/**
 * Qualification fixture for the dark showpiece panels of the season recap.
 * Each panel paints its own black surface, so it opts into `scheme-dark`
 * as a whole: a header, caption or button that sat outside that scope would
 * resolve the status palette for the light page and lose contrast on black.
 * Both pages below use synthetic data; the light page is the case that
 * matters, the dark page is the control.
 */

const meta: Meta = {
  title: 'UI/Season recap panels',
  parameters: { layout: 'fullscreen' }
}

export default meta

type Story = StoryObj

const PLAYERS: PlayerPoints[] = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(
  (displayName, index) => ({
    displayName,
    totalPoints: 120 - index * 15,
    avgDamagePerHit: 410_000 - index * 25_000,
    tokenCount: 38 - index,
    sweeps: 6 - index,
    oneShots: 3,
    bombsUsed: 4,
    crashes: index,
    awards: {
      goldMedals: 3 - index,
      silverMedals: index,
      bronzeMedals: 1,
      mostDamageAwards: 1,
      sideBossWins: 1,
      biggestHitAwards: 1,
      topKiller: index === 0,
      bestBomber: index === 1,
      sideBoss1Wins: 1,
      sideBoss2Wins: 0
    },
    breakdown: []
  })
)

const SET_WINNERS: SetWinner[] = [
  {
    set: 5,
    rarity: 'Mythic',
    levelString: 'M5',
    bossName: 'Sample Boss',
    gold: 'Alpha',
    goldValue: 1_200_000,
    silver: 'Bravo',
    silverValue: 1_100_000,
    bronze: 'Charlie',
    bronzeValue: 900_000,
    mostDamage: 'Alpha',
    mostDamageValue: 2_400_000,
    sideBoss1: 'Delta',
    sideBoss1Value: 300_000,
    sideBoss2: 'Bravo',
    sideBoss2Value: 250_000,
    biggestHit: 'Charlie',
    biggestHitValue: 800_000
  }
]

const SEASON: SeasonResults = {
  topKiller: { player: 'Alpha', value: 14 },
  bestBomber: { player: 'Bravo', value: 410_000 },
  worstBomb: { player: 'Delta', value: 1_200 },
  almostHadHim: { player: 'Charlie', boss: 'Sample Boss', hpLeft: 52_000 },
  firstToken: { player: 'Alpha', time: '2026-01-01T00:05:00Z' },
  lastToken: { player: 'Delta', time: '2026-01-07T23:40:00Z' },
  tokenEfficiency: { player: 'Bravo', ratio: 1.8 },
  mostDamage: { player: 'Alpha', damage: 9_000_000 },
  bombMaster: { player: 'Bravo', bombs: 12 },
  legendarySlayer: { player: 'Alpha', kills: 5 },
  sideBossSlayer: { player: 'Charlie', kills: 3 },
  mostImproved: { player: 'Delta', improvementPct: 22 }
}

function Surface({ scheme }: { scheme: 'light' | 'dark' | 'theme' }) {
  // 'theme' follows the active application theme (set localStorage
  // theme-override before load to compare Light Mode with a dark theme); the
  // other two pin the page colours and the color-scheme.
  const pinned = scheme !== 'theme'
  return (
    <section
      data-fixture={scheme}
      style={
        pinned
          ? {
              colorScheme: scheme,
              backgroundColor: scheme === 'light' ? '#ffffff' : '#0f172a',
              color: scheme === 'light' ? '#111827' : '#f1f5f9'
            }
          : {
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)'
            }
      }
      className="space-y-6 p-6"
    >
      <p className="text-sm">Page surface: {scheme}</p>
      <VOTLWLeaderboard playerPoints={PLAYERS} />
      <VOTLWIndividualAwards setWinners={SET_WINNERS} />
      <VOTLWSeasonStats seasonAwards={SEASON} />
      <VOTLWBattlefieldHonors seasonAwards={SEASON} />
    </section>
  )
}

export const LightPage: Story = {
  render: () => <Surface scheme="light" />
}

export const DarkPage: Story = {
  render: () => <Surface scheme="dark" />
}

export const ActiveTheme: Story = {
  render: () => <Surface scheme="theme" />
}
