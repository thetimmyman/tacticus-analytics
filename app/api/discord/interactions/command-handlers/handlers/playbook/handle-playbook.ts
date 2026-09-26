import { APP_ORIGINS } from '@tacticus/app-core/app-config'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  asPublicResponse,
  INFO_THEME
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import playbooks from '@/data/boss-playbooks/playbooks.json'

export async function handlePlaybookCommand(
  _supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const bossId = getOptionValue<string>(
    interaction.data.options,
    'boss'
  )?.trim()
  const boss = playbooks.bosses.find((entry) => entry.id === bossId)
  if (!bossId || !boss) {
    return buildErrorResponse(
      'Unknown boss. Start typing in the `boss` option and pick one of the suggestions.'
    )
  }

  const response = createCommandResponse(INFO_THEME, {
    title: `${boss.name} — playbook`,
    description: `Open the curated boss playbooks: ${APP_ORIGINS.CURRENT}/boss-playbooks`,
    useThemeAccent: false
  })
  const isPublic =
    getOptionValue<boolean>(interaction.data.options, 'public') === true
  return isPublic ? asPublicResponse(response) : response
}
