export const featureFlags = {
  discordAuth: process.env.NEXT_PUBLIC_ENABLE_DISCORD_AUTH === 'true',
  googleAuth: process.env.NEXT_PUBLIC_ENABLE_GOOGLE_AUTH === 'true',

  guildWar: false, // process.env.NEXT_PUBLIC_ENABLE_GUILD_WAR === 'true',

  /** Gates both the player-ranking API route and the dashboard panel. */
  warPlayerRanking: true,

  requireDiscordLink: process.env.NEXT_PUBLIC_REQUIRE_DISCORD_LINK === 'true'
} as const

export function isFeatureEnabled(feature: keyof typeof featureFlags): boolean {
  return featureFlags[feature]
}

export function useFeatureFlag(feature: keyof typeof featureFlags): boolean {
  return featureFlags[feature]
}
