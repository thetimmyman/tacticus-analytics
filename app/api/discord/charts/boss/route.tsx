import { ImageResponse } from 'next/og'
import { fetchBossLeaderboardSummary } from '../../interactions/command-handlers/handlers/boss/data'
import { BarChart, ChartFrame, DISCORD_CHART_SIZE } from '../chart-components'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  cacheDiscordChart,
  resolveDiscordGuildSeasonContext
} from '../request-context'
import { verifyChartSignature } from '../signed-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BOSS_ACCENT = '#22c55e'

export const GET = withErrorHandler(async (request: Request) => {
  const auth = verifyChartSignature(request)
  if (!auth.ok) return auth.response

  const resolved = await resolveDiscordGuildSeasonContext(request)
  if (!resolved.ok) return resolved.response
  const { guild, guildLabel, season, supabase } = resolved.context

  const summaryResult = await fetchBossLeaderboardSummary(supabase, {
    guild,
    guildLabel,
    season,
    limit: 6
  })

  if (!summaryResult.ok) {
    return new Response(summaryResult.message, { status: 404 })
  }

  const summary = summaryResult.summary
  const chartData = summary.leaderboard.map((entry) => ({
    label: `${entry.name} ${entry.level} L${entry.loop}`,
    value: entry.totalDamage
  }))

  return cacheDiscordChart(
    new ImageResponse(
      <ChartFrame
        title="Boss leaderboard damage"
        subtitle={`${summary.guildLabel} - Season ${summary.season}`}
        accentColor={BOSS_ACCENT}
      >
        <BarChart
          data={chartData}
          accentColor={BOSS_ACCENT}
          maxLabelWidth={200}
        />
      </ChartFrame>,
      DISCORD_CHART_SIZE
    )
  )
})
