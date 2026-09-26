import type { APIEmbedField } from 'discord-api-types/v10'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  resolveTheme,
  COLOR_PALETTE
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  formatGuildLabel,
  resolveGuildContext
} from '../../utils/guild-resolution'
import { buildChartUrl, DISCORD_CHART_ENDPOINTS } from '../../utils/charting'
import { getCurrentSeason } from '../tokens/shared'
import { fetchGuildPerformanceSummary, fetchPlayerRadarData } from './data'
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export async function handlePlayerPerformanceCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const playerOption = (
    getOptionValue(interaction.data.options, 'player') as string | undefined
  )?.trim()
  const guildOption = getOptionValue(interaction.data.options, 'guild') as
    string | undefined
  const seasonOption = getOptionValue(interaction.data.options, 'season') as
    string | undefined

  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption: guildOption,
    scope: 'tokens'
  })
  if (!guildResolution.ok) {
    return guildResolution.response
  }

  let season = seasonOption
  if (!season) {
    try {
      season = await getCurrentSeason(supabase)
    } catch (error) {
      rethrowIfAppError(error)
      return buildErrorResponse(
        'Unable to determine the current season. Please specify a season or try again later.'
      )
    }
  }

  const guildCode = guildResolution.guild.guildCode
  const guildLabel = formatGuildLabel(guildResolution.guild)

  if (playerOption) {
    return handlePlayerRadar(supabase, {
      playerName: playerOption,
      guildCode,
      guildLabel,
      season
    })
  }

  return handleGuildPerformance(supabase, {
    guildCode,
    guildLabel,
    season
  })
}

async function handleGuildPerformance(
  supabase: Supabase,
  {
    guildCode,
    guildLabel,
    season
  }: { guildCode: string; guildLabel: string; season: string }
): Promise<CommandResponse> {
  const result = await fetchGuildPerformanceSummary(supabase, {
    guild: guildCode,
    season
  })

  if (!result.ok) {
    return buildErrorResponse(result.message)
  }

  const { summaries } = result
  // Display-only; sorting and identity use avg_vs_guild / playerId.
  const memberLabels = await getMemberLabelMap()
  const sorted = [...summaries].sort((a, b) => b.avg_vs_guild - a.avg_vs_guild)

  const topPerformers = sorted.slice(0, 5)
  // Starts past the top slice so small guilds never list a player in both.
  const bottomPerformers = sorted
    .slice(Math.max(topPerformers.length, sorted.length - 3))
    .reverse()

  const overviewLines = [
    `Guild: ${guildLabel}`,
    `Season: ${season}`,
    `Players tracked: ${summaries.length}`
  ]

  const topLines = topPerformers.map((p, i) => {
    const sign = p.avg_vs_guild >= 0 ? '+' : ''
    return `${i + 1}. **${resolveMemberLabel(p.displayName, memberLabels)}** — ${sign}${Math.round(p.avg_vs_guild)}% vs guild`
  })

  const bottomLines = bottomPerformers.map((p) => {
    const sign = p.avg_vs_guild >= 0 ? '+' : ''
    return `• ${resolveMemberLabel(p.displayName, memberLabels)} — ${sign}${Math.round(p.avg_vs_guild)}% vs guild`
  })

  const fields: APIEmbedField[] = [
    { name: 'Overview', value: overviewLines.join('\n') },
    { name: 'Top Performers', value: topLines.join('\n') || 'No data' }
  ]

  if (bottomLines.length > 0) {
    fields.push({ name: 'Needs Improvement', value: bottomLines.join('\n') })
  }

  const chartUrl = buildChartUrl(DISCORD_CHART_ENDPOINTS.playerPerformance, {
    guild: guildCode,
    season
  })

  const theme = resolveTheme(guildCode)
  return createCommandResponse(theme, {
    title: `Performance vs Guild - ${guildLabel}`,
    description:
      'Weighted average performance comparison for all guild members.',
    color: COLOR_PALETTE.info,
    fields,
    footer: `Season ${season}`,
    useThemeAccent: false,
    imageUrl: chartUrl ?? undefined
  })
}

async function handlePlayerRadar(
  supabase: Supabase,
  {
    playerName,
    guildCode,
    guildLabel,
    season
  }: {
    playerName: string
    guildCode: string
    guildLabel: string
    season: string
  }
): Promise<CommandResponse> {
  const result = await fetchPlayerRadarData(supabase, {
    guild: guildCode,
    season,
    playerName
  })

  if (!result.ok) {
    return buildErrorResponse(result.message)
  }

  const { rows, hasCluster } = result

  // The chart URL `player` param stays raw: it is a DB lookup key.
  const memberLabels = await getMemberLabelMap()

  const bossLines = rows.slice(0, 8).map((r) => {
    const nameClean = r.boss_name.split('_')[0] || r.boss_name
    const set = typeof r.set === 'number' ? r.set : 0
    const rarity =
      typeof r.rarity === 'string' && r.rarity ? r.rarity : 'Legendary'
    const level = getBossLevelFromSetAndRarity(set, rarity)
    const label = level ? `${nameClean} (${level})` : nameClean
    const gSign = r.vs_guild_pct >= 0 ? '+' : ''
    return `• **${label}** — ${gSign}${Math.round(r.vs_guild_pct)}% vs guild`
  })

  const avgVsGuild =
    rows.reduce((sum, r) => sum + r.vs_guild_pct, 0) / rows.length

  const overviewLines = [
    `Guild: ${guildLabel}`,
    `Season: ${season}`,
    `Targets tracked: ${rows.length}`,
    `Avg vs guild: ${avgVsGuild >= 0 ? '+' : ''}${Math.round(avgVsGuild)}%`
  ]

  const fields: APIEmbedField[] = [
    { name: 'Overview', value: overviewLines.join('\n') },
    { name: 'Boss Breakdown', value: bossLines.join('\n') || 'No boss data' }
  ]

  const chartUrl = buildChartUrl(DISCORD_CHART_ENDPOINTS.playerRadar, {
    player: playerName,
    guild: guildCode,
    season
  })

  const theme = resolveTheme(guildCode)
  return createCommandResponse(theme, {
    title: `Performance Radar — ${resolveMemberLabel(playerName, memberLabels)}`,
    description: `Boss & prime performance comparison${hasCluster ? ' against guild and cluster averages' : ' against guild average'}.`,
    color: COLOR_PALETTE.info,
    fields,
    footer: `Season ${season}`,
    useThemeAccent: false,
    imageUrl: chartUrl ?? undefined
  })
}
