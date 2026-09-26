import type { APIEmbedField } from 'discord-api-types/v10'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  buildServerNotLinkedResponse,
  resolveTheme,
  COLOR_PALETTE
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  formatGuildLabel,
  getLinkedGuilds,
  guildMatchesInput
} from '../../utils/guild-resolution'
import { formatMatchLine, normalizeName } from '../../utils/formatting'
import { getCurrentSeason } from '../tokens/shared'
import { fetchGuildTokens } from '../tokens/fetch-guild-tokens'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

const MAX_PLAYER_RESULTS = 10

/** Same source as /tokens, /bombs and /token-overview so they never disagree. */
export async function handlePlayerTokensCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const linkedGuilds = await getLinkedGuilds(supabase, interaction.guild_id)
  if (linkedGuilds.length === 0) {
    return buildServerNotLinkedResponse()
  }

  const playerQuery = (
    getOptionValue(interaction.data.options, 'player') as string | undefined
  )?.trim()
  if (!playerQuery) {
    return buildErrorResponse('Please provide a player name.')
  }

  const requestedGuild = getOptionValue(interaction.data.options, 'guild') as
    string | undefined
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined

  let targetGuilds = linkedGuilds
  if (requestedGuild) {
    targetGuilds = linkedGuilds.filter((guild) =>
      guildMatchesInput(guild, requestedGuild)
    )
    if (targetGuilds.length === 0) {
      return buildErrorResponse(
        `Access denied: guild ${requestedGuild} is not linked to this server. Available guilds: ${linkedGuilds
          .map((guild) => formatGuildLabel(guild))
          .join(', ')}`
      )
    }
  }

  let season = (requestedSeason ?? '').trim()
  if (!season) {
    try {
      season = await getCurrentSeason(supabase)
    } catch {
      season = ''
    }
  }

  const guildResults = await Promise.all(
    targetGuilds.map(async (guild) => ({
      guild,
      result: await fetchGuildTokens(
        supabase,
        guild.guildCode,
        requestedSeason,
        guild.clusterCode
      )
    }))
  )

  const okResults = guildResults.filter(({ result }) => result.ok)
  if (okResults.length === 0) {
    const firstFailure = guildResults.find(({ result }) => !result.ok)
    return buildErrorResponse(
      firstFailure && !firstFailure.result.ok
        ? firstFailure.result.message
        : 'Unable to load token data for the selected guild(s).'
    )
  }

  const normalizedQuery = normalizeName(playerQuery)
  // Display only; the filter above matches the raw displayName.
  const memberLabels = await getMemberLabelMap()
  const matches = okResults.flatMap(({ guild, result }) =>
    (result.ok ? result.players : [])
      .filter((player) =>
        normalizeName(player.displayName).includes(normalizedQuery)
      )
      .map((player) => ({
        guildLabel: formatGuildLabel(guild),
        displayName: resolveMemberLabel(player.displayName, memberLabels),
        tokensAvailable: player.tokensAvailable,
        tokensUsed: player.tokensUsed,
        bombsAvailable: player.bombsAvailable,
        tokenCooldown: player.tokenCooldown,
        bombCooldown: player.bombCooldown
      }))
  )

  if (matches.length === 0) {
    return buildErrorResponse(
      `No players matching "${playerQuery}" were found in the selected guilds.`
    )
  }

  const limitedMatches = matches.slice(0, MAX_PLAYER_RESULTS)
  const truncated = matches.length > limitedMatches.length

  const theme = resolveTheme(
    targetGuilds[0]?.guildCode ?? linkedGuilds[0]?.guildCode
  )
  const summaryLines = [
    season ? `Season: ${season}` : null,
    `Guilds searched: ${okResults
      .map(({ guild }) => formatGuildLabel(guild))
      .join(', ')}`,
    `Matches found: ${matches.length}`,
    truncated
      ? `Showing first ${limitedMatches.length} matches.`
      : 'Showing all matches.'
  ].filter((line): line is string => Boolean(line))

  const lines = limitedMatches.map((match) => formatMatchLine(match))
  const memberField: APIEmbedField = {
    name: 'Players',
    value: lines.length > 0 ? lines.join('\n') : 'No matching players found.'
  }

  return createCommandResponse(theme, {
    title: `Player Tokens - "${playerQuery}"`,
    description:
      'Current guild-raid tokens and bombs on hand for the requested player name.',
    color: COLOR_PALETTE.info,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n')
      },
      memberField
    ],
    footer: `Same data source as /tokens. Generated at ${new Date().toLocaleString()}`,
    useThemeAccent: false
  })
}
