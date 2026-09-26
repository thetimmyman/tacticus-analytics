const majorVersionThreadId =
  process.env.DISCORD_MAJOR_VERSION_THREAD_ID &&
  process.env.DISCORD_MAJOR_VERSION_THREAD_ID.trim().length > 0
    ? process.env.DISCORD_MAJOR_VERSION_THREAD_ID.trim()
    : null

export const DISCORD_WEBHOOK_CONFIG = {
  threads: {
    majorVersionUpdates: majorVersionThreadId,

    minorVersionUpdates: null,

    development: null
  },

  settings: {
    threadOnlyForMajor: true,

    // Always use existing thread IDs; never create threads.
    preventNewThreads: true,

    notifyOnVersionTypes: ['major', 'minor'] // Excludes 'patch' by default
  },

  colors: {
    major: 0xff0000, // Red for major updates
    minor: 0x00ff00, // Green for minor updates
    patch: 0x0080ff, // Blue for patches
    hotfix: 0xffa500 // Orange for hotfixes
  },

  bot: {
    username: 'Tacticus Analytics Bot',
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
  }
}

export function getWebhookUrlWithThread(
  baseUrl: string,
  versionType: 'major' | 'minor' | 'patch'
): string {
  const config = DISCORD_WEBHOOK_CONFIG

  if (
    versionType === 'major' &&
    config.threads.majorVersionUpdates &&
    config.settings.threadOnlyForMajor
  ) {
    return `${baseUrl}?thread_id=${config.threads.majorVersionUpdates}`
  }

  if (versionType === 'minor' && config.threads.minorVersionUpdates) {
    return `${baseUrl}?thread_id=${config.threads.minorVersionUpdates}`
  }

  return baseUrl
}

export function shouldNotifyDiscord(
  versionType: 'major' | 'minor' | 'patch'
): boolean {
  return DISCORD_WEBHOOK_CONFIG.settings.notifyOnVersionTypes.includes(
    versionType
  )
}

export function getEmbedColor(
  versionType: 'major' | 'minor' | 'patch' | 'hotfix'
): number {
  return (
    DISCORD_WEBHOOK_CONFIG.colors[versionType] ||
    DISCORD_WEBHOOK_CONFIG.colors.patch
  )
}
