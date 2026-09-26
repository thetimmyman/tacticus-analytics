import { ImageResponse } from 'next/og'
import { getPlayerBossPerformanceRPC } from '@/app/lib/calculations/experimental/player-boss-performance'
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import { RadarChartSVG, ChartFrame, type RadarDatum } from '../chart-components'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  cacheDiscordChart,
  resolveDiscordGuildSeasonContext
} from '../request-context'
import { verifyChartSignature } from '../signed-url'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ACCENT_COLOR = '#3b82f6'

export const GET = withErrorHandler(async (request: Request) => {
  const auth = verifyChartSignature(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const player = searchParams.get('player')?.trim()

  if (!player) {
    return new Response('Missing player or guild parameter', { status: 400 })
  }

  const resolved = await resolveDiscordGuildSeasonContext(request, {
    missingGuildMessage: 'Missing player or guild parameter'
  })
  if (!resolved.ok) return resolved.response
  const { guild, guildLabel, season, supabase, privacy } = resolved.context
  // hide_players guilds still get the chart (the request was signed), minus the name.
  const playerLabel = privacy.playerLabel(player)

  const rows = await getPlayerBossPerformanceRPC(supabase, {
    Guild: guild,
    Season: season,
    displayName: player
  })

  if (rows.length === 0) {
    return new Response(
      `No performance data found for ${playerLabel} in guild ${guildLabel}, season ${season}`,
      { status: 404 }
    )
  }

  const hasCluster = rows.some(
    (r) => r.cluster_avg !== null && r.cluster_avg !== 0
  )

  const radarData: RadarDatum[] = rows
    .filter((r) => r.boss_name && r.battle_count && r.battle_count > 0)
    .map((r) => {
      const bossNameClean = r.boss_name.split('_')[0] || r.boss_name
      const set = typeof r.set === 'number' ? r.set : 0
      const rarity =
        typeof r.rarity === 'string' && r.rarity ? r.rarity : 'Legendary'
      const level = getBossLevelFromSetAndRarity(set, rarity)
      return {
        label: level ? `${bossNameClean} (${level})` : bossNameClean,
        vsGuild: r.vs_guild_pct ?? 0,
        vsCluster: r.vs_cluster_pct ?? 0,
        sortKey: set
      }
    })
    .sort((a, b) => a.sortKey - b.sortKey)

  if (radarData.length === 0) {
    return new Response(`No boss performance data found for ${playerLabel}`, {
      status: 404
    })
  }

  return cacheDiscordChart(
    new ImageResponse(
      <ChartFrame
        title={`Boss & Prime Performance Radar`}
        subtitle={`${playerLabel} - ${guildLabel} - Season ${season}`}
        accentColor={ACCENT_COLOR}
      >
        <RadarChartSVG
          data={radarData}
          playerName={playerLabel}
          hasCluster={hasCluster}
        />
      </ChartFrame>,
      { width: 800, height: 700 }
    )
  )
})
