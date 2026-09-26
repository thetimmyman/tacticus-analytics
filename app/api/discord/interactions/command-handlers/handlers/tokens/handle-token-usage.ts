import type { APIEmbedField } from 'discord-api-types/v10'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  buildServerNotLinkedResponse,
  resolveTheme
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  formatGuildLabel,
  getLinkedGuilds,
  guildMatchesInput
} from '../../utils/guild-resolution'
import {
  normalizeGuild,
  normalizeName,
  calculateMedian,
  calculateStandardDeviation
} from '../../utils/formatting'
import {
  type TokenUsageRow,
  getCurrentSeason,
  loadActiveRoster,
  isPlayerInRoster,
  resolveCanonicalDisplayName,
  createRosterPlayerKey,
  resolveGuildLabel
} from './shared'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export async function handleTokenUsageCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const linkedGuilds = await getLinkedGuilds(supabase, interaction.guild_id)
  if (linkedGuilds.length === 0) {
    return buildServerNotLinkedResponse()
  }

  const accessibleGuilds = linkedGuilds.map((g) => g.guildCode)
  const accessibleGuildsUpper = accessibleGuilds.map(normalizeGuild)

  const requestedGuild = getOptionValue(interaction.data.options, 'guild') as
    string | undefined
  const requestedSeasonOption = getOptionValue(
    interaction.data.options,
    'season'
  ) as string | undefined
  const requestedGuildMatch =
    requestedGuild && normalizeGuild(requestedGuild) !== 'ALL'
      ? linkedGuilds.find((guild) => guildMatchesInput(guild, requestedGuild))
      : null
  const requestedGuildUpper: string = ((requestedGuild
    ? normalizeGuild(requestedGuildMatch?.guildCode ?? requestedGuild)
    : accessibleGuildsUpper[0]) ?? accessibleGuildsUpper[0]) as string
  const requestedGuildLabel = requestedGuildMatch
    ? formatGuildLabel(requestedGuildMatch)
    : (requestedGuild ??
      requestedGuildUpper ??
      accessibleGuilds[0] ??
      accessibleGuildsUpper[0])

  if (
    requestedGuildUpper !== 'ALL' &&
    !accessibleGuildsUpper.includes(requestedGuildUpper)
  ) {
    return buildErrorResponse(
      `Access denied: You don't have access to guild ${requestedGuildLabel}. Available guilds: ${linkedGuilds.map(formatGuildLabel).join(', ')}`
    )
  }

  let season: string
  try {
    season = requestedSeasonOption ?? (await getCurrentSeason(supabase))
  } catch {
    return buildErrorResponse(
      'Unable to determine the current season. Please specify a season or try again later.'
    )
  }
  const targetGuildsUpper: string[] =
    requestedGuildUpper === 'ALL'
      ? accessibleGuildsUpper
      : [requestedGuildUpper]
  const targetGuildLabels = targetGuildsUpper.map((g) =>
    resolveGuildLabel(g, accessibleGuildsUpper, accessibleGuilds)
  )

  const [rosterResult, usageQuery] = await Promise.all([
    loadActiveRoster(supabase, targetGuildsUpper),
    supabase
      .from('EOT_GR_data')
      .select('displayName, userId, Guild')
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .in('Guild', targetGuildLabels)
      .order('startedOn', { ascending: false })
  ])

  if (!rosterResult.ok) {
    return buildErrorResponse(rosterResult.message)
  }
  const roster = rosterResult.roster
  const { data, error } = usageQuery

  if (error) {
    return buildErrorResponse(
      `Failed to load token usage data: ${error.message}`
    )
  }

  const usageRows: TokenUsageRow[] = data ?? []

  type PlayerUsage = {
    key: string
    playerId: string | null
    displayName: string
    normalizedName: string
    guild: string
    normalizedGuild: string
    tokens: number
  }

  const usageByPlayer: Record<string, PlayerUsage> = {}

  usageRows.forEach((record) => {
    const guildLabel = record.Guild ?? ''
    const normalizedGuildVal = normalizeGuild(guildLabel)
    if (!targetGuildsUpper.includes(normalizedGuildVal)) {
      return
    }

    const playerId = record.userId ?? null
    const rawDisplayName = record.displayName ?? record.userId ?? null

    if (!isPlayerInRoster(roster, playerId, rawDisplayName)) {
      return
    }

    const canonicalDisplayName = resolveCanonicalDisplayName(
      roster,
      playerId,
      rawDisplayName
    )
    const normalizedPlayerName = normalizeName(canonicalDisplayName)
    const key = createRosterPlayerKey(
      roster,
      normalizedGuildVal,
      playerId,
      canonicalDisplayName
    )

    if (!usageByPlayer[key]) {
      usageByPlayer[key] = {
        key,
        playerId,
        displayName: canonicalDisplayName,
        normalizedName: normalizedPlayerName,
        guild: guildLabel || normalizedGuildVal,
        normalizedGuild: normalizedGuildVal,
        tokens: 0
      }
    }

    usageByPlayer[key].tokens += 1
  })

  const participants = Object.values(usageByPlayer)

  if (participants.length === 0) {
    const guildLabels = targetGuildsUpper
      .map((g) => resolveGuildLabel(g, accessibleGuildsUpper, accessibleGuilds))
      .join(', ')
    return buildErrorResponse(
      `No token usage data found for ${guildLabels} in season ${season}.`
    )
  }

  const tokenCounts = participants.map((player) => player.tokens)
  const totalTokensUsed = tokenCounts.reduce((sum, value) => sum + value, 0)
  const averageTokens =
    tokenCounts.length > 0 ? totalTokensUsed / tokenCounts.length : 0
  const medianTokens = calculateMedian(tokenCounts)
  const stdDeviation = calculateStandardDeviation(tokenCounts)

  const sortedPlayers = [...participants].sort((a, b) => {
    if (b.tokens !== a.tokens) {
      return b.tokens - a.tokens
    }
    return a.displayName.localeCompare(b.displayName)
  })

  // Display-only; displayName stays raw as the roster and sort key.
  const memberLabels = await getMemberLabelMap()
  const topPlayers = sortedPlayers.slice(0, 10).map((player, index) => {
    const placement = index + 1
    const guildLabel = resolveGuildLabel(
      player.normalizedGuild,
      accessibleGuildsUpper,
      accessibleGuilds
    )
    return `${placement}. ${resolveMemberLabel(player.displayName, memberLabels)} - ${player.tokens} tokens (${guildLabel})`
  })

  const themeGuildCode =
    requestedGuildUpper === 'ALL'
      ? (accessibleGuilds[0] ?? linkedGuilds[0]?.guildCode ?? null)
      : requestedGuildUpper
  const theme = resolveTheme(themeGuildCode)
  const summaryLines = [
    `Season: ${season}`,
    `Guilds covered: ${targetGuildsUpper.map((g) => resolveGuildLabel(g, accessibleGuildsUpper, accessibleGuilds)).join(', ')}`
  ]

  const highlightLines = [
    `- Median tokens used: ${medianTokens.toFixed(1)}`,
    `- Average tokens used: ${averageTokens.toFixed(1)}`,
    `- Standard deviation: ${stdDeviation.toFixed(1)}`,
    `- Total tokens logged: ${totalTokensUsed}`,
    `- Participants: ${participants.length}`
  ]

  const rankingField: APIEmbedField = {
    name: 'Top Members',
    value:
      topPlayers.length > 0
        ? topPlayers.join('\n')
        : 'No participants recorded.'
  }

  return createCommandResponse(theme, {
    title:
      requestedGuildUpper === 'ALL'
        ? `Token Usage - Season ${season} (All Linked Guilds)`
        : `Token Usage - Season ${season}`,
    description: 'Token consumption snapshot for the selected guilds.',
    color: 0x1e88e5,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n')
      },
      {
        name: 'Highlights',
        value: highlightLines.join('\n')
      },
      rankingField
    ],
    footer: `Generated at ${new Date().toLocaleString()}`,
    useThemeAccent: false
  })
}
