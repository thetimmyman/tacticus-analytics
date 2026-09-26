import { resolveGuildDisplayLabel } from '@/app/api/discord/guild-label'
import { serviceDb, type Database } from '@/app/lib/db'
import { getCurrentSeason } from '../interactions/command-handlers/handlers/tokens/shared'
import { normalizeGuildParam } from './guild-param'
import {
  guildHiddenResponse,
  resolveChartPrivacy,
  type ChartPrivacy,
  type ChartPrivacyDependencies
} from './privacy'

// No shared cache may re-serve restricted guild data unsigned.
const DISCORD_CHART_CACHE_CONTROL = 'private, no-store'

interface DiscordGuildSeasonContext {
  guild: string
  guildLabel: string
  season: string
  supabase: Database
  privacy: ChartPrivacy
}

interface DiscordChartContextDependencies extends ChartPrivacyDependencies {
  createDatabase?: () => Database
  getSeason?: typeof getCurrentSeason
  resolveGuildLabel?: typeof resolveGuildDisplayLabel
}

type DiscordGuildSeasonResult =
  | { ok: true; context: DiscordGuildSeasonContext }
  | { ok: false; response: Response }

/** No authentication: callers MUST have passed verifyChartSignature. Applies explore privacy. */
export async function resolveDiscordGuildSeasonContext(
  request: Request,
  options: {
    missingGuildMessage?: string
    dependencies?: DiscordChartContextDependencies
  } = {}
): Promise<DiscordGuildSeasonResult> {
  const { searchParams } = new URL(request.url)
  const guild = normalizeGuildParam(searchParams.get('guild'))
  if (!guild) {
    return {
      ok: false,
      response: new Response(
        options.missingGuildMessage ?? 'Missing guild parameter',
        { status: 400 }
      )
    }
  }

  const createDatabase = options.dependencies?.createDatabase ?? serviceDb
  const resolveGuildLabel =
    options.dependencies?.resolveGuildLabel ?? resolveGuildDisplayLabel
  const getSeason = options.dependencies?.getSeason ?? getCurrentSeason
  const supabase = createDatabase()

  // A hide_all guild must cost one lookup.
  const privacy = await resolveChartPrivacy(supabase, guild, {
    loadModes: options.dependencies?.loadModes
  })
  if (privacy.hideAll) {
    return { ok: false, response: guildHiddenResponse() }
  }

  const guildLabel = await resolveGuildLabel(supabase, guild)
  let season = searchParams.get('season')?.trim()
  if (!season) {
    try {
      season = await getSeason(supabase)
    } catch {
      return {
        ok: false,
        response: new Response('Unable to determine season', { status: 500 })
      }
    }
  }

  return {
    ok: true,
    context: { guild, guildLabel, season, supabase, privacy }
  }
}

export function cacheDiscordChart<T extends Response>(response: T): T {
  response.headers.set('Cache-Control', DISCORD_CHART_CACHE_CONTROL)
  return response
}
