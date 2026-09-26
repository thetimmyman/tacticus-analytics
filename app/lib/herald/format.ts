import 'server-only'
import type { DiscordEmbed } from '@/app/lib/discord/types'
import type { EmojiResolver } from '@/app/lib/discord/emoji-resolver'
import { isKnownMachineOfWarName } from '@/app/lib/team-display-order'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import type { BombCalculationMode } from '@/app/lib/tacticus/bomb-damage'
import {
  type DefeatTransition,
  type AvailabilityTransition,
  type BombRangeTransition,
  type BossConfigExtraEntry
} from './contracts'

export const formatDefeatMessage = (transition: DefeatTransition): string => {
  const lines: string[] = [
    `💀 **${transition.boss_display_name}** has been defeated!`
  ]
  const killerLine: string[] = []
  if (transition.killer_display_name) {
    killerLine.push(`Slain by **${transition.killer_display_name}**`)
  }
  if (transition.set !== null && transition.rarity) {
    killerLine.push(
      deriveStageCodeFromSetAndRarity(transition.set, transition.rarity)
    )
  }
  if (killerLine.length > 0) {
    lines.push(killerLine.join(' • '))
  }
  return lines.join('\n')
}

export const isMowToken = (unit: string, mowKeys: Set<string>): boolean =>
  mowKeys.has(unit) ||
  mowKeys.has(unit.toLowerCase()) ||
  isKnownMachineOfWarName(unit)

const LEGENDARY_COLOR = 0xf5a623
const MYTHIC_COLOR = 0xc678dd
const DEFAULT_EMBED_COLOR = 0x4a5568

