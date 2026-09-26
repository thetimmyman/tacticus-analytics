export type AchievementCategory =
  | 'participation'
  | 'votlw_awards'
  | 'damage'
  | 'roster_strength'
  | 'feats_of_strength'
  | 'activity'
  | 'app_basics'

export type AchievementRarity =
  'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'

export type AchievementMetric =
  | 'seasonCount'
  | 'submissionCount'
  | 'battleTokenCount'
  | 'bombCount'
  | 'guildWarCount'
  | 'votlwGoldMedals'
  | 'votlwSilverMedals'
  | 'votlwBronzeMedals'
  | 'votlwMostDamageAwards'
  | 'votlwSideBossWins'
  | 'votlwBiggestHitAwards'
  | 'votlwTopKillerAwards'
  | 'votlwBestBomberAwards'
  | 'votlwPoints'
  | 'totalDamage'
  | 'bestHit'
  | 'bestBomb'
  | 'maxSeasonDamage'
  | 'maxSeasonSubmissions'
  | 'killCount'
  | 'primeKills'
  | 'sideBossKills'
  | 'maxSweepsInSeason'
  | 'perfectHits'
  | 'nearMisses'
  | 'rosterPower'
  | 'playerLevel'
  | 'rosterUnitCount'
  | 'diamondUnitCount'
  | 'legendaryUnitCount'
  | 'maxAbilityLevel'
  | 'activeDaysAllTime'
  | 'maxActiveDaysInSeason'
  | 'recentSubmissionCount'
  | 'linkedAccountCount'
  | 'appBasicsCompleted'
  | 'hasApiKey'
  | 'hasDiscord'
  | 'hasShareUrl'
  | 'hasTimezone'
  | 'hasBossPrefs'
  | 'hasMetaTeams'
  | 'isAppAdmin'

export type AchievementStats = Partial<
  Record<AchievementMetric, number | boolean>
>

export interface AchievementCategoryDefinition {
  key: AchievementCategory
  label: string
  description: string
  accentClass: string
}

export interface AchievementDefinition {
  key: string
  displayName: string
  description: string
  icon: string
  category: AchievementCategory
  categoryLabel: string
  metric: AchievementMetric
  metricLabel: string
  tier?: number
  threshold?: number
  rarity: AchievementRarity
  points: number
  /** Shared by all tiers of a series so the UI renders one card; `key` for singletons. */
  seriesKey: string
  seriesLabel: string
}

interface ThresholdSpec {
  category: AchievementCategory
  metric: AchievementMetric
  metricLabel: string
  keyPrefix: string
  displayPrefix: string
  descriptionSuffix: string
  thresholds: number[]
  icon: string
  startTier?: number
}

export const ACHIEVEMENT_CATEGORIES: AchievementCategoryDefinition[] = [
  {
    key: 'participation',
    label: 'Participation',
    description: 'Seasons, tokens, guild wars, and showing up for the raid.',
    accentClass: 'from-sky-500/25 to-cyan-400/10 border-sky-400/30'
  },
  {
    key: 'votlw_awards',
    label: 'VOTLW Awards',
    description: 'Veteran of the Long War medals, set awards, and bonuses.',
    accentClass: 'from-amber-500/25 to-yellow-300/10 border-amber-400/30'
  },
  {
    key: 'damage',
    label: 'Damage',
    description: 'Lifetime damage, huge hits, bomb damage, and season output.',
    accentClass: 'from-red-500/25 to-rose-400/10 border-red-400/30'
  },
  {
    key: 'roster_strength',
    label: 'Roster Strength',
    description: 'Roster power, level, units, rarity, rank, and abilities.',
    accentClass: 'from-emerald-500/25 to-teal-400/10 border-emerald-400/30'
  },
  {
    key: 'feats_of_strength',
    label: 'Feats of Strength',
    description: 'Kills, primes, side bosses, perfect hits, and close calls.',
    accentClass: 'from-violet-500/25 to-fuchsia-400/10 border-violet-400/30'
  },
  {
    key: 'activity',
    label: 'Activity',
    description: 'Active days, season consistency, and recent contribution.',
    accentClass: 'from-lime-500/25 to-green-400/10 border-lime-400/30'
  },
  {
    key: 'app_basics',
    label: 'App Admin & Basics',
    description: 'Profile setup, account links, preferences, and admin flags.',
    accentClass: 'from-slate-400/25 to-zinc-300/10 border-slate-300/30'
  }
]

