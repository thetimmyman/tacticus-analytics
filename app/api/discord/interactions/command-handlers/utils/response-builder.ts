import type { APIEmbed, APIEmbedField } from 'discord-api-types/v10'
import type { CommandResponse, DiscordTheme } from '../types'
import { COLOR_PALETTE } from '@/app/lib/discord/colors'

export { COLOR_PALETTE }

const EPHEMERAL = 1 << 6

export const GUILD_THEMES: Record<string, DiscordTheme> = {
  IW: { color: 0xc0c0c0, accentEmoji: '[IW]' },
  AL: { color: 0x00ced1, accentEmoji: '[AL]' },
  DA: { color: 0x145214, accentEmoji: '[DA]' },
  HL: { color: 0x9370db, accentEmoji: '[HL]' },
  IH: { color: 0x6a4c93, accentEmoji: '[IH]' },
  RG: { color: 0x1d4ed8, accentEmoji: '[RG]' },
  TS: { color: 0x6a0dad, accentEmoji: '[TS]' }
}

export const DEFAULT_THEME: DiscordTheme = {
  color: COLOR_PALETTE.info,
  accentEmoji: '[TA]'
}
export const ERROR_THEME: DiscordTheme = {
  color: COLOR_PALETTE.danger,
  accentEmoji: '[ERROR]'
}
export const INFO_THEME: DiscordTheme = {
  color: COLOR_PALETTE.info,
  accentEmoji: '[INFO]'
}
export const SUCCESS_THEME: DiscordTheme = {
  color: COLOR_PALETTE.success,
  accentEmoji: '[OK]'
}
export const HOMINA_POWERED_BY_TEXT =
  'Powered by Homina  github.com/sigubrat/Homina'

export function resolveTheme(guildCode?: string | null): DiscordTheme {
  if (!guildCode) return DEFAULT_THEME
  const normalized = guildCode.trim().toUpperCase()
  return GUILD_THEMES[normalized] ?? DEFAULT_THEME
}

export function createCommandResponse(
  theme: DiscordTheme,
  {
    title,
    description,
    color,
    fields,
    footer,
    ephemeral = true,
    useThemeAccent = true,
    imageUrl,
    thumbnailUrl
  }: {
    title: string
    description?: string
    color?: number
    fields?: APIEmbedField[]
    footer?: string
    ephemeral?: boolean
    useThemeAccent?: boolean
    imageUrl?: string
    thumbnailUrl?: string
  }
): CommandResponse {
  const embedTitle = useThemeAccent ? `${theme.accentEmoji} ${title}` : title
  const timestamp = new Date().toISOString()
  const embed: APIEmbed = {
    title: embedTitle,
    description,
    color: color ?? theme.color,
    fields,
    footer: { text: footer ?? 'Tacticus Analytics' },
    timestamp
  }
  if (imageUrl) {
    embed.image = { url: imageUrl }
  }
  if (thumbnailUrl) {
    embed.thumbnail = { url: thumbnailUrl }
  }
  return {
    embeds: [embed],
    ...(ephemeral ? { flags: EPHEMERAL } : {})
  }
}

/** Visibility is fixed at a PUBLIC defer; an ephemeral payload there becomes the placeholder. */
export function asPublicResponse(response: CommandResponse): CommandResponse {
  if (typeof response.flags !== 'number') {
    return response
  }
  const { flags: _flags, ...rest } = response
  return rest
}

export function buildErrorResponse(message: string): CommandResponse {
  return createCommandResponse(ERROR_THEME, {
    title: 'Command Error',
    description: message
  })
}

export function buildServerNotLinkedResponse(): CommandResponse {
  return createCommandResponse(ERROR_THEME, {
    title: 'Server Not Linked',
    description: 'This Discord server is not linked to any guilds yet.',
    fields: [
      {
        name: 'How to Link',
        value:
          '1. Get an invite code from **Tacticus Analytics** dashboard\n' +
          '2. Run `/link invite-code:<your_code>`\n' +
          '3. Start using token commands!'
      }
    ]
  })
}