const colorForRarity = (rarity: string): number => {
  const lower = rarity.toLowerCase()
  if (lower === 'legendary') return LEGENDARY_COLOR
  if (lower === 'mythic') return MYTHIC_COLOR
  return DEFAULT_EMBED_COLOR
}

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`

// Discord renders `[X](Y)` raw when X looks like a URL, so blank or url-equal labels use the bare URL.
const renderExtraLine = (e: BossConfigExtraEntry): string => {
  const rawLabel = (e.label ?? '').trim()
  if (rawLabel.length === 0 || rawLabel === e.url) {
    return `• ${e.url}`
  }
  return `• [${truncate(rawLabel, 80)}](${e.url})`
}

export const formatDefeatEmbed = (
  transition: DefeatTransition,
  options?: { customDescription?: string | null }
): DiscordEmbed => {
  const detailParts: string[] = []
  if (transition.killer_display_name) {
    detailParts.push(`Slain by **${transition.killer_display_name}**`)
  }
  if (transition.set !== null && transition.rarity) {
    detailParts.push(
      deriveStageCodeFromSetAndRarity(transition.set, transition.rarity)
    )
  }

  const embed: DiscordEmbed = {
    title: `💀 ${transition.boss_display_name} has been defeated!`,
    color: colorForRarity(transition.rarity),
    timestamp: new Date(transition.completed_on).toISOString()
  }
  const customTrimmed = options?.customDescription?.trim() ?? ''
  if (customTrimmed.length > 0) {
    embed.description =
      detailParts.length > 0
        ? `${customTrimmed}\n\n— ${detailParts.join(' • ')}`
        : customTrimmed
  } else if (detailParts.length > 0) {
    embed.description = detailParts.join(' • ')
  }
  return embed
}

const BOMB_RANGE_EMBED_COLOR = 0xf59e0b // tailwind amber-500

const MODE_LABEL: Record<BombCalculationMode, string> = {
  worst_case: 'Worst case',
  average: 'Average',
  best_case: 'Best case'
}

export const formatBombRangeEmbed = (
  transition: BombRangeTransition
): DiscordEmbed => {
  const stageCode =
    transition.set !== null && transition.rarity
      ? deriveStageCodeFromSetAndRarity(transition.set, transition.rarity)
      : null
  const titleSuffix = stageCode ? ` (${stageCode})` : ''

  const scenarioLine = (mode: BombCalculationMode): string => {
    const sc = transition.scenarios[mode]
    const marker = mode === transition.mode ? '→ ' : '   '
    return `${marker}**${MODE_LABEL[mode]}:** ${sc.bombs_needed} bomb${sc.bombs_needed === 1 ? '' : 's'} @ ${sc.damage_per_bomb.toLocaleString()}/bomb`
  }

  const levelLine =
    transition.guild_level !== null
      ? `**Guild Level:** ${transition.guild_level} (${transition.damage_range.floor.toLocaleString()}–${transition.damage_range.ceil.toLocaleString()} per bomb)`
      : `**Guild Level:** unknown — falling back to ${transition.damage_range.floor.toLocaleString()}–${transition.damage_range.ceil.toLocaleString()}/bomb`

  // A prime at/below its kill threshold counts as dead: "do not bomb".
  const title = `💣 ${transition.boss_display_name}${titleSuffix} ${
    transition.under_kill_threshold
      ? 'is under threshold — considered dead'
      : 'is in bomb range!'
  }`
  const callToAction = transition.under_kill_threshold
    ? `**${transition.boss_display_name}** is under threshold and is considered dead. Do not bomb unless an officer calls for it.`
    : 'Boss is within bomb range! Please ask an officer for confirmation before bombing.'

  return {
    title,
    description: [
      `**Current HP:** ${transition.remaining_hp.toLocaleString()}`,
      `**Bombs Available:** ${transition.bombs_available}`,
      levelLine,
      '',
      scenarioLine('worst_case'),
      scenarioLine('average'),
      scenarioLine('best_case'),
      '',
      callToAction
    ].join('\n'),
    color: BOMB_RANGE_EMBED_COLOR,
    timestamp: new Date(transition.observed_at).toISOString()
  }
}

export const formatAvailabilityMessage = (
  transition: AvailabilityTransition
): string => {
  const lines: string[] = [
    `🎖️ **${transition.boss_display_name}** is now available!`
  ]
  if (transition.set !== null && transition.rarity) {
    lines.push(
      deriveStageCodeFromSetAndRarity(transition.set, transition.rarity)
    )
  }
  return lines.join('\n')
}

export const formatAvailabilityEmbed = (
  transition: AvailabilityTransition,
  extras: {
    extraLinks: BossConfigExtraEntry[]
    extraVideos: BossConfigExtraEntry[]
    customDescription?: string | null
    note?: string | null
    resolveEmoji?: EmojiResolver
  }
): DiscordEmbed => {
  const fields: DiscordEmbed['fields'] = []
  const resolveEmoji = extras.resolveEmoji ?? ((s: string) => s)

  const detailParts: string[] = []
  if (transition.set !== null && transition.rarity) {
    detailParts.push(
      deriveStageCodeFromSetAndRarity(transition.set, transition.rarity)
    )
  }

  const noteTrimmed = resolveEmoji(extras.note?.trim() ?? '')
  if (noteTrimmed.length > 0) {
    fields.push({
      name: '📝 Notes',
      value: truncate(noteTrimmed, 1024)
    })
  }

  const videoLines = extras.extraVideos.slice(0, 10).map(renderExtraLine)
  if (videoLines.length > 0) {
    fields.push({
      name: '🎬 Videos',
      value: truncate(videoLines.join('\n'), 1024)
    })
  }

  const linkLines = extras.extraLinks.slice(0, 10).map(renderExtraLine)
  if (linkLines.length > 0) {
    fields.push({
      name: '🔗 Links',
      value: truncate(linkLines.join('\n'), 1024)
    })
  }

  const embed: DiscordEmbed = {
    title: `🎖️ ${transition.boss_display_name} is now available!`,
    color: colorForRarity(transition.rarity),
    fields
  }
  const customTrimmed = resolveEmoji(extras.customDescription?.trim() ?? '')
  if (customTrimmed.length > 0) {
    embed.description =
      detailParts.length > 0
        ? `${customTrimmed}\n\n— ${detailParts.join(' • ')}`
        : customTrimmed
  } else if (detailParts.length > 0) {
    embed.description = detailParts.join(' • ')
  }
  return embed
}

// Embed-less variant (`guild_config.compact_availability_posts`); callers append role pings.
export const formatAvailabilityCompactMessage = (
  transition: AvailabilityTransition,
  extras: {
    extraLinks: BossConfigExtraEntry[]
    extraVideos: BossConfigExtraEntry[]
    customDescription?: string | null
    note?: string | null
    resolveEmoji?: EmojiResolver
  }
): string => {
  const sections: string[] = []
  const resolveEmoji = extras.resolveEmoji ?? ((s: string) => s)

  const stageCode =
    transition.set !== null && transition.rarity
      ? deriveStageCodeFromSetAndRarity(transition.set, transition.rarity)
      : null
  const customTrimmed = resolveEmoji(extras.customDescription?.trim() ?? '')
  if (customTrimmed.length > 0) {
    sections.push(`🎖️ **${transition.boss_display_name}** is now available!`)
    sections.push(
      stageCode ? `${customTrimmed}\n— ${stageCode}` : customTrimmed
    )
  } else {
    sections.push(
      stageCode
        ? `🎖️ **${transition.boss_display_name}** (${stageCode}) is now available!`
        : `🎖️ **${transition.boss_display_name}** is now available!`
    )
  }

  const noteTrimmed = resolveEmoji(extras.note?.trim() ?? '')
  if (noteTrimmed.length > 0) {
    sections.push(`**📝 Notes**\n${truncate(noteTrimmed, 1024)}`)
  }

  const videoLines = extras.extraVideos.slice(0, 10).map(renderExtraLine)
  if (videoLines.length > 0) {
    sections.push(`**🎬 Videos**\n${truncate(videoLines.join('\n'), 1024)}`)
  }

  const linkLines = extras.extraLinks.slice(0, 10).map(renderExtraLine)
  if (linkLines.length > 0) {
    sections.push(`**🔗 Links**\n${truncate(linkLines.join('\n'), 1024)}`)
  }

  // Discord caps content at 2000 chars; truncate visibly rather than fail.
  const joined = sections.join('\n\n')
  if (joined.length <= 1900) return joined
  return `${joined.slice(0, 1897)}…`
}