const categoryLabelMap = new Map(
  ACHIEVEMENT_CATEGORIES.map((category) => [category.key, category.label])
)

const categoryLabel = (category: AchievementCategory) =>
  categoryLabelMap.get(category) ?? 'Achievements'

const numberLabel = (value: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value)

const keyNumber = (value: number): string => {
  if (value >= 1_000_000_000 && value % 1_000_000_000 === 0) {
    return `${value / 1_000_000_000}b`
  }
  if (value >= 1_000_000 && value % 1_000_000 === 0) {
    return `${value / 1_000_000}m`
  }
  if (value >= 1_000 && value % 1_000 === 0) {
    return `${value / 1_000}k`
  }
  return String(value).replace(/\./g, '_')
}

const range = (length: number, step = 1, start = step): number[] =>
  Array.from({ length }, (_, index) => start + index * step)

const rarityForTier = (tier: number): AchievementRarity => {
  if (tier >= 180) return 'mythic'
  if (tier >= 120) return 'legendary'
  if (tier >= 75) return 'epic'
  if (tier >= 35) return 'rare'
  if (tier >= 12) return 'uncommon'
  return 'common'
}

const pointsForRarity = (rarity: AchievementRarity): number => {
  switch (rarity) {
    case 'mythic':
      return 30
    case 'legendary':
      return 20
    case 'epic':
      return 12
    case 'rare':
      return 8
    case 'uncommon':
      return 4
    case 'common':
    default:
      return 2
  }
}

const achievement = (
  definition: Omit<
    AchievementDefinition,
    'categoryLabel' | 'points' | 'seriesKey' | 'seriesLabel'
  > & {
    points?: number
    seriesKey?: string
    seriesLabel?: string
  }
): AchievementDefinition => ({
  ...definition,
  categoryLabel: categoryLabel(definition.category),
  points: definition.points ?? pointsForRarity(definition.rarity),
  seriesKey: definition.seriesKey ?? definition.key,
  seriesLabel: definition.seriesLabel ?? definition.displayName
})

const thresholdAchievements = ({
  category,
  metric,
  metricLabel,
  keyPrefix,
  displayPrefix,
  descriptionSuffix,
  thresholds,
  icon,
  startTier = 1
}: ThresholdSpec): AchievementDefinition[] =>
  thresholds.map((threshold, index) => {
    const tier = startTier + index
    const rarity = rarityForTier(tier)
    return achievement({
      key: `${keyPrefix}_${keyNumber(threshold)}`,
      displayName: `${displayPrefix} ${numberLabel(threshold)}`,
      description: `${descriptionSuffix} ${numberLabel(threshold)}.`,
      icon,
      category,
      metric,
      metricLabel,
      threshold,
      tier,
      rarity,
      seriesKey: keyPrefix,
      seriesLabel: displayPrefix
    })
  })

