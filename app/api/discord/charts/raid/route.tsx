import { ImageResponse } from 'next/og'
import { fetchRaidStatusSummary } from '../../interactions/command-handlers/handlers/raid/data'
import { BarChart, ChartFrame, DISCORD_CHART_SIZE } from '../chart-components'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  cacheDiscordChart,
  resolveDiscordGuildSeasonContext
} from '../request-context'
import { verifyChartSignature } from '../signed-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RAID_ACCENT = '#5865f2'

export const GET = withErrorHandler(async (request: Request) => {
  const auth = verifyChartSignature(request)
  if (!auth.ok) return auth.response

  const resolved = await resolveDiscordGuildSeasonContext(request)
  if (!resolved.ok) return resolved.response
  const { guild, guildLabel, season, supabase } = resolved.context

  const summaryResult = await fetchRaidStatusSummary(supabase, {
    guild,
    guildLabel,
    season,
    trendDays: 7
  })

  if (!summaryResult.ok) {
    return new Response(summaryResult.message, { status: 404 })
  }

  const summary = summaryResult.summary
  const chartData = summary.trend.map((point) => ({
    label: point.label,
    value: point.value
  }))

  return cacheDiscordChart(
    new ImageResponse(
      <ChartFrame
        title="Raid damage trend"
        subtitle={`${summary.guildLabel} - Season ${summary.season}`}
        accentColor={RAID_ACCENT}
      >
        <BarChart
          data={chartData}
          accentColor={RAID_ACCENT}
          maxLabelWidth={80}
        />
      </ChartFrame>,
      DISCORD_CHART_SIZE
    )
  )
})
