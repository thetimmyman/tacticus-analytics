import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import {
  normalizeGuildRaidEntryTimestamps,
  tacticusAPI,
  type GuildRaidEntry
} from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
import {
  MAX_BOMBS,
  computeBombAvailability
} from '@/app/lib/calculations/bomb-availability'

const logger = createComponentLogger('lib.tacticus.guild-bombs')

// Mirrors fetchGuildTokensFast, which app/lib/ cannot import (module boundary).

export interface GuildBombsSnapshot {
  total: number
  holderIds: string[]
}

// Uses the latest bomb across both seasons: the previous season's last bomb
// still gates the first 18 hours after rollover.
export const computeGuildBombsAvailable = (
  currentEntries: GuildRaidEntry[],
  prevEntries: GuildRaidEntry[],
  guildMemberIds: string[],
  nowSec: number
): GuildBombsSnapshot => {
  const normalizedCurrentEntries = currentEntries.map(
    normalizeGuildRaidEntryTimestamps
  )
  const normalizedPrevEntries = prevEntries.map(
    normalizeGuildRaidEntryTimestamps
  )

  const lastBombByPlayer = new Map<string, number>()
  for (const e of normalizedCurrentEntries) {
    if (e.damageType !== 'Bomb') continue
    const prev = lastBombByPlayer.get(e.userId)
    if (prev === undefined || e.startedOn > prev) {
      lastBombByPlayer.set(e.userId, e.startedOn)
    }
  }
  for (const e of normalizedPrevEntries) {
    if (e.damageType !== 'Bomb') continue
    const prev = lastBombByPlayer.get(e.userId)
    if (prev === undefined || e.startedOn > prev) {
      lastBombByPlayer.set(e.userId, e.startedOn)
    }
  }

  let total = 0
  const holderIds: string[] = []
  for (const memberId of guildMemberIds) {
    const last = lastBombByPlayer.get(memberId)
    if (computeBombAvailability(last, nowSec).available) {
      total += MAX_BOMBS
      holderIds.push(memberId)
    }
  }
  return { total, holderIds }
}

// Null without an API key or on any error: best-effort, never blocks Herald.
export const fetchGuildBombsAvailable = async (
  supabase: SupabaseClient,
  guildCode: string
): Promise<GuildBombsSnapshot | null> => {
  try {
    const { data: cfg } = await supabase
      .from('guild_config')
      .select('api_key_encrypted')
      .eq('guild_code', guildCode)
      .maybeSingle()
    if (!cfg?.api_key_encrypted) return null

    const apiKey = await decryptApiKey(cfg.api_key_encrypted)
    if (!apiKey) return null

    const raidData = await tacticusAPI.getCurrentGuildRaid(apiKey)
    if (!raidData?.entries) return null

    let prevEntries: GuildRaidEntry[] = []
    if (raidData.season > 1) {
      const prev = await tacticusAPI.getGuildRaidBySeason(
        apiKey,
        raidData.season - 1
      )
      if (prev?.entries) prevEntries = prev.entries
    }

    const guild = await tacticusAPI.getGuild(apiKey)
    const guildMemberIds = guild?.members?.map((m) => m.userId) ?? []

    const nowSec = Math.floor(Date.now() / 1000)
    return computeGuildBombsAvailable(
      raidData.entries,
      prevEntries,
      guildMemberIds,
      nowSec
    )
  } catch (err) {
    logger.warn(
      {
        guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'guild_bombs_fetch_failed'
    )
    return null
  }
}