const BASE_ACHIEVEMENTS: AchievementDefinition[] = [
  achievement({
    key: 'first_kill',
    displayName: 'First Kill',
    description: 'Defeated your first boss.',
    icon: '💀',
    category: 'feats_of_strength',
    metric: 'maxSweepsInSeason',
    metricLabel: 'Best season sweeps',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'veteran_5_seasons',
    displayName: 'Veteran of V Seasons',
    description: 'Participated in 5 or more seasons.',
    icon: '🏅',
    category: 'participation',
    metric: 'seasonCount',
    metricLabel: 'Seasons',
    threshold: 5,
    tier: 5,
    rarity: 'uncommon',
    seriesKey: 'participation_seasons',
    seriesLabel: 'Season Campaigner'
  }),
  achievement({
    key: 'damage_1m',
    displayName: 'Damage Milestone I',
    description: 'Dealt 1,000,000 total damage.',
    icon: '⚔️',
    category: 'damage',
    metric: 'totalDamage',
    metricLabel: 'Total damage',
    threshold: 1_000_000,
    tier: 1,
    rarity: 'common',
    seriesKey: 'damage_total',
    seriesLabel: 'Total Damage'
  }),
  achievement({
    key: 'damage_5m',
    displayName: 'Damage Milestone II',
    description: 'Dealt 5,000,000 total damage.',
    icon: '⚔️',
    category: 'damage',
    metric: 'totalDamage',
    metricLabel: 'Total damage',
    threshold: 5_000_000,
    tier: 2,
    rarity: 'uncommon',
    seriesKey: 'damage_total',
    seriesLabel: 'Total Damage'
  }),
  achievement({
    key: 'damage_10m',
    displayName: 'Damage Milestone III',
    description: 'Dealt 10,000,000 total damage.',
    icon: '⚔️',
    category: 'damage',
    metric: 'totalDamage',
    metricLabel: 'Total damage',
    threshold: 10_000_000,
    tier: 3,
    rarity: 'rare',
    seriesKey: 'damage_total',
    seriesLabel: 'Total Damage'
  }),
  achievement({
    key: 'lord_of_hosts',
    displayName: 'Lord of Hosts',
    description: 'Achieved 50 or more lifetime boss kills.',
    icon: '👑',
    category: 'feats_of_strength',
    metric: 'killCount',
    metricLabel: 'Boss kills',
    threshold: 50,
    tier: 50,
    rarity: 'epic',
    seriesKey: 'feats_kills',
    seriesLabel: 'Boss Slayer'
  }),
  achievement({
    key: 'prime_slayer',
    displayName: 'Prime Slayer',
    description: 'Achieved 10 or more prime kills.',
    icon: '🎯',
    category: 'feats_of_strength',
    metric: 'primeKills',
    metricLabel: 'Prime kills',
    threshold: 10,
    tier: 10,
    rarity: 'rare',
    seriesKey: 'feats_prime_kills',
    seriesLabel: 'Prime Executioner'
  }),
  achievement({
    key: 'sweep_specialist',
    displayName: 'Sweep Specialist',
    description: 'Completed 10 or more sweeps in a single season.',
    icon: '🧹',
    category: 'feats_of_strength',
    metric: 'killCount',
    metricLabel: 'Boss kills',
    threshold: 10,
    tier: 10,
    rarity: 'rare',
    seriesKey: 'feats_kills',
    seriesLabel: 'Boss Slayer'
  }),
  achievement({
    key: 'war_veteran_5',
    displayName: 'War Veteran',
    description: 'Participated in 5 or more guild wars.',
    icon: '🛡️',
    category: 'participation',
    metric: 'guildWarCount',
    metricLabel: 'Guild wars',
    threshold: 5,
    tier: 5,
    rarity: 'uncommon',
    seriesKey: 'participation_guild_wars',
    seriesLabel: 'War Muster'
  })
]

