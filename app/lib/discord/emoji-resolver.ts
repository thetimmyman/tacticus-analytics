import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'

// The 'herald' logger name stays stable for log consumers.
const logger = createComponentLogger('herald')

// Unknown shortcodes are left untouched so accidental matches (timestamps, ratios) aren't corrupted.
export type EmojiResolver = (text: string) => string

export const buildEmojiResolver = (
  emojiMap: Map<string, string>
): EmojiResolver => {
  if (emojiMap.size === 0) return (text) => text
  return (text) =>
    text.replace(/:([A-Za-z0-9_]+):/g, (match, name: string) => {
      const exact = emojiMap.get(name)
      if (exact) return exact
      // Underscored tokens only, so `:tada:` never trips the alias match.
      if (name.includes('_')) {
        const suffix = name.slice(name.lastIndexOf('_') + 1).toLowerCase()
        const aliased = emojiMap.get(suffix)
        if (aliased) return aliased
      }
      return match
    })
}

const parseEmojiName = (stored: string): string | null => {
  const match = stored.trim().match(/^<a?:([A-Za-z0-9_]+):\d+>$/)
  return match?.[1] ?? null
}

export const loadHeroEmojiMap = async (
  supabase: SupabaseClient
): Promise<Map<string, string>> => {
  const map = new Map<string, string>()
  try {
    const { data, error } = await supabase
      .from('hero_mappings')
      .select('discord_emoji, display_name')
      .not('discord_emoji', 'is', null)
    if (error) {
      logger.warn({ error: error.message }, 'herald.emoji_map.load_failed')
      return map
    }
    // Second pass so aliases never shadow a real name.
    const aliases: Array<{ key: string; literal: string }> = []
    for (const row of data ?? []) {
      const r = row as {
        discord_emoji: string | null
        display_name?: string | null
      }
      const stored = r.discord_emoji
      if (!stored) continue
      const name = parseEmojiName(stored)
      if (!name) continue
      const literal = stored.trim()
      map.set(name, literal)
      const display = typeof r.display_name === 'string' ? r.display_name : null
      if (display) {
        const aliasKey = display.toLowerCase().replace(/\s+/g, '')
        if (aliasKey.length > 0) aliases.push({ key: aliasKey, literal })
      }
    }
    for (const a of aliases) {
      if (!map.has(a.key)) map.set(a.key, a.literal)
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'herald.emoji_map.load_exception'
    )
  }
  return map
}

export interface UnitEmojiMap {
  emojiByUnit: Map<string, string>
  mowKeys: Set<string>
}
