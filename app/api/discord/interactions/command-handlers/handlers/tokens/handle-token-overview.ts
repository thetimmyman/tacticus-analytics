import type { APIEmbedField } from 'discord-api-types/v10'
import { resolveVisibilityOptions } from '../../utils/visibility'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  resolveTheme,
  COLOR_PALETTE,
  HOMINA_POWERED_BY_TEXT
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import { resolveGuildContext } from '../../utils/guild-resolution'
import {
  formatPlayerIdentifier,
  chunkLinesIntoFields
} from '../../utils/formatting'
import { fetchGuildTokens } from './fetch-guild-tokens'
import { getCurrentSeason } from './shared'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import {
  calculateBurnedTokens,
  computeGuildMaxPossibleTokens,
  MAX_POSSIBLE_HARD_CAP
} from '@/app/lib/calculations/token-burn'

export async function handleTokenOverviewCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const requestedGuildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined
  const { isPublic, useMention, errorVisibility } = resolveVisibilityOptions(
    interaction.data.options,
    { defaultPublic: true }
  )

  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption,
    scope: 'tokens'
  })
  if (!guildResolution.ok) {
    return errorVisibility(guildResolution.response)
  }

  const targetGuildCode = guildResolution.guild.guildCode

  const tokensResult = await fetchGuildTokens(
    supabase,
    targetGuildCode,
    requestedSeason,
    guildResolution.guild.clusterCode
  )

  if (!tokensResult.ok) {
    return errorVisibility(buildErrorResponse(tokensResult.message))
  }

  const players = tokensResult.players

  let seasonLabel: string
  try {
    seasonLabel = requestedSeason || (await getCurrentSeason(supabase))
  } catch {
    seasonLabel = '?'
  }

  // "Behind pace" = distance behind the most active member, not tokens lost to the cap.
  const maxPossible = computeGuildMaxPossibleTokens(
    players.map((p) => ({
      totalTokens: p.tokensUsed,
      tokensAvailable: p.tokensAvailable
    }))
  )

  const overviewData = players.map((p) => {
    const burned =
      calculateBurnedTokens(
        maxPossible,
        p.tokensAvailable,
        p.tokensUsed,
        p.tokenNextSeconds
      ) ?? 0
    return { ...p, burned }
  })

  overviewData.sort((a, b) => {
    if (a.burned !== b.burned) return b.burned - a.burned
    if (a.tokensAvailable !== b.tokensAvailable)
      return b.tokensAvailable - a.tokensAvailable
    if (a.tokensUsed !== b.tokensUsed) return b.tokensUsed - a.tokensUsed
    return a.displayName.localeCompare(b.displayName)
  })

  const theme = resolveTheme(targetGuildCode)

  // Display-only relabel; displayName stays raw as the sort and lookup key.
  const memberLabels = await getMemberLabelMap()

  const lines = overviewData.map((p) => {
    const playerName = formatPlayerIdentifier(
      resolveMemberLabel(p.displayName, memberLabels),
      p.discordUserId,
      useMention
    )

    let statusIcon: string
    if (p.tokensAvailable >= 3 && p.tokensUsed === 0) {
      statusIcon = '\u{1F534}' // red circle — capped & 0 used (inactive)
    } else if (p.tokensAvailable >= 3) {
      statusIcon = '\u26A0\uFE0F' // warning — capped (may be burning)
    } else if (p.tokensAvailable === 0) {
      statusIcon = '\u2705' // checkmark — all tokens spent
    } else {
      statusIcon = '\u{1F535}' // blue circle — has tokens available
    }

    const paceDisplay =
      p.burned > 0 ? `\u{1F525}${p.burned} behind pace` : `\u{1F4A7}on pace`

    return `${statusIcon} ${p.tokensAvailable}/3 avail \u00B7 ${p.tokensUsed} used \u00B7 ${paceDisplay} \u2014 ${playerName}`
  })

  const totalAvailable = overviewData.reduce(
    (sum, p) => sum + p.tokensAvailable,
    0
  )
  const maxAvailable = players.length * 3
  const totalUsed = overviewData.reduce((sum, p) => sum + p.tokensUsed, 0)
  const totalBurned = overviewData.reduce((sum, p) => sum + p.burned, 0)

  const memberFields = chunkLinesIntoFields('Overview', lines)

  const summaryFields: APIEmbedField[] = [
    {
      name: 'Total available',
      value: `${totalAvailable}/${maxAvailable}`,
      inline: true
    },
    { name: 'Total used this season', value: `${totalUsed}`, inline: true },
    {
      name: 'Behind pace (total)',
      value: `${totalBurned} \u{1F525}`,
      inline: true
    }
  ]

  const legendField: APIEmbedField = {
    name: 'What does "behind pace" mean?',
    value: [
      `We take the highest \`used + available\` across all members as the pace-setting max this season (**${maxPossible}**) \u2014 the most active member.`,
      "A member's *behind pace* = floor(max \u2212 (used + available + regen-in-progress)): how many tokens they trail the pace-setter by.",
      'Non-capped players get fractional credit for the portion of their next 12h regen cycle already elapsed, so anyone less than a full cycle behind shows **on pace**.\n',
      '\u26a0\ufe0f *This is a participation proxy, not tokens physically lost.* Tokens actually wasted by sitting at the 3/3 cap ("Overcapped") need battle-history compute and are shown on the web **/token-usage** and **Performance** pages, not here.\n',
      '*Caveats:*',
      '\u2022 Assumes at least one member is setting a full pace; if everyone is behind, counts are underreported.',
      '\u2022 Capped (3/3) players get no regen-in-progress credit (regen is paused at cap).',
      `\u2022 Pace-setting max is hard-capped at ${MAX_POSSIBLE_HARD_CAP} to guard against data anomalies.`
    ].join('\n')
  }

  return createCommandResponse(theme, {
    title: `Token Overview \u2014 Season ${seasonLabel}`,
    description: [
      "Shows each member's currently available tokens, how many they've used, and how far they are behind the guild's pace this season.",
      'Nb! This command should always be looked at with the knowledge that the token calculations contains a \u00B11 uncertainty.\n',
      '\u{1F534} Capped & 0 used (inactive)',
      '\u26A0\uFE0F Capped (may be wasting regen)',
      '\u{1F535} Has tokens available',
      '\u2705 All tokens spent',
      '\u{1F525} Behind pace = tokens behind the most active member (pace-setting max: ' +
        maxPossible +
        ')',
      '\u{1F4A7} On pace'
    ].join('\n'),
    color: COLOR_PALETTE.info,
    fields: [...memberFields, ...summaryFields, legendField],
    footer: HOMINA_POWERED_BY_TEXT,
    useThemeAccent: false,
    ephemeral: !isPublic
  })
}
