import type { Supabase, CommandInteraction, CommandResponse } from '../types'
import {
  createCommandResponse,
  resolveTheme,
  COLOR_PALETTE,
  buildServerNotLinkedResponse
} from '../utils/response-builder'
import { formatGuildLabel, getLinkedGuilds } from '../utils/guild-resolution'

export async function handleStatusCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const linkedGuilds = await getLinkedGuilds(supabase, interaction.guild_id)
  if (linkedGuilds.length === 0) {
    return buildServerNotLinkedResponse()
  }

  const primary = linkedGuilds[0]
  const theme = resolveTheme(primary?.guildCode)
  const guildList = linkedGuilds
    .map((g) => `• ${formatGuildLabel(g)}`)
    .join('\n')
  const clusterLabel = primary?.clusterCode ?? 'Not assigned'
  const multiGuildHint =
    linkedGuilds.length > 1
      ? 'Multiple guilds share this Discord server. Use `/set-default-guild guild:<tag-or-code>` in each channel to bind commands to the right guild.'
      : 'Use `/set-default-guild guild:<tag-or-code>` in any channel to lock commands to that guild.'

  return createCommandResponse(theme, {
    title: 'Discord Server Linked',
    description: `This Discord server is linked to ${linkedGuilds.length} guild${
      linkedGuilds.length === 1 ? '' : 's'
    }.`,
    color: COLOR_PALETTE.success,
    fields: [
      {
        name: 'Cluster',
        value: clusterLabel,
        inline: true
      },
      {
        name: 'Guilds',
        value: guildList
      },
      {
        name: 'Tips',
        value: multiGuildHint
      }
    ],
    footer:
      'Linked via Tacticus Analytics - regenerate invite codes from Settings -> Integrations.'
  })
}
