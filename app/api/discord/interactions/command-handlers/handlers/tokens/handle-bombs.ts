import { createComponentLogger } from '@/app/lib/logging'
import {
  resolveVisibilityOptions,
  cooldownToSeconds
} from '../../utils/visibility'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.tokens.handle-bombs'
)
import type { APIEmbedField } from 'discord-api-types/v10'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  resolveTheme,
  HOMINA_POWERED_BY_TEXT
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  formatGuildLabel,
  resolveGuildContext
} from '../../utils/guild-resolution'
import { formatBombLine, chunkLinesIntoFields } from '../../utils/formatting'
import { READY_ONLY_MEMBER_LIMIT } from './shared'
import { fetchGuildTokens } from './fetch-guild-tokens'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export async function handleBombsCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const requestedGuildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined
  const readyOnly = Boolean(
    getOptionValue(interaction.data.options, 'ready-only')
  )
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
    'handleBombsCommand options'
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
  let players = tokensResult.players
  // Display-only; displayName stays raw as the sort and lookup key.
  const memberLabels = await getMemberLabelMap()

  if (readyOnly) {
    players = players.filter((p) => p.bombsAvailable > 0)
  }

  const sortedPlayers = [...players].sort((a, b) => {
    if (a.bombsAvailable > 0 && b.bombsAvailable === 0) return -1
    if (a.bombsAvailable === 0 && b.bombsAvailable > 0) return 1

    if (a.bombsAvailable === 0 && b.bombsAvailable === 0) {
      return (
        cooldownToSeconds(a.bombCooldown) - cooldownToSeconds(b.bombCooldown)
      )
    }

    return a.displayName.localeCompare(b.displayName)
  })

  const totalBombsReady = players.filter((p) => p.bombsAvailable > 0).length

  let lines = sortedPlayers.map((player) =>
    formatBombLine(
      {
        displayName: resolveMemberLabel(player.displayName, memberLabels),
        discordUserId: player.discordUserId,
        bombsAvailable: player.bombsAvailable,
        bombCooldown: player.bombCooldown
      },
      { useMention }
    )
  )

  if (readyOnly && lines.length > READY_ONLY_MEMBER_LIMIT) {
    const truncated = lines.length - READY_ONLY_MEMBER_LIMIT
    lines = [
      ...lines.slice(0, READY_ONLY_MEMBER_LIMIT),
      `... +${truncated} more players with bombs ready`
    ]
  }

  const memberFields =
    lines.length > 0
      ? chunkLinesIntoFields(`${displayGuild} Bomb Status`, lines, {
          repeatLabel: false
        })
      : [
          {
            name: `${displayGuild} Bomb Status`,
            value: readyOnly
              ? 'No bombs are ready at the moment.'
              : 'No player data available.'
          }
        ]

  const totalBombsField: APIEmbedField = {
    name: 'Bombs ready',
    value: `\`${totalBombsReady}/${tokensResult.players.length}\``,
    inline: true
  }

  const title = readyOnly
    ? `Bomb Availability - ${displayGuild} (Ready Players)`
    : `Bomb Availability - ${displayGuild}`

  return createCommandResponse(theme, {
    title,
    description: readyOnly
      ? 'Listing members with bombs ready to deploy.'
      : 'Tracking bomb cooldowns and readiness for all members.',
    color: 0xf39c12,
    fields: [...memberFields, totalBombsField],
    footer: `Data fetched from the guild raid API.\n(NB! Inaccuracies may occur for users who have joined mid-season)\n${HOMINA_POWERED_BY_TEXT}`,
    useThemeAccent: false,
    ephemeral: !isPublic
  })
}
