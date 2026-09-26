import type { AutocompleteInteraction } from '../../types'
import playbooks from '@/data/boss-playbooks/playbooks.json'
import { stripNonAlnumLower } from '@/app/lib/resolvers/boss-identity'

const MAX_CHOICES = 25 // Discord's autocomplete choice cap

function normalize(value: string): string {
  return stripNonAlnumLower(value)
}

/** Static: Discord expects autocomplete answers within 3s. */
export function getBossAutocompleteChoices(
  interaction: AutocompleteInteraction
): Array<{ name: string; value: string }> {
  const focused = interaction.data.options?.find(
    (option) => 'focused' in option && option.focused === true
  )
  const typed =
    focused && 'value' in focused && typeof focused.value === 'string'
      ? normalize(focused.value)
      : ''

  return playbooks.bosses
    .map((boss) => ({ label: boss.name, value: boss.id }))
    .filter(
      (boss) =>
        typed.length === 0 ||
        normalize(boss.label).includes(typed) ||
        normalize(boss.value).includes(typed)
    )
    .slice(0, MAX_CHOICES)
    .map((boss) => ({
      name: boss.label,
      value: boss.value
    }))
}
