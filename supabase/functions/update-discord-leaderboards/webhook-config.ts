import { guildCodesEqual } from '../_shared/guild-code.ts'
import {
  describeWebhookUrlProblem,
  discordWebhookUrlProblem
} from '../_shared/discord-webhook-url.ts'

export type WebhookConfig = { url: string; threadId: string | null }

export interface WebhookRow {
  guild_code: string
  webhook_url: string
  webhook_type: string
  thread_id?: string | null
}

export interface GuildConfigRow {
  guild_code: string
  display_name?: string | null
  enabled?: boolean | null
  cluster_code?: string | null
}

interface WebhookMaps {
  overall: Map<string, WebhookConfig>
  boss: Map<string, WebhookConfig>
  prime: Map<string, WebhookConfig>
  legacy: Map<string, WebhookConfig> // For backward compatibility with 'leaderboard' type
}

export interface GuildLeaderboardInfo {
  name: string | null | undefined
  webhook: string | null
  threadId: string | null
  cluster: string | null | undefined
  getWebhook: (type: string) => string | null
  getThreadId: (type: string) => string | null
}

export function buildWebhookMaps(rows: WebhookRow[]): WebhookMaps {
  const maps: WebhookMaps = {
    overall: new Map(),
    boss: new Map(),
    prime: new Map(),
    legacy: new Map()
  }
  for (const row of rows) {
    const config = { url: row.webhook_url, threadId: row.thread_id || null }
    if (row.webhook_type === 'overall_leaderboard') {
      maps.overall.set(row.guild_code, config)
    } else if (row.webhook_type === 'boss_leaderboard') {
      maps.boss.set(row.guild_code, config)
    } else if (row.webhook_type === 'prime_leaderboard') {
      maps.prime.set(row.guild_code, config)
    } else if (row.webhook_type === 'leaderboard') {
      // Legacy: used for any type without its own webhook.
      maps.legacy.set(row.guild_code, config)
    }
  }
  return maps
}

export function getWebhookConfig(
  maps: WebhookMaps,
  guildCode: string,
  kind: string = 'overall'
): WebhookConfig | null {
  if (kind === 'prime' && maps.prime.has(guildCode)) {
    return maps.prime.get(guildCode) ?? null
  }
  if (kind === 'main' && maps.boss.has(guildCode)) {
    return maps.boss.get(guildCode) ?? null
  }
  if (kind === 'overall' && maps.overall.has(guildCode)) {
    return maps.overall.get(guildCode) ?? null
  }
  return maps.legacy.get(guildCode) ?? null
}

export function buildGuildProcessingPlan(
  guildConfigs: GuildConfigRow[],
  webhookRows: WebhookRow[],
  specificGuild: string
) {
  const webhookMaps = buildWebhookMaps(webhookRows)
  const guildInfo = new Map<string, GuildLeaderboardInfo>()
  const activeGuilds: string[] = []
  let testWebhook: string | null = null

  for (const guild of guildConfigs) {
    const getWebhook = (kind: string) =>
      getWebhookConfig(webhookMaps, guild.guild_code, kind)?.url ?? null
    const getThreadId = (kind: string) =>
      getWebhookConfig(webhookMaps, guild.guild_code, kind)?.threadId ?? null
    const hasAnyWebhook =
      getWebhook('overall') || getWebhook('main') || getWebhook('prime')

    guildInfo.set(guild.guild_code, {
      name: guild.display_name,
      webhook: getWebhook('overall'),
      threadId: getThreadId('overall'),
      cluster: guild.cluster_code,
      getWebhook,
      getThreadId
    })

    if (guild.guild_code === 'TEST') {
      testWebhook = getWebhook('overall')
    } else if (
      guild.enabled &&
      hasAnyWebhook &&
      (!specificGuild || guildCodesEqual(guild.guild_code, specificGuild))
    ) {
      activeGuilds.push(guild.guild_code)
    }
  }

  const allClusterGuilds = guildConfigs
    .filter((guild) => guild.enabled)
    .map((guild) => guild.guild_code)

  return { guildInfo, activeGuilds, testWebhook, allClusterGuilds }
}

export interface ClusterWebhookRow {
  webhook_url: string | null
  webhook_type: string
  thread_id?: string | null
}

export interface ClusterWebhookMap {
  overall: WebhookConfig | null
  boss: WebhookConfig | null
  prime: WebhookConfig | null
}

/** Rejects non-Discord webhook URLs, reported by type only: the URL is a credential. */
export function buildClusterWebhookMap(rows: ClusterWebhookRow[]): {
  map: ClusterWebhookMap
  rejected: { webhookType: string; reason: string }[]
} {
  const map: ClusterWebhookMap = { overall: null, boss: null, prime: null }
  const rejected: { webhookType: string; reason: string }[] = []
  for (const row of rows) {
    const slot =
      row.webhook_type === 'overall_leaderboard'
        ? 'overall'
        : row.webhook_type === 'boss_leaderboard'
          ? 'boss'
          : row.webhook_type === 'prime_leaderboard'
            ? 'prime'
            : null
    if (!slot) continue
    const problem = discordWebhookUrlProblem(row.webhook_url)
    if (problem) {
      rejected.push({
        webhookType: row.webhook_type,
        reason: describeWebhookUrlProblem(problem)
      })
      continue
    }
    map[slot] = {
      url: row.webhook_url as string,
      threadId: row.thread_id || null
    }
  }
  return { map, rejected }
}
