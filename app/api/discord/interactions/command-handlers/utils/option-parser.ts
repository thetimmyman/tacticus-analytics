import type { APIApplicationCommandInteractionDataOption } from 'discord-api-types/v10'

export function getOptionValue<T = unknown>(
  options: readonly APIApplicationCommandInteractionDataOption[] | undefined,
  name: string
): T | undefined {
  if (!options) return undefined

  for (const option of options) {
    if (option.name === name && 'value' in option) {
      return option.value as T
    }

    if ('options' in option && option.options) {
      const nested = getOptionValue<T>(option.options, name)
      if (nested !== undefined) {
        return nested
      }
    }
  }

  return undefined
}

export function isFocusedOption(
  option: APIApplicationCommandInteractionDataOption
): option is APIApplicationCommandInteractionDataOption & {
  focused: true
  value: unknown
} {
  return (
    'focused' in option && Boolean((option as { focused?: boolean }).focused)
  )
}
