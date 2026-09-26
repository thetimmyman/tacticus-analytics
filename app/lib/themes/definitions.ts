import type { GuildTheme } from './definitions/types'
import { guildThemes1 } from './definitions/guild-themes-1'
import { guildThemes2 } from './definitions/guild-themes-2'
import { guildThemes3 } from './definitions/guild-themes-3'
import { specialThemes } from './definitions/special-themes'

export type { GuildTheme } from './definitions/types'
export { specialThemes } from './definitions/special-themes'
// Spread order 1 -> 2 -> 3 preserves the themes' key order.
export const guildThemes: Record<string, GuildTheme> = {
  ...guildThemes1,
  ...guildThemes2,
  ...guildThemes3
}

export const allThemes = { ...guildThemes, ...specialThemes }
