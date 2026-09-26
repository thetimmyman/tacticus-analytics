import type { DiscordCommandContext } from './command-context.ts'
import {
  handleBombsCommand,
  handlePlayerTokensCommand,
  handleTokensCommand,
  handleTokenUsageCommand
} from './availability-commands.ts'
import {
  handleGuildStatsCommand,
  handleRaidStatusCommand,
  handleTimeToBurnCommand,
  handleTokenReminderCommand
} from './raid-commands.ts'
import {
  handleHelpCommand,
  handleLinkCommand,
  handlePlayerStatsCommand,
  handleStatusCommand
} from './general-commands.ts'
export { sendFollowupMessage } from './command-shared.ts'

export type DiscordCommandHandler = (
  context: DiscordCommandContext,
  interaction: any
) => Promise<void>

export const commandHandlers: Record<string, DiscordCommandHandler> = {
  help: handleHelpCommand,
  status: handleStatusCommand,
  link: handleLinkCommand,
  tokens: handleTokensCommand,
  bombs: handleBombsCommand,
  'token-usage': handleTokenUsageCommand,
  'player-tokens': handlePlayerTokensCommand,
  'raid-status': handleRaidStatusCommand,
  'token-reminder': handleTokenReminderCommand,
  'guild-stats': handleGuildStatsCommand,
  'player-stats': handlePlayerStatsCommand,
  'time-to-burn': handleTimeToBurnCommand
}

export function getDiscordCommandHandler(
  name: string
): DiscordCommandHandler | undefined {
  return Object.hasOwn(commandHandlers, name)
    ? commandHandlers[name]
    : undefined
}
