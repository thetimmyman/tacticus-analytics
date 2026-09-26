import { ImageResponse } from 'next/og'
import { serviceDb } from '@/app/lib/db'
import { fetchPlayerStatsSummary } from '../../interactions/command-handlers/handlers/player/data'
import { BarChart, ChartFrame, DISCORD_CHART_SIZE } from '../chart-components'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import { cacheDiscordChart } from '../request-context'
import { verifyChartSignature } from '../signed-url'
import { guildHiddenResponse, resolveChartPrivacy } from '../privacy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PLAYER_ACCENT = '#f97316'

export const GET = withErrorHandler(async (request: Request) => {
  const auth = verifyChartSignature(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const player = searchParams.get('player')?.trim()
  const seasonParam = searchParams.get('season')?.trim()
  const guildParam = searchParams.get('guild')?.trim()

  if (!player) {
    return new Response('Missing player parameter', { status: 400 })
  }
  if (!guildParam) {
    return new Response('Missing guild parameter', { status: 400 })
  }

  const supabase = serviceDb()

  // Not routed through resolveDiscordGuildSeasonContext, so apply the privacy gate here.
  const privacy = await resolveChartPrivacy(supabase, guildParam)
  if (privacy.hideAll) return guildHiddenResponse()

  const memberLabels = await getMemberLabelMap()
  let summaryResult
  try {
    summaryResult = await fetchPlayerStatsSummary(supabase, {
      playerName: player,
      season: seasonParam || undefined,
      linkedGuilds: [guildParam],
      requestedGuild: guildParam
    })
  } catch {
    return new Response('Unable to determine season', { status: 500 })
  }

  if (!summaryResult.ok) {
    return new Response(summaryResult.message, { status: 404 })
  }

  const summary = summaryResult.summary
  const chartData = summary.bossBreakdown.slice(0, 6).map((boss) => ({
    label: boss.name,
    value: boss.totalDamage
  }))

  return cacheDiscordChart(
    new ImageResponse(
      <ChartFrame
        title="Player damage by boss"
        subtitle={`${privacy.playerLabel(resolveMemberLabel(summary.displayName, memberLabels))} - ${summary.guildLabel} - Season ${summary.season}`}
        accentColor={PLAYER_ACCENT}
      >
        <BarChart
          data={chartData}
          accentColor={PLAYER_ACCENT}
          maxLabelWidth={200}
        />
      </ChartFrame>,
      DISCORD_CHART_SIZE
    )
  )
})
