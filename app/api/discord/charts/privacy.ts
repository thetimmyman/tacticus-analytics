import type { Database } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import {
  ANONYMOUS_PLAYER_LABEL,
  parseExplorePrivacyModes,
  type ExplorePrivacyModes
} from '@tacticus/app-core/explore-privacy'

const logger = createComponentLogger('api.discord.charts.privacy')

export { ANONYMOUS_PLAYER_LABEL, parseExplorePrivacyModes }

/** hide_all refuses, hide_players anonymises; read via the service role. */

const PRIVACY_SELECT = 'explore_privacy_mode'

export interface ChartPrivacy {
  modes: ExplorePrivacyModes
  hideAll: boolean
  hidePlayers: boolean
  playerLabel: (name: string) => string
}

export interface ChartPrivacyDependencies {
  loadModes?: (
    supabase: Database,
    guildCode: string
  ) => Promise<ExplorePrivacyModes>
}

async function loadGuildPrivacyModes(
  supabase: Database,
  guildCode: string
): Promise<ExplorePrivacyModes> {
  const { data, error } = await supabase
    .from('guild_config')
    .select(PRIVACY_SELECT)
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (error) {
    // Fail closed: a lookup error must not read as "public".
    logger.warn(
      { guildCode, error },
      'Chart privacy lookup failed; treating guild as hide_all'
    )
    return ['hide_all']
  }

  return parseExplorePrivacyModes(
    (data as { explore_privacy_mode?: unknown } | null)?.explore_privacy_mode
  )
}

export async function resolveChartPrivacy(
  supabase: Database,
  guildCode: string,
  dependencies: ChartPrivacyDependencies = {}
): Promise<ChartPrivacy> {
  const load = dependencies.loadModes ?? loadGuildPrivacyModes
  const modes = await load(supabase, guildCode)
  const hideAll = modes.includes('hide_all')
  const hidePlayers = modes.includes('hide_players')

  return {
    modes,
    hideAll,
    hidePlayers,
    playerLabel: (name: string) => (hidePlayers ? ANONYMOUS_PLAYER_LABEL : name)
  }
}

export function guildHiddenResponse(): Response {
  return new Response('This guild has hidden its public data', {
    status: 403,
    headers: { 'Cache-Control': 'private, no-store' }
  })
}
