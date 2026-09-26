import type { CommandResponse } from '../types'
import {
  createCommandResponse,
  INFO_THEME,
  COLOR_PALETTE
} from '../utils/response-builder'

export async function handleHelpCommand(): Promise<CommandResponse> {
  return createCommandResponse(INFO_THEME, {
    title: 'Discord Bot Commands',
    description:
      'Slash commands for guild readiness, player activity, and raid progress.\nCommands marked with a lock require **officer** or **leader** role.',
    color: COLOR_PALETTE.info,
    fields: [
      {
        name: 'Everyone',
        value: [
          '`/help` this guide',
          '`/status` verify the current guild link',
          '`/set-user-guild guild:<tag-or-code>` set your personal default guild',
          'Use the website `/onboarding/claim` page with a single-use invite to link your player profile.',
          '`/bombs` bomb cooldown tracker',
          '`/time-to-burn` time until next token burn',
          '`/guild-stats` boss leaderboard snapshot',
          '`/boss` alias for `/guild-stats`',
          '`/raid-status` raid availability & highlights',
          '`/raid` alias for `/raid-status`',
          '`/ask <question>` draft a support answer from the FAQ',
          '`/playbook <boss>` strategy hints and requirements'
        ].join('\n')
      },
      {
        name: 'Officers & Leaders Only',
        value: [
          '`/link <invite-code>` connect server to a guild',
          '`/link-cluster <invite-code>` add all guilds from cluster',
          '`/unlink guild:<tag-or-code>` detach a guild',
          '`/set-default-guild guild:<tag-or-code>` bind channel default',
          '`/token-reminder` manage automated cap alerts',
          '`/tokens` guild token reserves',
          '`/token-overview` available, used & behind-pace summary',
          '`/token-usage` top token spenders & stats',
          '`/player-tokens <player>` token/bomb snapshot',
          '`/player-stats <player>` season raid performance',
          '`/stats <player>` alias for `/player-stats`',
          '`/player-performance` performance chart',
          '`/player-time <player>` peak activity check'
        ].join('\n')
      }
    ],
    footer: 'Need more help? Visit tacticusanalytics.com',
    useThemeAccent: false
  })
}
