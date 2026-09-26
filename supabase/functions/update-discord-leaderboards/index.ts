import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  loadPlayerNameMap,
  resolveDisplayName
} from '../_shared/player-name-resolution.ts'
import {
  loadDuplicateNameLabels,
  relabelForDisplay
} from '../_shared/duplicate-name-labels.ts'
import {
  loadBossMap,
  loadHeroEmojiMap
} from '../_shared/reference-data-cache.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'
import { logger } from '../_shared/logger.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import {
  isDiscordWebhooksEnabled,
  sendOrUpdateMessage,
  sendWebhookMessage
} from '../_shared/discord-webhook.ts'
import { EdgeFunctionTimeouts } from '../_shared/timeout-utils.ts'
import { normalizeGuildCode } from '../_shared/guild-code.ts'
import {
  delay,
  formatLeaderboardTimestamp,
  formatTeam,
  getSortedBossKeys,
  groupBattlesByBoss,
  type LeaderboardBattleRow
} from './leaderboard-helpers.ts'
import {
  buildClusterWebhookMap,
  buildGuildProcessingPlan
} from './webhook-config.ts'
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }
  try {
    const supabase = createServiceClient()
    // Deleting a webhook in Discord is a guild's opt-out: disable its config rows, do not retry the URL.
    const retiredWebhooks = new Set<string>()
    const retireWebhook = async (url: string, owner: string) => {
      if (retiredWebhooks.has(url)) return
      retiredWebhooks.add(url)
      const { data: disabledRows, error } = await supabase
        .from('webhook_config')
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq('webhook_url', url)
        .eq('enabled', true)
        .select('guild_code')
      if (error) {
        logger.warn(
          `[update-discord-leaderboards] Could not disable deleted webhook for ${owner}: ${error.message}`
        )
        return
      }
      logger.info(
        `[update-discord-leaderboards] Webhook for ${owner} was deleted in Discord; disabled its webhook_config row(s)`
      )
      // Keep discord_webhook_enabled in step (webhook-health reads it), as the save route does.
      const guildCodes = new Set(
        (disabledRows ?? [])
          .map((row: { guild_code: string | null }) => row.guild_code)
          .filter((code: string | null): code is string => Boolean(code))
      )
      for (const guildCode of guildCodes) {
        const { data: stillEnabled, error: checkError } = await supabase
          .from('webhook_config')
          .select('id')
          .eq('guild_code', guildCode)
          .eq('enabled', true)
          .limit(1)
        if (checkError) continue
        await supabase
          .from('guild_config')
          .update({
            discord_webhook_enabled: (stillEnabled?.length ?? 0) > 0,
            updated_at: new Date().toISOString()
          })
          .eq('guild_code', guildCode)
      }
    }
    const url = new URL(req.url)
    const testMode = url.searchParams.has('test')
    const specificGuild = normalizeGuildCode(url.searchParams.get('guild'))
    const body = await req.json().catch(() => ({}))
    const {
      cluster_code,
      all_clusters = false,
      process_all = false,
      source,
      scheduled
    } = body
    // Both parameter names accepted; cron payloads may carry no cluster.
    const shouldProcessAll =
      all_clusters ||
      process_all ||
      source === 'cron' ||
      scheduled === true ||
      (!cluster_code && Object.keys(body).length === 0)
    if (!cluster_code && shouldProcessAll) {
      logger.info(
        '[update-discord-leaderboards]',
        'No cluster specified; processing all clusters (compat mode)'
      )
    }
    let clustersToProcess: (string | null)[] = []
    if (shouldProcessAll) {
      const { data: clusters, error: clusterError } = await supabase
        .from('clusters')
        .select('cluster_code')
        .eq('is_active', true)
      if (clusterError) throw clusterError
      clustersToProcess =
        clusters?.map((c: { cluster_code: string | null }) => c.cluster_code) ||
        []
      // Independent guilds have a null cluster_code.
      clustersToProcess.push(null)
      console.log(
        `\n========== PROCESSING ALL ACTIVE CLUSTERS (${clustersToProcess.length - 1}) + INDEPENDENT GUILDS ==========\n`
      )
    } else if ('cluster_code' in body) {
      clustersToProcess = [cluster_code]
    } else {
      return jsonResponse(
        {
          error:
            'No cluster specified. Provide cluster_code or set process_all to true'
        },
        { status: 400 }
      )
    }
    clustersToProcess.sort((a, b) => {
      if (a === null) return -1
      if (b === null) return 1
      return a.localeCompare(b)
    })
    // Reference data is cached at module scope; a rollout forces a refresh.
    const emojiMap = await loadHeroEmojiMap(supabase)
    const bossMap = await loadBossMap(supabase)
    const playerNameMap = await loadPlayerNameMap(supabase)
    // Duplicate-name labels apply to display strings only (top_player included).
    const labelMap = await loadDuplicateNameLabels(supabase)
    logger.info(
      '[update-discord-leaderboards]',
      `Loaded ${playerNameMap.size / 2} player name mappings`
    )
    const overallResults = {
      clusters_processed: 0,
      guild_leaderboards_sent: 0,
      cluster_leaderboards_sent: 0,
      total_skipped: 0,
      total_updated: 0,
      total_new: 0,
      early_termination: false,
      errors: [] as Array<{ cluster: string | null; error: string }>
    }
    const startTime = Date.now()
    const timeouts = new EdgeFunctionTimeouts('update-discord-leaderboards')
    for (const currentCluster of clustersToProcess) {
      if (timeouts.shouldTerminate()) {
        const metrics = timeouts.getMetrics()
        logger.warn(
          `[update-discord-leaderboards] Early termination before cluster ${currentCluster || 'INDEPENDENT'}: ${metrics.elapsed}ms elapsed, ${metrics.remaining}ms remaining`
        )
        overallResults.early_termination = true
        break
      }
      const clusterLabel = currentCluster || 'INDEPENDENT'
      try {
        // An empty season lookup must fail loudly: a constant fallback posted ghost leaderboards.
        const { data: rpcSeason, error: rpcSeasonError } =
          await supabase.rpc('get_latest_season')
        if (rpcSeasonError || !rpcSeason) {
          throw new Error(
            `Cannot determine current season for cluster ${clusterLabel}: ${rpcSeasonError?.message || 'RPC returned null'}`
          )
        }
        const currentSeason = String(rpcSeason)
        let guildConfigQuery = supabase
          .from('guild_config')
          .select('guild_code, display_name, enabled, cluster_code')
        if (currentCluster !== null) {
          guildConfigQuery = guildConfigQuery.eq('cluster_code', currentCluster)
        } else {
          guildConfigQuery = guildConfigQuery.is('cluster_code', null)
        }
        const { data: guildConfigs } = await guildConfigQuery
        // 'leaderboard' is the legacy type.
        const { data: webhookConfigs } = await supabase
          .from('webhook_config')
          .select('guild_code, webhook_url, webhook_type, thread_id')
          .in('webhook_type', [
            'leaderboard',
            'overall_leaderboard',
            'boss_leaderboard',
            'prime_leaderboard'
          ])
          .eq('enabled', true)
          .not('guild_code', 'is', null)
        const { guildInfo, activeGuilds, testWebhook, allClusterGuilds } =
          buildGuildProcessingPlan(
            guildConfigs || [],
            webhookConfigs || [],
            specificGuild
          )

        let hasClusterWebhooks = false
        if (currentCluster !== null) {
          const { data: clusterCheck } = await supabase
            .from('clusters')
            .select('id')
            .eq('cluster_code', currentCluster)
            .single()

          if (clusterCheck) {
            const { data: clusterWebhookCheck } = await supabase
              .from('webhook_config')
              .select('id')
              .eq('cluster_id', clusterCheck.id)
              .in('webhook_type', [
                'overall_leaderboard',
                'boss_leaderboard',
                'prime_leaderboard',
                'leaderboard'
              ])
              .eq('enabled', true)
              .limit(1)

            hasClusterWebhooks = (clusterWebhookCheck?.length || 0) > 0
          }
        }

        if (activeGuilds.length === 0 && !hasClusterWebhooks) {
          logger.info(
            `[update-discord-leaderboards] Skipping ${clusterLabel}: no guild or cluster webhooks configured`
          )
          continue
        }

        // Clusters need every guild; independent guilds only activeGuilds (?guild= and the row limit).
        const guildsForQuery =
          currentCluster !== null
            ? allClusterGuilds.length > 0
              ? allClusterGuilds
              : activeGuilds
            : activeGuilds
        let battleDataQuery = supabase
          .from('EOT_GR_data')
          .select(
            `
            Guild,
            displayName,
            userId,
            Name,
            damageDealt,
            tier,
            rarity,
            set,
            encounterId,
            encounterIndex,
            type,
            heroDetails,
            machineOfWarDetails,
            cluster_code
          `
          )
          .eq('Season', currentSeason)
          .eq('damageType', 'Battle')
          .gt('damageDealt', 0)
          .in('rarity', ['Legendary', 'Mythic'])

        if (currentCluster !== null) {
          battleDataQuery = battleDataQuery.eq('cluster_code', currentCluster)
        } else {
          battleDataQuery = battleDataQuery
            .is('cluster_code', null)
            .in('Guild', guildsForQuery)
        }
        const { data: battleData } = await battleDataQuery
        if (!battleData || battleData.length === 0) {
          continue
        }
        const guildResults = new Map()
        let clusterSkipped = 0
        let clusterUpdated = 0
        let clusterNew = 0
        const errorsList = []
        for (const guildCode of activeGuilds) {
          if (timeouts.shouldTerminate()) {
            const metrics = timeouts.getMetrics()
            logger.warn(
              `[update-discord-leaderboards] Early termination before guild ${guildCode} in cluster ${clusterLabel}: ${metrics.elapsed}ms elapsed`
            )
            overallResults.early_termination = true
            break
          }
          const guildData = guildInfo.get(guildCode)
          if (!guildData || (!guildData.webhook && !guildData.getWebhook)) {
            const errorMsg = `No webhook configured for guild ${guildCode}`
            logger.error(`❌ ${errorMsg}`)
            errorsList.push(errorMsg)
            continue
          }
          console.log(
            `\n🔄 Processing guild ${guildCode} (${guildData.name}) in cluster ${clusterLabel}`
          )
          const bossBattles = groupBattlesByBoss(
            battleData,
            guildCode,
            currentCluster
          )
          const sortedBossKeys = getSortedBossKeys(bossBattles)
          // Throw on error: an empty map makes every boss look new, reposting the set
          // and orphaning the old one in Discord. The work_queue retries instead.
          const { data: existingMessages, error: existingMessagesError } =
            await supabase
              .from('discord_message_tracking')
              .select('*')
              .eq('guild_code', guildCode)
              .eq('season', currentSeason)
          if (existingMessagesError) {
            throw new Error(
              `Failed to load existing tracking for guild ${guildCode} season ${currentSeason}: ${existingMessagesError.message}`
            )
          }
          const existingMessageMap = new Map()
          for (const msg of existingMessages || []) {
            existingMessageMap.set(msg.boss_key, msg)
          }
          let skippedCount = 0
          let updatedCount = 0
          let newCount = 0
          const updateDetails = []
          const headerContent = `**:crossed_swords: ${guildData.name} - Season ${currentSeason} :crossed_swords:**\n**Battle Damage Leaderboards**\n\n*Updates every hour with new high scores*`
          const headerKey = 'HEADER'
          const existingHeader = existingMessageMap.get(headerKey)
          if (
            !existingHeader &&
            guildData.webhook &&
            !retiredWebhooks.has(guildData.webhook) &&
            isDiscordWebhooksEnabled()
          ) {
            try {
              const sendResult = await sendWebhookMessage(
                guildData.webhook,
                { content: headerContent },
                { retries: 1, threadId: guildData.threadId }
              )
              if (sendResult.success && sendResult.messageId) {
                const headerHash = await crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode(headerContent)
                )
                const hashArray = Array.from(new Uint8Array(headerHash))
                const hashHex = hashArray
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('')
                await supabase.from('discord_message_tracking').upsert(
                  {
                    guild_code: guildCode,
                    season: currentSeason,
                    boss_key: headerKey,
                    message_id: sendResult.messageId,
                    webhook_url: guildData.webhook,
                    content_hash: hashHex,
                    top_player: 'N/A',
                    top_score: 0,
                    updated_at: new Date().toISOString(),
                    content_updated_at: new Date().toISOString()
                  },
                  {
                    onConflict: 'guild_code,season,boss_key',
                    ignoreDuplicates: false
                  }
                )
                newCount++
              } else if (sendResult.webhookGone) {
                await retireWebhook(guildData.webhook, `guild ${guildCode}`)
              } else {
                const errorMsg = `Failed to send header for ${guildCode}: ${sendResult.error ?? 'unknown error'}`
                logger.error(`❌ ${errorMsg}`)
                errorsList.push(errorMsg)
              }
            } catch (error) {
              const errorMsg = `Failed to send header for ${guildCode}: ${error instanceof Error ? error.message : String(error)}`
              logger.error(errorMsg)
              errorsList.push(errorMsg)
            }
            await delay(1100)
          } else if (existingHeader) {
            console.log(
              `⏭️ Header already exists for ${guildCode} (ID: ${existingHeader.message_id}), skipping`
            )
            skippedCount++
          }
          for (const bossKey of sortedBossKeys) {
            if (timeouts.shouldTerminate()) {
              logger.warn(
                `[update-discord-leaderboards] Early termination in boss loop for guild ${guildCode}`
              )
              overallResults.early_termination = true
              break
            }
            const battles = bossBattles.get(bossKey)
            if (!battles) continue
            const sortedBattles = Array.from(battles.values())
              .sort((a, b) => b.damageDealt - a.damageDealt)
              .slice(0, 5) // Top 5
            if (sortedBattles.length === 0) continue
            const firstEntry = sortedBattles[0]
            const mappingKey = `${firstEntry.type}_${firstEntry.encounterIndex}`
            const bossMapping = bossMap.get(mappingKey)
            const displayBossName =
              bossMapping?.boss_name || firstEntry.Name || firstEntry.type
            const positionText =
              firstEntry.position === 'Main'
                ? ''
                : ` (${firstEntry.position === 'Prime1' ? 'Left' : 'Right'})`
            const webhookType =
              firstEntry.position === 'Main' ? 'main' : 'prime'
            const specificWebhook =
              guildData.getWebhook(webhookType) || guildData.webhook // Fall back to default webhook
            const specificThreadId =
              guildData.getThreadId(webhookType) || guildData.threadId // Fall back to default thread
            // A guild may lack this webhook type (e.g. prime only); skip the boss.
            if (!specificWebhook || retiredWebhooks.has(specificWebhook))
              continue
            // Hash content excludes the timestamp.
            let contentForHash = `**${firstEntry.bossCode} - ${displayBossName}${positionText}**\n`
            for (let i = 0; i < sortedBattles.length; i++) {
              const entry = sortedBattles[i]
              let rankPrefix = ''
              if (i === 0) rankPrefix = '**:first_place:'
              else if (i === 1) rankPrefix = '**:second_place:'
              else if (i === 2) rankPrefix = '**:third_place:'
              else rankPrefix = `${i + 1}th **`
              const resolvedName = relabelForDisplay(
                resolveDisplayName(
                  entry.displayName,
                  entry.userId,
                  playerNameMap
                ),
                labelMap
              )
              contentForHash += `${rankPrefix} ${entry.damageDealt.toLocaleString()}**`
              contentForHash += ` - ${resolvedName}\n`
              contentForHash += `Team: ${formatTeam(entry.heroDetails, entry.machineOfWarDetails, emojiMap)}\n`
            }
            const contentHash = await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(contentForHash)
            )
            const hashArray = Array.from(new Uint8Array(contentHash))
            const hashHex = hashArray
              .map((b) => b.toString(16).padStart(2, '0'))
              .join('')
            const existingMsg = existingMessageMap.get(bossKey)
            let shouldUpdate = true
            let lastContentUpdate = new Date().toISOString()
            if (existingMsg) {
              if (existingMsg.content_hash === hashHex) {
                shouldUpdate = false
                skippedCount++
                lastContentUpdate =
                  existingMsg.content_updated_at || existingMsg.updated_at
              } else {
                updatedCount++
                updateDetails.push({
                  boss: bossKey,
                  bossName: displayBossName,
                  topScore: sortedBattles[0].damageDealt,
                  topPlayer: relabelForDisplay(
                    resolveDisplayName(
                      sortedBattles[0].displayName,
                      sortedBattles[0].userId,
                      playerNameMap
                    ),
                    labelMap
                  ),
                  topGuild:
                    guildInfo.get(sortedBattles[0].Guild ?? '')?.name ||
                    sortedBattles[0].Guild
                })
              }
            } else {
              newCount++
              updateDetails.push({
                boss: bossKey,
                bossName: displayBossName,
                reason: 'New boss entry',
                topScore: sortedBattles[0].damageDealt,
                topPlayer: relabelForDisplay(
                  resolveDisplayName(
                    sortedBattles[0].displayName,
                    sortedBattles[0].userId,
                    playerNameMap
                  ),
                  labelMap
                ),
                topGuild:
                  guildInfo.get(sortedBattles[0].Guild ?? '')?.name ||
                  sortedBattles[0].Guild
              })
            }
            let content = contentForHash
            content += `\n*Updated at ${formatLeaderboardTimestamp(lastContentUpdate)} UTC*`
            if (shouldUpdate) {
              const result = await sendOrUpdateMessage(
                specificWebhook,
                { content },
                existingMsg?.message_id ?? null,
                { retries: 3, threadId: specificThreadId }
              )
              if (result.webhookGone) {
                await retireWebhook(specificWebhook, `guild ${guildCode}`)
                continue
              }
              const messageId = result.success ? result.messageId : null
              const rateLimited = result.rateLimited ?? false
              if (messageId && !rateLimited) {
                const trackingData = {
                  guild_code: guildCode,
                  cluster_code: null,
                  season: currentSeason,
                  boss_key: bossKey,
                  message_id: messageId,
                  webhook_url: specificWebhook,
                  content_hash: hashHex,
                  top_player: relabelForDisplay(
                    resolveDisplayName(
                      sortedBattles[0].displayName,
                      sortedBattles[0].userId,
                      playerNameMap
                    ),
                    labelMap
                  ),
                  top_score: sortedBattles[0].damageDealt,
                  updated_at: new Date().toISOString(),
                  content_updated_at: lastContentUpdate
                }
                await supabase
                  .from('discord_message_tracking')
                  .upsert(trackingData, {
                    onConflict: 'guild_code,season,boss_key',
                    ignoreDuplicates: false
                  })
              } else if (rateLimited) {
                logger.warn(
                  `[update-discord-leaderboards] Rate limited while updating guild ${guildCode} boss ${bossKey}; will retry after delay.`
                )
              }
              await delay(1100)
            }
            // Skip timestamp-only updates to save rate-limit quota.
          }
          guildResults.set(guildCode, {
            name: guildData.name,
            skipped: skippedCount,
            updated: updatedCount,
            new: newCount,
            total: sortedBossKeys.length + 1,
            updates: updateDetails
          })
          clusterSkipped += skippedCount
          clusterUpdated += updatedCount
          clusterNew += newCount
          overallResults.guild_leaderboards_sent++
        }
        // Cluster leaderboards: only from the scheduled dispatcher, never per-guild
        // (?guild=X). Parallel guild runs race on tracking and each repost the set.
        if (currentCluster !== null && !specificGuild) {
          logger.info(
            `[update-discord-leaderboards] Processing cluster leaderboards for ${currentCluster}`
          )

          const { data: clusterInfo, error: clusterError } = await supabase
            .from('clusters')
            .select('id, display_name')
            .eq('cluster_code', currentCluster)
            .single()

          if (clusterError) {
            logger.error(
              `[update-discord-leaderboards] Failed to fetch cluster info for ${currentCluster}: ${clusterError.message}`
            )
          }

          if (!clusterInfo) {
            logger.warn(
              `[update-discord-leaderboards] No cluster info found for ${currentCluster}, skipping cluster leaderboards`
            )
            continue
          }

          logger.info(
            `[update-discord-leaderboards] Found cluster: ${clusterInfo.display_name} (ID: ${clusterInfo.id})`
          )

          const { data: clusterWebhooks, error: webhookError } = await supabase
            .from('webhook_config')
            .select('webhook_url, webhook_type, thread_id')
            .eq('cluster_id', clusterInfo.id)
            // Excludes legacy 'leaderboard': it is guild-level (a row can carry both
            // guild_code and cluster_id), and using it leaked cluster content to a guild.
            .in('webhook_type', [
              'overall_leaderboard',
              'boss_leaderboard',
              'prime_leaderboard'
            ])
            .eq('enabled', true)

          if (webhookError) {
            logger.error(
              `[update-discord-leaderboards] Failed to fetch cluster webhooks: ${webhookError.message}`
            )
          }

          logger.info(
            `[update-discord-leaderboards] Found ${clusterWebhooks?.length || 0} cluster webhooks for ${currentCluster}`
          )
          const { map: clusterWebhookMap, rejected: rejectedClusterWebhooks } =
            buildClusterWebhookMap(clusterWebhooks || [])
          for (const rejected of rejectedClusterWebhooks) {
            const errorMsg = `Cluster ${currentCluster} ${rejected.webhookType} ignored: ${rejected.reason}`
            logger.warn(`[update-discord-leaderboards] ${errorMsg}`)
            errorsList.push(errorMsg)
          }
          const getClusterWebhookConfig = (bossType = 'overall') => {
            if (bossType === 'prime' && clusterWebhookMap.prime) {
              return clusterWebhookMap.prime
            }
            if (bossType === 'main' && clusterWebhookMap.boss) {
              return clusterWebhookMap.boss
            }
            if (bossType === 'overall' && clusterWebhookMap.overall) {
              return clusterWebhookMap.overall
            }
            // No legacy guild-webhook fallback; boss/prime types fall back to the cluster webhook at the call site.
            return null
          }
          const getClusterWebhook = (bossType = 'overall') => {
            const config = getClusterWebhookConfig(bossType)
            return config?.url || null
          }
          const getClusterThreadId = (bossType = 'overall') => {
            const config = getClusterWebhookConfig(bossType)
            return config?.threadId || null
          }
          const defaultClusterWebhook = getClusterWebhook('overall')

          logger.info(
            `[update-discord-leaderboards] Cluster webhook map: overall=${!!clusterWebhookMap.overall}, boss=${!!clusterWebhookMap.boss}, prime=${!!clusterWebhookMap.prime}`
          )
          logger.info(
            `[update-discord-leaderboards] Default cluster webhook: ${defaultClusterWebhook ? 'FOUND' : 'NOT FOUND'}`
          )

          if (
            !defaultClusterWebhook &&
            (clusterWebhookMap.boss || clusterWebhookMap.prime)
          ) {
            const missing = [
              'cluster header',
              !clusterWebhookMap.boss ? 'main bosses' : null,
              !clusterWebhookMap.prime ? 'prime bosses' : null
            ].filter(Boolean)
            logger.warn(
              `[update-discord-leaderboards] No valid overall_leaderboard webhook for ${currentCluster}; skipping ${missing.join(', ')}`
            )
          }
          if (
            defaultClusterWebhook ||
            clusterWebhookMap.boss ||
            clusterWebhookMap.prime
          ) {
            const clusterDisplayName =
              clusterInfo.display_name || currentCluster
            logger.info(
              `[update-discord-leaderboards] Processing cluster-wide leaderboards for ${clusterDisplayName}`
            )
            const clusterBossBattles = groupBattlesByBoss(
              battleData,
              null,
              currentCluster
            )
            const sortedClusterBossKeys = getSortedBossKeys(clusterBossBattles)
            // Throw on error, as in the per-guild path.
            const {
              data: existingClusterMessages,
              error: existingClusterMessagesError
            } = await supabase
              .from('discord_message_tracking')
              .select('*')
              .eq('guild_code', `CLUSTER_${currentCluster}`) // Use special code for cluster messages
              .eq('season', currentSeason)
              .not('webhook_url', 'is', null) // Don't filter by webhook URL since it may vary by type
            if (existingClusterMessagesError) {
              throw new Error(
                `Failed to load existing cluster tracking for ${currentCluster} season ${currentSeason}: ${existingClusterMessagesError.message}`
              )
            }
            const existingClusterMessageMap = new Map()
            for (const msg of existingClusterMessages || []) {
              existingClusterMessageMap.set(msg.boss_key, msg)
            }
            const clusterHeaderContent = `**⚔️ ${clusterDisplayName} Cluster - Season ${currentSeason} ⚔️**\n**Battle Damage Leaderboards**\n\n*Updates every hour with new high scores across all guilds*`
            const clusterHeaderKey = 'HEADER'
            const existingClusterHeader =
              existingClusterMessageMap.get(clusterHeaderKey)
            if (
              !existingClusterHeader &&
              defaultClusterWebhook &&
              !retiredWebhooks.has(defaultClusterWebhook) &&
              isDiscordWebhooksEnabled()
            ) {
              try {
                const sendResult = await sendWebhookMessage(
                  defaultClusterWebhook,
                  { content: clusterHeaderContent },
                  { retries: 1, threadId: getClusterThreadId('overall') }
                )
                if (sendResult.success && sendResult.messageId) {
                  const headerHash = await crypto.subtle.digest(
                    'SHA-256',
                    new TextEncoder().encode(clusterHeaderContent)
                  )
                  const hashArray = Array.from(new Uint8Array(headerHash))
                  const hashHex = hashArray
                    .map((b) => b.toString(16).padStart(2, '0'))
                    .join('')
                  await supabase.from('discord_message_tracking').upsert(
                    {
                      guild_code: `CLUSTER_${currentCluster}`,
                      cluster_code: currentCluster,
                      season: currentSeason,
                      boss_key: clusterHeaderKey,
                      message_id: sendResult.messageId,
                      webhook_url: defaultClusterWebhook,
                      content_hash: hashHex,
                      top_player: 'N/A',
                      top_score: 0,
                      updated_at: new Date().toISOString(),
                      content_updated_at: new Date().toISOString()
                    },
                    {
                      onConflict: 'guild_code,season,boss_key',
                      ignoreDuplicates: false
                    }
                  )
                  overallResults.cluster_leaderboards_sent++
                } else if (sendResult.webhookGone) {
                  await retireWebhook(
                    defaultClusterWebhook,
                    `cluster ${currentCluster}`
                  )
                } else {
                  const errorMsg = `Failed to send cluster header for ${currentCluster}: ${sendResult.error ?? 'unknown error'}`
                  logger.error(`❌ ${errorMsg}`)
                  errorsList.push(errorMsg)
                }
              } catch (error) {
                const errorMsg = `Failed to send cluster header for ${currentCluster}: ${error instanceof Error ? error.message : String(error)}`
                logger.error(errorMsg)
                errorsList.push(errorMsg)
              }
              await delay(1100)
            } else if (existingClusterHeader) {
              console.log(
                `⏭️ Cluster header already exists for ${currentCluster} (ID: ${existingClusterHeader.message_id}), skipping`
              )
            }
            for (const bossKey of sortedClusterBossKeys) {
              if (timeouts.shouldTerminate()) {
                logger.warn(
                  `[update-discord-leaderboards] Early termination in cluster boss loop for ${currentCluster}`
                )
                overallResults.early_termination = true
                break
              }
              const battles = clusterBossBattles.get(bossKey)
              if (!battles) continue
              const sortedBattles = Array.from(battles.values())
                .sort((a, b) => b.damageDealt - a.damageDealt)
                .slice(0, 5) // Top 5 for cluster-wide (same as guild)
              if (sortedBattles.length === 0) continue
              const firstEntry = sortedBattles[0]
              const mappingKey = `${firstEntry.type}_${firstEntry.encounterIndex}`
              const bossMapping = bossMap.get(mappingKey)
              const displayBossName =
                bossMapping?.boss_name || firstEntry.Name || firstEntry.type
              const positionText =
                firstEntry.position === 'Main'
                  ? ''
                  : ` (${firstEntry.position === 'Prime1' ? 'Left' : 'Right'})`
              let contentForHash = `**🌍 ${clusterDisplayName} Cluster - ${firstEntry.bossCode} ${displayBossName}${positionText}**\n`
              contentForHash += `*Top 5 performers across all guilds*\n\n`
              for (let i = 0; i < sortedBattles.length; i++) {
                const entry = sortedBattles[i]
                const guildName =
                  guildInfo.get(entry.Guild ?? '')?.name || entry.Guild
                let rankPrefix = ''
                if (i === 0) rankPrefix = '**:first_place:'
                else if (i === 1) rankPrefix = '**:second_place:'
                else if (i === 2) rankPrefix = '**:third_place:'
                else rankPrefix = `${i + 1}. **`
                const resolvedName = relabelForDisplay(
                  resolveDisplayName(
                    entry.displayName,
                    entry.userId,
                    playerNameMap
                  ),
                  labelMap
                )
                contentForHash += `${rankPrefix} ${entry.damageDealt.toLocaleString()}** - ${guildName} - ${resolvedName}\n`
                contentForHash += `Team: ${formatTeam(entry.heroDetails, entry.machineOfWarDetails, emojiMap)}\n`
              }
              const contentHash = await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(contentForHash)
              )
              const hashArray = Array.from(new Uint8Array(contentHash))
              const hashHex = hashArray
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
              const existingClusterMsg = existingClusterMessageMap.get(bossKey)
              let shouldUpdate = true
              let lastContentUpdate = new Date().toISOString()
              if (
                existingClusterMsg &&
                existingClusterMsg.content_hash === hashHex
              ) {
                shouldUpdate = false
                lastContentUpdate =
                  existingClusterMsg.content_updated_at ||
                  existingClusterMsg.updated_at
              }
              let clusterContent = contentForHash
              clusterContent += `\n*Updated at ${formatLeaderboardTimestamp(lastContentUpdate)} UTC*`
              const clusterWebhookType =
                firstEntry.position === 'Main' ? 'main' : 'prime'
              const specificClusterWebhook =
                getClusterWebhook(clusterWebhookType) || defaultClusterWebhook
              const specificClusterThreadId =
                getClusterThreadId(clusterWebhookType) ||
                getClusterThreadId('overall')
              if (
                shouldUpdate &&
                specificClusterWebhook &&
                !retiredWebhooks.has(specificClusterWebhook)
              ) {
                const result = await sendOrUpdateMessage(
                  specificClusterWebhook,
                  { content: clusterContent },
                  existingClusterMsg?.message_id ?? null,
                  { retries: 3, threadId: specificClusterThreadId }
                )
                if (result.webhookGone) {
                  await retireWebhook(
                    specificClusterWebhook,
                    `cluster ${currentCluster}`
                  )
                  continue
                }
                const messageId = result.success ? result.messageId : null
                const rateLimited = result.rateLimited ?? false
                if (messageId && !rateLimited) {
                  const trackingData = {
                    guild_code: `CLUSTER_${currentCluster}`,
                    cluster_code: currentCluster,
                    season: currentSeason,
                    boss_key: bossKey,
                    message_id: messageId,
                    webhook_url: specificClusterWebhook,
                    content_hash: hashHex,
                    top_player: relabelForDisplay(
                      resolveDisplayName(
                        sortedBattles[0].displayName,
                        sortedBattles[0].userId,
                        playerNameMap
                      ),
                      labelMap
                    ),
                    top_score: sortedBattles[0].damageDealt,
                    updated_at: new Date().toISOString(),
                    content_updated_at: lastContentUpdate
                  }
                  await supabase
                    .from('discord_message_tracking')
                    .upsert(trackingData, {
                      onConflict: 'guild_code,season,boss_key',
                      ignoreDuplicates: false
                    })
                  overallResults.cluster_leaderboards_sent++
                } else if (rateLimited) {
                  logger.warn(
                    `[update-discord-leaderboards] Rate limited while updating cluster ${currentCluster} boss ${bossKey}; will retry after delay.`
                  )
                }
                await delay(1100)
              }
            }
          } else {
            logger.warn(
              `[update-discord-leaderboards] No cluster webhook found for ${currentCluster} - skipping cluster leaderboards`
            )
          }
          const { data: syncStatusWebhook } = await supabase
            .from('webhook_config')
            .select('webhook_url')
            .eq('cluster_id', clusterInfo.id)
            .eq('webhook_type', 'sync_status')
            .eq('enabled', true)
            .single()
          if (syncStatusWebhook?.webhook_url && !testMode) {
            let summaryContent = ''
            if (errorsList.length > 0) {
              summaryContent = `❌ **${currentCluster} - Errors occurred:**\n`
              errorsList.forEach((error) => {
                summaryContent += `• ${error}\n`
              })
            } else {
              summaryContent = `✅ **${currentCluster} Complete:** ${clusterUpdated} updates, ${clusterSkipped} skipped, ${clusterNew} new`
            }
            try {
              await fetch(syncStatusWebhook.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: summaryContent })
              })
            } catch (error) {
              logger.error(
                `❌ Failed to send summary for ${currentCluster}:`,
                error
              )
            }
          } else if (testWebhook && !testMode) {
            let summaryContent = ''
            if (errorsList.length > 0) {
              summaryContent = `❌ **${currentCluster} - Errors occurred:**\n`
              errorsList.forEach((error) => {
                summaryContent += `• ${error}\n`
              })
            } else {
              summaryContent = `✅ **${currentCluster} Complete:** ${clusterUpdated} updates, ${clusterSkipped} skipped, ${clusterNew} new`
            }
            try {
              await fetch(testWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: summaryContent })
              })
            } catch (error) {
              logger.error(
                `❌ Failed to send summary for ${currentCluster}:`,
                error
              )
            }
          }
        } else {
          if (testWebhook && !testMode) {
            let summaryContent = ''
            if (errorsList.length > 0) {
              summaryContent = `❌ **INDEPENDENT GUILDS - Errors occurred:**\n`
              errorsList.forEach((error) => {
                summaryContent += `• ${error}\n`
              })
            } else {
              summaryContent = `✅ **INDEPENDENT GUILDS Complete:** ${clusterUpdated} updates, ${clusterSkipped} skipped, ${clusterNew} new`
            }
            try {
              await fetch(testWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: summaryContent })
              })
            } catch (error) {
              logger.error(
                `❌ Failed to send summary for INDEPENDENT GUILDS:`,
                error
              )
            }
          }
        }
        overallResults.total_skipped += clusterSkipped
        overallResults.total_updated += clusterUpdated
        overallResults.total_new += clusterNew
        overallResults.clusters_processed++
      } catch (clusterError) {
        logger.error(
          `❌ Error processing cluster ${clusterLabel}:`,
          clusterError
        )
        overallResults.errors.push({
          cluster: clusterLabel,
          error:
            clusterError instanceof Error
              ? clusterError.message
              : String(clusterError)
        })
      }
    }
    const duration = Date.now() - startTime
    const metrics = timeouts.getMetrics()
    const status = overallResults.early_termination
      ? 'partial'
      : overallResults.errors.length > 0
        ? 'warning'
        : 'success'
    logger.info(
      '[update-discord-leaderboards]',
      `Completed in ${duration}ms with status: ${status} (${Math.round(metrics.progress * 100)}% of timeout budget used)`
    )
    return jsonResponse({
      status,
      message: overallResults.early_termination
        ? 'Multi-cluster leaderboard update partially complete (timeout)'
        : 'Multi-cluster leaderboard update complete',
      clusters_processed: overallResults.clusters_processed,
      guild_leaderboards_sent: overallResults.guild_leaderboards_sent,
      cluster_leaderboards_sent: overallResults.cluster_leaderboards_sent,
      totals: {
        skipped: overallResults.total_skipped,
        updated: overallResults.total_updated,
        new: overallResults.total_new
      },
      execution: {
        elapsed_ms: metrics.elapsed,
        remaining_ms: metrics.remaining,
        progress_percent: Math.round(metrics.progress * 100),
        early_termination: overallResults.early_termination
      },
      errors: overallResults.errors
    })
  } catch (error) {
    logger.error('Main error:', error)
    logger.error(
      `❌ CRITICAL ERROR in update-discord-leaderboards: ${(error instanceof Error ? error.message : String(error)) || 'Unknown error'}`
    )
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})
