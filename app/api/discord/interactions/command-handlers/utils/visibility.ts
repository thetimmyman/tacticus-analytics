import type { APIApplicationCommandInteractionDataOption } from 'discord-api-types/v10'
import type { CommandResponse } from '../types'
import { getOptionValue } from './option-parser'
import { asPublicResponse } from './response-builder'

export type VisibilityOptions = {
  publicOptionRaw: boolean | undefined
  mentionOptionRaw: boolean | undefined
  isPublic: boolean
  useMention: boolean
  // Errors after a public defer must stay public or the route replaces them.
  errorVisibility: (response: CommandResponse) => CommandResponse
}

// Keep `defaultPublic` in sync with command-manifest.ts PUBLIC_OPTION_DEFAULTS.
export function resolveVisibilityOptions(
  options: readonly APIApplicationCommandInteractionDataOption[] | undefined,
  { defaultPublic }: { defaultPublic: boolean }
): VisibilityOptions {
  const publicOptionRaw = getOptionValue<boolean>(options, 'public')
  const mentionOptionRaw = getOptionValue<boolean>(options, 'mention')

  const isPublic = defaultPublic
    ? publicOptionRaw !== false
    : publicOptionRaw === true

  const useMention = isPublic
    ? mentionOptionRaw !== false
    : Boolean(mentionOptionRaw)

  const errorVisibility = (response: CommandResponse) =>
    isPublic ? asPublicResponse(response) : response

  return {
    publicOptionRaw,
    mentionOptionRaw,
    isPublic,
    useMention,
    errorVisibility
  }
}

// Unmatched labels sort last.

export function cooldownToSeconds(cooldown: string | null): number {
  if (!cooldown) return 999999
  const hoursMatch = cooldown.match(/(\d+)h/)
  const minutesMatch = cooldown.match(/(\d+)m/)
  const hours = hoursMatch ? parseInt(hoursMatch[1] ?? '0', 10) : 0
  const minutes = minutesMatch ? parseInt(minutesMatch[1] ?? '0', 10) : 0
  return hours * 3600 + minutes * 60
}