const GENERATED_ACHIEVEMENTS: AchievementDefinition[] = [
  ...thresholdAchievements({
    category: 'participation',
    metric: 'seasonCount',
    metricLabel: 'Seasons',
    keyPrefix: 'participation_seasons',
    displayPrefix: 'Season Campaigner',
    descriptionSuffix: 'Participate in at least',
    thresholds: range(80),
    icon: '📅'
  }),
  ...thresholdAchievements({
    category: 'participation',
    metric: 'submissionCount',
    metricLabel: 'Submissions',
    keyPrefix: 'participation_submissions',
    displayPrefix: 'Raid Ledger',
    descriptionSuffix: 'Record at least',
    thresholds: range(120, 25),
    icon: '📜'
  }),
  ...thresholdAchievements({
    category: 'participation',
    metric: 'battleTokenCount',
    metricLabel: 'Battle tokens',
    keyPrefix: 'participation_battle_tokens',
    displayPrefix: 'Token Veteran',
    descriptionSuffix: 'Spend at least',
    thresholds: range(120, 20),
    icon: '🎟️'
  }),
  ...thresholdAchievements({
    category: 'participation',
    metric: 'bombCount',
    metricLabel: 'Bombs',
    keyPrefix: 'participation_bombs',
    displayPrefix: 'Bomb Runner',
    descriptionSuffix: 'Use at least',
    thresholds: range(60),
    icon: '💣'
  }),
  ...thresholdAchievements({
    category: 'participation',
    metric: 'guildWarCount',
    metricLabel: 'Guild wars',
    keyPrefix: 'participation_guild_wars',
    displayPrefix: 'War Muster',
    descriptionSuffix: 'Join at least',
    thresholds: range(60),
    icon: '🛡️'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwGoldMedals',
    metricLabel: 'VOTLW gold medals',
    keyPrefix: 'votlw_gold_medals',
    displayPrefix: 'Gold Standard',
    descriptionSuffix: 'Earn at least',
    thresholds: range(60),
    icon: '🥇'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwSilverMedals',
    metricLabel: 'VOTLW silver medals',
    keyPrefix: 'votlw_silver_medals',
    displayPrefix: 'Silver Line',
    descriptionSuffix: 'Earn at least',
    thresholds: range(60),
    icon: '🥈'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwBronzeMedals',
    metricLabel: 'VOTLW bronze medals',
    keyPrefix: 'votlw_bronze_medals',
    displayPrefix: 'Bronze Hold',
    descriptionSuffix: 'Earn at least',
    thresholds: range(60),
    icon: '🥉'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwMostDamageAwards',
    metricLabel: 'Most damage awards',
    keyPrefix: 'votlw_most_damage',
    displayPrefix: 'Damage Laureate',
    descriptionSuffix: 'Win at least',
    thresholds: range(50),
    icon: '💥'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwSideBossWins',
    metricLabel: 'Side boss awards',
    keyPrefix: 'votlw_side_boss',
    displayPrefix: 'Flank Breaker',
    descriptionSuffix: 'Win at least',
    thresholds: range(50),
    icon: '👹'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwBiggestHitAwards',
    metricLabel: 'Biggest hit awards',
    keyPrefix: 'votlw_biggest_hit',
    displayPrefix: 'Hammer Blow',
    descriptionSuffix: 'Win at least',
    thresholds: range(50),
    icon: '🎯'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwTopKillerAwards',
    metricLabel: 'Top killer awards',
    keyPrefix: 'votlw_top_killer',
    displayPrefix: 'Headsman',
    descriptionSuffix: 'Claim at least',
    thresholds: range(30),
    icon: '☠️'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwBestBomberAwards',
    metricLabel: 'Best bomber awards',
    keyPrefix: 'votlw_best_bomber',
    displayPrefix: 'Ordnance Saint',
    descriptionSuffix: 'Claim at least',
    thresholds: range(30),
    icon: '🚀'
  }),
  ...thresholdAchievements({
    category: 'votlw_awards',
    metric: 'votlwPoints',
    metricLabel: 'VOTLW points',
    keyPrefix: 'votlw_points',
    displayPrefix: 'Long War Score',
    descriptionSuffix: 'Earn at least',
    thresholds: range(80, 5),
    icon: '🏆'
  }),
  ...thresholdAchievements({
    category: 'damage',
    metric: 'totalDamage',
    metricLabel: 'Total damage',
    keyPrefix: 'damage_total',
    displayPrefix: 'Total Damage',
    descriptionSuffix: 'Deal at least',
    thresholds: range(180, 5_000_000),
    icon: '⚔️'
  }),
  ...thresholdAchievements({
    category: 'damage',
    metric: 'bestHit',
    metricLabel: 'Best hit',
    keyPrefix: 'damage_best_hit',
    displayPrefix: 'Single Hit',
    descriptionSuffix: 'Land a hit of at least',
    thresholds: range(80, 500_000),
    icon: '🎯'
  }),
  ...thresholdAchievements({
    category: 'damage',
    metric: 'bestBomb',
    metricLabel: 'Best bomb',
    keyPrefix: 'damage_best_bomb',
    displayPrefix: 'Bomb Damage',
    descriptionSuffix: 'Land a bomb of at least',
    thresholds: range(60, 500_000),
    icon: '💣'
  }),
  ...thresholdAchievements({
    category: 'damage',
    metric: 'maxSeasonDamage',
    metricLabel: 'Best season damage',
    keyPrefix: 'damage_season',
    displayPrefix: 'Season Damage',
    descriptionSuffix: 'Deal at least',
    thresholds: range(80, 2_500_000),
    icon: '📈'
  }),
  ...thresholdAchievements({
    category: 'roster_strength',
    metric: 'rosterPower',
    metricLabel: 'Roster power',
    keyPrefix: 'roster_power',
    displayPrefix: 'Roster Power',
    descriptionSuffix: 'Reach roster power of',
    thresholds: range(100, 1_000_000),
    icon: '⚙️'
  }),
  ...thresholdAchievements({
    category: 'roster_strength',
    metric: 'playerLevel',
    metricLabel: 'Player level',
    keyPrefix: 'roster_player_level',
    displayPrefix: 'Commander Level',
    descriptionSuffix: 'Reach player level',
    thresholds: range(60),
    icon: '⭐'
  }),
  ...thresholdAchievements({
    category: 'roster_strength',
    metric: 'rosterUnitCount',
    metricLabel: 'Roster units',
    keyPrefix: 'roster_units',
    displayPrefix: 'Roster Depth',
    descriptionSuffix: 'Sync at least',
    thresholds: range(80),
    icon: '🧬'
  }),
  ...thresholdAchievements({
    category: 'roster_strength',
    metric: 'diamondUnitCount',
    metricLabel: 'Diamond units',
    keyPrefix: 'roster_diamond_units',
    displayPrefix: 'Diamond Core',
    descriptionSuffix: 'Build at least',
    thresholds: range(50),
    icon: '💎'
  }),
  ...thresholdAchievements({
    category: 'roster_strength',
    metric: 'legendaryUnitCount',
    metricLabel: 'Legendary units',
    keyPrefix: 'roster_legendary_units',
    displayPrefix: 'Legendary Bench',
    descriptionSuffix: 'Own at least',
    thresholds: range(50),
    icon: '🌟'
  }),
  ...thresholdAchievements({
    category: 'roster_strength',
    metric: 'maxAbilityLevel',
    metricLabel: 'Highest ability',
    keyPrefix: 'roster_ability_level',
    displayPrefix: 'Ability Peak',
    descriptionSuffix: 'Raise an ability to level',
    thresholds: range(55),
    icon: '🔺'
  }),
  ...thresholdAchievements({
    category: 'feats_of_strength',
    metric: 'killCount',
    metricLabel: 'Boss kills',
    keyPrefix: 'feats_kills',
    displayPrefix: 'Boss Slayer',
    descriptionSuffix: 'Defeat at least',
    thresholds: range(120),
    icon: '💀'
  }),
  ...thresholdAchievements({
    category: 'feats_of_strength',
    metric: 'primeKills',
    metricLabel: 'Prime kills',
    keyPrefix: 'feats_prime_kills',
    displayPrefix: 'Prime Executioner',
    descriptionSuffix: 'Defeat at least',
    thresholds: range(80),
    icon: '🎯'
  }),
  ...thresholdAchievements({
    category: 'feats_of_strength',
    metric: 'sideBossKills',
    metricLabel: 'Side boss kills',
    keyPrefix: 'feats_side_boss_kills',
    displayPrefix: 'Side Boss Cleaner',
    descriptionSuffix: 'Defeat at least',
    thresholds: range(80),
    icon: '👹'
  }),
  ...thresholdAchievements({
    category: 'feats_of_strength',
    metric: 'perfectHits',
    metricLabel: 'Perfect hits',
    keyPrefix: 'feats_perfect_hits',
    displayPrefix: 'Exact Lethality',
    descriptionSuffix: 'Record at least',
    thresholds: range(40),
    icon: '🎖️'
  }),
  ...thresholdAchievements({
    category: 'feats_of_strength',
    metric: 'nearMisses',
    metricLabel: 'Near misses',
    keyPrefix: 'feats_near_misses',
    displayPrefix: 'Almost Had Him',
    descriptionSuffix: 'Leave a boss under 5% HP at least',
    thresholds: range(40),
    icon: '🔥'
  }),
  ...thresholdAchievements({
    category: 'activity',
    metric: 'activeDaysAllTime',
    metricLabel: 'Active days',
    keyPrefix: 'activity_days',
    displayPrefix: 'Active Days',
    descriptionSuffix: 'Log raid activity on at least',
    thresholds: range(180),
    icon: '📡'
  }),
  ...thresholdAchievements({
    category: 'activity',
    metric: 'maxActiveDaysInSeason',
    metricLabel: 'Best season active days',
    keyPrefix: 'activity_season_days',
    displayPrefix: 'Season Presence',
    descriptionSuffix: 'Be active on at least',
    thresholds: range(45),
    icon: '🗓️'
  }),
  ...thresholdAchievements({
    category: 'activity',
    metric: 'recentSubmissionCount',
    metricLabel: 'Recent submissions',
    keyPrefix: 'activity_recent_submissions',
    displayPrefix: 'Current Tempo',
    descriptionSuffix: 'Record at least',
    thresholds: range(40),
    icon: '⚡'
  }),
  ...thresholdAchievements({
    category: 'app_basics',
    metric: 'linkedAccountCount',
    metricLabel: 'Linked account items',
    keyPrefix: 'app_linked_items',
    displayPrefix: 'Account Linkage',
    descriptionSuffix: 'Complete at least',
    thresholds: range(6),
    icon: '🔗'
  }),
  ...thresholdAchievements({
    category: 'app_basics',
    metric: 'appBasicsCompleted',
    metricLabel: 'Setup items',
    keyPrefix: 'app_basics_completed',
    displayPrefix: 'Command Setup',
    descriptionSuffix: 'Complete at least',
    thresholds: range(8),
    icon: '✅'
  }),
  achievement({
    key: 'app_api_key_linked',
    displayName: 'Signal Established',
    description: 'Connect a Tacticus API key.',
    icon: '🔑',
    category: 'app_basics',
    metric: 'hasApiKey',
    metricLabel: 'API key linked',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'app_discord_linked',
    displayName: 'Vox Channel Open',
    description: 'Connect a Discord account.',
    icon: '📣',
    category: 'app_basics',
    metric: 'hasDiscord',
    metricLabel: 'Discord linked',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'app_share_url_added',
    displayName: 'Roster Beacon',
    description: 'Add a Tacticus profile share URL.',
    icon: '🛰️',
    category: 'app_basics',
    metric: 'hasShareUrl',
    metricLabel: 'Share URL added',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'app_timezone_set',
    displayName: 'Chronometer Set',
    description: 'Set a timezone on your profile.',
    icon: '⏱️',
    category: 'app_basics',
    metric: 'hasTimezone',
    metricLabel: 'Timezone set',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'app_boss_preferences_set',
    displayName: 'Target Priorities',
    description: 'Choose boss preferences.',
    icon: '🎚️',
    category: 'app_basics',
    metric: 'hasBossPrefs',
    metricLabel: 'Boss preferences',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'app_meta_teams_set',
    displayName: 'Meta Team Filed',
    description: 'Select at least one meta team.',
    icon: '🧩',
    category: 'app_basics',
    metric: 'hasMetaTeams',
    metricLabel: 'Meta team set',
    threshold: 1,
    tier: 1,
    rarity: 'common'
  }),
  achievement({
    key: 'app_admin_commissar',
    displayName: 'Command Console',
    description: 'Hold app admin privileges.',
    icon: '🛠️',
    category: 'app_basics',
    metric: 'isAppAdmin',
    metricLabel: 'App admin',
    threshold: 1,
    tier: 1,
    rarity: 'legendary'
  })
]

