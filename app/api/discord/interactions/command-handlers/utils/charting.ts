import { APP_ORIGINS } from '@tacticus/app-core/app-config'
import { createComponentLogger } from '@/app/lib/logging'
import {
  ChartUrlSecretMissingError,
  signChartUrl
} from '@/app/api/discord/charts/signed-url'

const logger = createComponentLogger('discord.command-handlers.charting')

export const DISCORD_CHART_ENDPOINTS = {
  raid: '/api/discord/charts/raid',
  boss: '/api/discord/charts/boss',
  player: '/api/discord/charts/player',
  playerTime: '/api/discord/charts/player-time',
  playerPerformance: '/api/discord/charts/player-performance',
  playerRadar: '/api/discord/charts/player-radar'
} as const

type ChartParams = Record<string, string | number | boolean | null | undefined>

/** Signed because Discord's proxy fetches it verbatim. Null, never an unsigned URL, without base URL or secret. */
export function buildChartUrl(
  path: string,
  params: ChartParams
): string | null {
  const baseUrl = APP_ORIGINS.CURRENT
  if (!baseUrl) return null

  const url = new URL(path, baseUrl)
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    url.searchParams.set(key, String(value))
  })

  try {
    return signChartUrl(url.toString())
  } catch (error) {
    if (error instanceof ChartUrlSecretMissingError) {
      logger.error(
        { path, envVar: 'DISCORD_CHART_URL_SECRET' },
        'Cannot sign Discord chart URL; omitting the chart image from the embed'
      )
      return null
    }
    throw error
  }
}
