import {
  loadPlayerNameMap,
  type PlayerNameMap
} from '../_shared/player-name-resolution.ts'
import {
  type FriendlyLabelMap,
  loadDuplicateNameLabels
} from '../_shared/duplicate-name-labels.ts'

export type DiscordCommandContext = {
  supabase: any
  playerNameMap: PlayerNameMap
  labelMap: FriendlyLabelMap
}
export {
  formatGuildLabel,
  getGuildMapping,
  verifyUserPermissions,
  type DiscordGuildMapping,
  type DiscordUserPermissions
} from './command-permissions.ts'

export async function createDiscordCommandContext(
  supabase: any
): Promise<DiscordCommandContext> {
  const [playerNameMap, labelMap] = await Promise.all([
    loadPlayerNameMap(supabase),
    loadDuplicateNameLabels(supabase)
  ])
  return { supabase, playerNameMap, labelMap }
}
