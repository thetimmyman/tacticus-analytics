import { ImageResponse } from 'next/og'
import { getPlayerPerformanceSummaryRPC } from '@/app/lib/calculations/experimental/player-performance-summary'
import { BidirectionalBarChart, ChartFrame } from '../chart-components'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  cacheDiscordChart,
  resolveDiscordGuildSeasonContext
} from '../request-context'
import { verifyChartSignature } from '../signed-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACCENT_COLOR = '#c6a853'
const ROW_HEIGHT = 22
const HEADER_HEIGHT = 100
const FOOTER_HEIGHT = 50

export const GET = withErrorHandler(async (request: Request) => {
  const auth = verifyChartSignature(request)
  if (!auth.ok) return auth.response

  const resolved = await resolveDiscordGuildSeasonContext(request)
  if (!resolved.ok) return resolved.response
  const { guild, guildLabel, season, supabase, privacy } = resolved.context

  const summaries = await getPlayerPerformanceSummaryRPC(supabase, {
    Guild: guild,
    Season: season
  })

  if (summaries.length === 0) {
    return new Response(
      `No performance data found for guild ${guildLabel} in season ${season}`,
      { status: 404 }
    )
  }

  const chartData = summaries.map((s) => ({
    // No duplicate-name aliases; `hide_players` anonymises all labels.
    label: privacy.playerLabel(s.displayName),
    value: Math.round(s.avg_vs_guild * 100) / 100
  }))

  const imageHeight = Math.min(
    1600,
    Math.max(400, HEADER_HEIGHT + chartData.length * ROW_HEIGHT + FOOTER_HEIGHT)
  )

  return cacheDiscordChart(
    new ImageResponse(
      <ChartFrame
        title={`Weighted Average Performance vs Guild [%]`}
        subtitle={`${guildLabel} - Season ${season}`}
        accentColor={ACCENT_COLOR}
      >
        <BidirectionalBarChart data={chartData} />
      </ChartFrame>,
      { width: 900, height: imageHeight }
    )
  )
})
