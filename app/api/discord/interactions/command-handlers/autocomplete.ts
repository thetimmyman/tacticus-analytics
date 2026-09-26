import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.autocomplete'
)
import type {
  APIChatInputApplicationCommandInteraction,
  APIApplicationCommandAutocompleteInteraction,
  APIApplicationCommandInteractionDataOption
} from 'discord-api-types/v10'
import type { Supabase } from './types'
import { getLinkedGuilds } from './utils/guild-resolution'
import { isFocusedOption } from './utils/option-parser'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

type PlayerAutocompleteRow = {
  display_name: string
}

export async function getPlayerAutocompleteChoices(
  supabase: Supabase,
  interaction:
    | APIChatInputApplicationCommandInteraction
    | APIApplicationCommandAutocompleteInteraction
): Promise<Array<{ name: string; value: string }>> {
  const linkedGuilds = await getLinkedGuilds(supabase, interaction.guild_id)
  if (linkedGuilds.length === 0) {
    return []
  }

  const options = interaction.data.options as
    APIApplicationCommandInteractionDataOption[] | undefined
  const focusedOption = options?.find(isFocusedOption)
  const query =
    focusedOption &&
    'value' in focusedOption &&
    typeof focusedOption.value === 'string'
      ? focusedOption.value.trim()
      : ''

  // `value` stays the raw suffixed display_name because the follow-up command matches on it.
  const memberLabels = await getMemberLabelMap()
  const normalizedQuery = query.toLocaleLowerCase()
  const guildCodes = linkedGuilds.map((g) => g.guildCode)
  const queryPlayers = (displayNames?: string[]) => {
    let builder = supabase
      .from('player_mapping')
      .select('display_name')
      .in('guild_code', guildCodes)
      .eq('is_current', true)
    if (displayNames) {
      builder = builder.in('display_name', displayNames)
    } else if (query) {
      // Filter in Postgres before the candidate cap, or matches past row 250 never surface.
      builder = builder.ilike('display_name', `%${query}%`)
    }
    return builder.order('display_name').limit(250)
  }

  const aliasDisplayNames = query
    ? [...memberLabels.entries()]
        .filter(([, label]) =>
          label.toLocaleLowerCase().includes(normalizedQuery)
        )
        .map(([displayName]) => displayName)
    : []
  const [rawResult, aliasResult] = await Promise.all([
    queryPlayers(),
    aliasDisplayNames.length > 0
      ? queryPlayers(aliasDisplayNames)
      : Promise.resolve({ data: [], error: null })
  ])

  if (rawResult.error || aliasResult.error) {
    logger.error(
      { err: rawResult.error ?? aliasResult.error },
      'Failed to load autocomplete player list:'
    )
    return []
  }

  const rowsByName = new Map<string, PlayerAutocompleteRow>()
  for (const row of [
    ...((rawResult.data ?? []) as unknown as PlayerAutocompleteRow[]),
    ...((aliasResult.data ?? []) as unknown as PlayerAutocompleteRow[])
  ]) {
    rowsByName.set(row.display_name, row)
  }

  return [...rowsByName.values()]
    .map((record) => ({
      // Discord rejects the response if any choice name exceeds 100 chars.
      name: resolveMemberLabel(record.display_name, memberLabels).slice(0, 100),
      value: record.display_name
    }))
    .filter(
      (choice) =>
        !normalizedQuery ||
        choice.value.toLocaleLowerCase().includes(normalizedQuery) ||
        choice.name.toLocaleLowerCase().includes(normalizedQuery)
    )
    .slice(0, 25)
}