export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
  ...BASE_ACHIEVEMENTS,
  ...GENERATED_ACHIEVEMENTS
]

export const ADDITIONAL_ACHIEVEMENT_COUNT = GENERATED_ACHIEVEMENTS.length

export function getAchievementDef(
  key: string
): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOG.find((a) => a.key === key)
}

export function getAchievementMetricValue(
  stats: AchievementStats,
  metric: AchievementMetric
): number {
  const value = stats[metric]
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return 0
}

export function isAchievementUnlocked(
  definition: AchievementDefinition,
  stats: AchievementStats
): boolean {
  const target = definition.threshold ?? 1
  return getAchievementMetricValue(stats, definition.metric) >= target
}

export interface AchievementSeriesSummary {
  seriesKey: string
  displayName: string
  description: string
  icon: string
  category: AchievementCategory
  categoryLabel: string
  metric: AchievementMetric
  metricLabel: string
  totalTiers: number
  thresholds: number[]
  topRarity: AchievementRarity
}

const rarityRank: Record<AchievementRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5
}

/** Definitional fields only; the route layer adds per-player state. */
export function getAchievementSeries(): AchievementSeriesSummary[] {
  const buckets = new Map<string, AchievementDefinition[]>()
  for (const def of ACHIEVEMENT_CATALOG) {
    const bucket = buckets.get(def.seriesKey)
    if (bucket) {
      bucket.push(def)
    } else {
      buckets.set(def.seriesKey, [def])
    }
  }
  return Array.from(buckets.entries()).map(([seriesKey, defs]) => {
    const sorted = [...defs].sort(
      (a, b) => (a.threshold ?? 1) - (b.threshold ?? 1)
    )
    const first = sorted[0]
    if (!first) {
      throw new Error(`Achievement series "${seriesKey}" has no definitions`)
    }
    const topRarity = sorted.reduce<AchievementRarity>(
      (acc, def) =>
        rarityRank[def.rarity] > rarityRank[acc] ? def.rarity : acc,
      'common'
    )
    return {
      seriesKey,
      displayName: first.seriesLabel,
      // Lowest tier's description reads as the series concept, not a specific tier.
      description: first.description,
      icon: first.icon,
      category: first.category,
      categoryLabel: first.categoryLabel,
      metric: first.metric,
      metricLabel: first.metricLabel,
      totalTiers: sorted.length,
      thresholds: sorted.map((def) => def.threshold ?? 1),
      topRarity
    }
  })
}
