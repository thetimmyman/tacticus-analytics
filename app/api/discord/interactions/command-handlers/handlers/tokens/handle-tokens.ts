import { createComponentLogger } from '@/app/lib/logging'
import {
  resolveVisibilityOptions,
  cooldownToSeconds
} from '../../utils/visibility'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.tokens.handle-tokens'
)
import type { APIEmbedField } from 'discord-api-types/v10'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  resolveTheme,
  COLOR_PALETTE,
  HOMINA_POWERED_BY_TEXT
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  formatGuildLabel,
  resolveGuildContext
} from '../../utils/guild-resolution'
import {
  formatTokenMemberLine,
  chunkLinesIntoFields
} from '../../utils/formatting'
import { fetchGuildTokens } from './fetch-guild-tokens'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export async function handleTokensCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const requestedGuildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined
  const {
    publicOptionRaw,
    mentionOptionRaw,
    isPublic,
    useMention,
    errorVisibility
  } = resolveVisibilityOptions(interaction.data.options, {
    defaultPublic: true
  })

  logger.debug(
    {
      options: interaction.data.options,
      publicOptionRaw,
      mentionOptionRaw,
      useMention,
      isPublic
    },
    'handleTokensCommand options'
  )

  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption,
    scope: 'tokens'
  })
  if (!guildResolution.ok) {
    return errorVisibility(guildResolution.response)
  }

  const targetGuildCode = guildResolution.guild.guildCode
  const displayGuild = formatGuildLabel(guildResolution.guild)

  const tokensResult = await fetchGuildTokens(
    supabase,
    targetGuildCode,
    requestedSeason,
    guildResolution.guild.clusterCode
  )

  if (!tokensResult.ok) {
    return errorVisibility(buildErrorResponse(tokensResult.message))
  }

  const theme = resolveTheme(targetGuildCode)
  const players = tokensResult.players
  // Display-only; displayName stays raw as the cross-command lookup key.
  const memberLabels = await getMemberLabelMap()

  const totalTokensAvailable = players.reduce(
    (sum, player) => sum + player.tokensAvailable,
    0
  )
  const totalBombsAvailable = players.reduce(
    (sum, player) => sum + player.bombsAvailable,
    0
  )

  const sortedPlayers = [...players].sort((a, b) => {
    if (a.tokensAvailable !== b.tokensAvailable) {
      return b.tokensAvailable - a.tokensAvailable
    }

    return (
      cooldownToSeconds(a.tokenCooldown) - cooldownToSeconds(b.tokenCooldown)
    )
  })

  const lines = sortedPlayers.map((player) =>
    formatTokenMemberLine(
      {
        displayName: resolveMemberLabel(player.displayName, memberLabels),
        discordUserId: player.discordUserId,
        tokensAvailable: player.tokensAvailable,
        bombsAvailable: player.bombsAvailable,
        tokenCooldown: player.tokenCooldown,
        bombCooldown: player.bombCooldown
      },
      { useMention }
    )
  )
  const memberFields = chunkLinesIntoFields(`${displayGuild} Members`, lines)
  const maxTokens = players.length * 3
  const maxBombs = players.length

  const totalTokensField: APIEmbedField = {
    name: 'Total tokens',
    value: `\`${totalTokensAvailable}/${maxTokens}\``,
    inline: true
  }
  const totalBombsField: APIEmbedField = {
    name: 'Total bombs',
    value: `\`${totalBombsAvailable}/${maxBombs}\``,
    inline: true
  }

  return createCommandResponse(theme, {
    title: `Guild Raid Tokens - ${displayGuild}`,
    description:
      'First values are tokens, second values are bombs, then usernames.\n\n' +
      'Note that the token cooldowns have an inherent uncertainty due to the nature of the available data for the calculation.\n' +
      'In certain cases the cooldown might not be accurate.',
    color: COLOR_PALETTE.info,
    fields: [...memberFields, totalTokensField, totalBombsField],
    footer: `Data fetched from the guild raid API.\n(NB! Inaccuracies may occur for users who have joined mid-season)\n${HOMINA_POWERED_BY_TEXT}`,
    useThemeAccent: false,
    ephemeral: !isPublic
  })
}
