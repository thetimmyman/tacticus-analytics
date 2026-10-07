import 'server-only'
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ServiceSupabaseClient } from '@/app/lib/sync/worker-types'
import { createComponentLogger } from '@/app/lib/logging'
import {
  postToWebhook,
  logDiscordWebhookDelivery
} from '@/app/lib/discord/webhook-service'
import { fetchDiscordMessageBody } from '@/app/lib/discord/custom-message-fetch'
import type { DiscordWebhookPayload } from '@/app/lib/discord/types'
import { buildAllowedMentions } from '@/app/lib/discord/allowed-mentions'
import {
  type EmojiResolver,
  buildEmojiResolver,
  loadHeroEmojiMap
} from '@/app/lib/discord/emoji-resolver'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import {
  HERALD_WEBHOOK_TYPE,
  CHANNEL_FANOUT_DELAY_MS,
  type DefeatTransition,
  type AvailabilityTransition
} from './contracts'
import {
  resolveHeraldRoleMappings,
  resolveHeraldWebhook,
  resolveHeraldBossConfigs,
  resolveChannelsForTransition,
  resolveRoleIdsForTransition,
  loadGuildHeraldConfig,
  type HeraldBossConfigRow
} from './config'
import {
  formatDefeatEmbed,
  formatAvailabilityEmbed,
  formatAvailabilityCompactMessage
} from './format'
import {
  loadBossDisplayNameOverrides,
  resolveNoteForEncounter
} from './season-state'

const logger = createComponentLogger('herald')

export type TestFireKind = 'defeat' | 'availability'

export interface TestFireParams {
  supabase: SupabaseClient
  guildCode: string
  bossId: string
  bossDisplayName: string
  rarity?: string
  kind: TestFireKind
  invocationId: string
  actorDisplayName?: string | null
}

export interface TestFireResult {
  channels: number
  posted: number
  failed: number
  scope: 'guild' | 'cluster' | null
  embed_used: boolean
  role_ping_count: number
  error?: string
}

// Builds the payload that WOULD be dispatched, without posting; `primeState` overrides the suffix-derived encounter.
export type HeraldPrimeState =
  'both_alive' | 'left_dead' | 'right_dead' | 'both_dead'

export interface ComposeHeraldPreviewParams {
  supabase: SupabaseClient
  guildCode: string
  bossId: string
  bossDisplayName: string
  rarity?: string
  kind: TestFireKind
  actorDisplayName?: string | null
  primeState?: HeraldPrimeState
}

export interface ComposeHeraldPreviewResult {
  payload: DiscordWebhookPayload
  roleIds: string[]
  embedUsed: boolean
  scope: 'guild' | 'cluster' | null
  resolved: {
    bossConfig: HeraldBossConfigRow | null
    guildDefaultUrl: string | null
    guildDefaultThreadId: string | null
  }
}

export const composeHeraldPreview = async (
  params: ComposeHeraldPreviewParams
): Promise<ComposeHeraldPreviewResult> => {
  const {
    supabase,
    guildCode,
    bossId,
    bossDisplayName,
    rarity = 'Legendary',
    kind,
    actorDisplayName,
    primeState
  } = params

  const webhookResolution = await resolveHeraldWebhook(supabase, guildCode)
  const guildDefaultUrl = webhookResolution.webhookUrl
  const guildDefaultThreadId = webhookResolution.threadId ?? null

  const bossConfigs = await resolveHeraldBossConfigs(supabase, guildCode)
  const bossConfig = bossConfigs.resolve(bossId, null)

  const rolesResolution = await resolveHeraldRoleMappings(supabase, guildCode)
  // left_dead -> prime A (1), right_dead -> prime B (2), both_alive/both_dead -> main (0).
  const previewEncounterIndex = (() => {
    if (primeState) {
      switch (primeState) {
        case 'left_dead':
          return 1
        case 'right_dead':
          return 2
        case 'both_alive':
        case 'both_dead':
        default:
          return 0
      }
    }
    const m = bossId.match(/_E(\d+)$/)
    const parsed = m?.[1] ? parseInt(m[1], 10) : NaN
    return Number.isFinite(parsed) ? parsed : 0
  })()
  const roleIds = resolveRoleIdsForTransition(
    bossConfig,
    rolesResolution.mappings,
    bossId,
    null,
    {
      encounterIndex: previewEncounterIndex,
      hasCustomMessageUrl: bossConfig?.custom_message_url != null
    }
  )

  const guildHeraldConfig = await loadGuildHeraldConfig(supabase, guildCode)
  const displayOverrides = await loadBossDisplayNameOverrides(supabase)
  const effectiveDisplayName = displayOverrides.get(bossId) ?? bossDisplayName

  const rolePingLine =
    roleIds.length > 0 ? roleIds.map((id) => `<@&${id}>`).join(' ') : ''
  const memberLabels = await getMemberLabelMap()
  const actorDisplayLabel = actorDisplayName
    ? resolveMemberLabel(actorDisplayName, memberLabels)
    : actorDisplayName
  const testBadge = `**[TEST POST${actorDisplayLabel ? ` by ${actorDisplayLabel}` : ''}]**`

  const syntheticAvailability: AvailabilityTransition = {
    boss_id: bossId,
    boss_type: bossId.split('_E')[0] ?? bossId,
    boss_display_name: effectiveDisplayName,
    rarity,
    tier: null,
    set: null,
    encounter_index: previewEncounterIndex,
    season: 0,
    loop_index: 0
  }
  const syntheticDefeat: DefeatTransition = {
    boss_id: bossId,
    boss_type: bossId.split('_E')[0] ?? bossId,
    boss_display_name: effectiveDisplayName,
    rarity,
    tier: null,
    set: null,
    completed_on: Date.now(),
    killer_display_name: actorDisplayLabel ?? 'Test Killer',
    killer_user_id: null,
    season: 0,
    loop_index: 0
  }

  const previewCustomDescription = bossConfig?.custom_message_url
    ? await fetchDiscordMessageBody(bossConfig.custom_message_url)
    : null

  const previewResolveEmoji: EmojiResolver =
    kind === 'availability'
      ? buildEmojiResolver(await loadHeroEmojiMap(supabase))
      : (s) => s

  let payload: DiscordWebhookPayload
  if (kind === 'defeat') {
    const embed = formatDefeatEmbed(syntheticDefeat, {
      customDescription: previewCustomDescription
    })
    payload = {
      content: testBadge,
      embeds: [embed],
      allowed_mentions: { parse: [] }
    }
  } else {
    const testNote = resolveNoteForEncounter(
      bossConfig,
      null,
      previewEncounterIndex
    )
    if (guildHeraldConfig.compactAvailabilityPosts) {
      const body = formatAvailabilityCompactMessage(syntheticAvailability, {
        extraLinks: bossConfig?.extra_links ?? [],
        extraVideos: bossConfig?.extra_videos ?? [],
        customDescription: previewCustomDescription,
        note: testNote,
        resolveEmoji: previewResolveEmoji
      })
      const previewHeader = `${testBadge}\n${body}`
      payload = {
        content:
          rolePingLine.length > 0
            ? `${previewHeader}\n${rolePingLine}`
            : previewHeader,
        allowed_mentions: buildAllowedMentions(roleIds)
      }
      return {
        payload,
        roleIds,
        embedUsed: false,
        scope: webhookResolution.scope ?? null,
        resolved: {
          bossConfig,
          guildDefaultUrl,
          guildDefaultThreadId
        }
      }
    }
    const embed = formatAvailabilityEmbed(syntheticAvailability, {
      extraLinks: bossConfig?.extra_links ?? [],
      extraVideos: bossConfig?.extra_videos ?? [],
      customDescription: previewCustomDescription,
      note: testNote,
      resolveEmoji: previewResolveEmoji
    })
    const previewHeader = embed.title
      ? `${testBadge} ${embed.title}`
      : testBadge
    payload = {
      content:
        rolePingLine.length > 0
          ? `${previewHeader}\n${rolePingLine}`
          : previewHeader,
      embeds: [embed],
      allowed_mentions: buildAllowedMentions(roleIds)
    }
  }

  return {
    payload,
    roleIds,
    embedUsed: true,
    scope: webhookResolution.scope ?? null,
    resolved: {
      bossConfig,
      guildDefaultUrl,
      guildDefaultThreadId
    }
  }
}

/** Posts a badge-prefixed test message; writes NO dedup or availability snapshot row. */
export const postHeraldTestMessage = async (
  params: TestFireParams
): Promise<TestFireResult> => {
  const { supabase, guildCode, bossId, kind, invocationId } = params

  const preview = await composeHeraldPreview(params)
  const { payload, roleIds, scope } = preview
  const { bossConfig, guildDefaultUrl, guildDefaultThreadId } = preview.resolved

  const channels = await resolveChannelsForTransition(
    supabase,
    guildCode,
    bossConfig,
    guildDefaultUrl,
    guildDefaultThreadId
  )
  if (channels.length === 0) {
    return {
      channels: 0,
      posted: 0,
      failed: 0,
      scope,
      embed_used: false,
      role_ping_count: 0,
      error: 'no_valid_channels'
    }
  }

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      boss_id: bossId,
      kind,
      channel_count: channels.length,
      role_ping_count: roleIds.length,
      scope
    },
    'herald.test_fire.start'
  )

  let posted = 0
  let failed = 0
  let lastError: string | undefined
  let lastStatus: number | null = null
  for (let i = 0; i < channels.length; i += 1) {
    const channel = channels[i]
    if (!channel) continue
    try {
      const result = await postToWebhook(channel.webhookUrl, payload, {
        guildCode,
        webhookType: HERALD_WEBHOOK_TYPE,
        threadId: channel.threadId,
        retries: 2,
        logDelivery: logDiscordWebhookDelivery
      })
      if (result.ok) {
        posted += 1
        logger.info(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: bossId,
            webhook_id: channel.webhookId,
            status: result.status
          },
          'herald.test_fire.post.ok'
        )
      } else {
        failed += 1
        lastError =
          result.error?.message ?? `status:${result.status ?? 'unknown'}`
        lastStatus = result.status
        logger.warn(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            boss_id: bossId,
            webhook_id: channel.webhookId,
            status: result.status,
            error_type: result.error?.type,
            error_message: result.error?.message,
            response_body: result.responseBody?.slice(0, 500)
          },
          'herald.test_fire.post.fail'
        )
      }
    } catch (err) {
      failed += 1
      lastError = err instanceof Error ? err.message : String(err)
      logger.error(
        {
          herald_invocation_id: invocationId,
          guild_code: guildCode,
          boss_id: bossId,
          webhook_id: channel.webhookId,
          error: lastError
        },
        'herald.test_fire.post.exception'
      )
    }
    if (i < channels.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, CHANNEL_FANOUT_DELAY_MS)
      )
    }
  }

  return {
    channels: channels.length,
    posted,
    failed,
    scope,
    embed_used: true,
    role_ping_count: roleIds.length,
    ...(posted === 0 && lastError
      ? {
          error: `post_failed:${lastError}${lastStatus ? ` (status ${lastStatus})` : ''}`
        }
      : {})
  }
}

// Officer-triggered prime defeat post. Audit contract: manual_override is the
// canonical signal, mentioned_roles holds only this dedup marker, payload_preview
// is the prime boss id; role ids are omitted (the defeat payload allows no mentions).
export const MANUAL_OVERRIDE_AUDIT_ROLE = '__manual_override__'

export type ManualOverridePrime = 'a' | 'b'

export interface ManualOverrideParams {
  supabase: ServiceSupabaseClient
  guildCode: string
  /** MAIN encounter boss id (e.g. `Magnus_E0`); the prime arg picks A or B. */
  mainBossId: string
  mainBossDisplayName: string
  rarity?: string
  prime: ManualOverridePrime
  invocationId: string
  actorDisplayName: string | null
}

export interface ManualOverrideResult {
  channels: number
  posted: number
  failed: number
  scope: 'guild' | 'cluster' | null
  role_ping_count: number
  error?: string
  prime_boss_id: string
}

export const postHeraldManualOverride = async (
  params: ManualOverrideParams
): Promise<ManualOverrideResult> => {
  const {
    supabase,
    guildCode,
    mainBossId,
    mainBossDisplayName,
    rarity = 'Legendary',
    prime,
    invocationId,
    actorDisplayName
  } = params

  const encounterIndex = prime === 'a' ? 1 : 2
  const primeBossId = mainBossId.replace(/_E\d+$/, `_E${encounterIndex}`)

  const preview = await composeHeraldPreview({
    supabase,
    guildCode,
    bossId: primeBossId,
    bossDisplayName: mainBossDisplayName,
    rarity,
    kind: 'defeat',
    actorDisplayName,
    primeState: prime === 'a' ? 'left_dead' : 'right_dead'
  })
  const { payload, roleIds, scope } = preview
  const { bossConfig, guildDefaultUrl, guildDefaultThreadId } = preview.resolved

  const memberLabels = await getMemberLabelMap()
  const actorDisplayLabel = actorDisplayName
    ? resolveMemberLabel(actorDisplayName, memberLabels)
    : actorDisplayName
  const banner = `**[MANUAL OVERRIDE${actorDisplayLabel ? ` by ${actorDisplayLabel}` : ''}]**`
  const existingContent =
    typeof payload.content === 'string' ? payload.content : ''
  const strippedContent = existingContent.replace(
    /^\*\*\[TEST POST[^\]]*\]\*\*\s*/i,
    ''
  )
  payload.content =
    strippedContent.length > 0 ? `${banner}\n${strippedContent}` : banner

  const channels = await resolveChannelsForTransition(
    supabase,
    guildCode,
    bossConfig,
    guildDefaultUrl,
    guildDefaultThreadId
  )
  if (channels.length === 0) {
    return {
      channels: 0,
      posted: 0,
      failed: 0,
      scope,
      role_ping_count: roleIds.length,
      prime_boss_id: primeBossId,
      error: 'no_valid_channels'
    }
  }

  logger.info(
    {
      herald_invocation_id: invocationId,
      guild_code: guildCode,
      boss_id: primeBossId,
      prime,
      channel_count: channels.length,
      role_ping_count: roleIds.length,
      scope,
      manual_override: true
    },
    'herald.manual_override.start'
  )

  let posted = 0
  let failed = 0
  let lastError: string | undefined
  for (let i = 0; i < channels.length; i += 1) {
    const channel = channels[i]
    if (!channel) continue
    try {
      const result = await postToWebhook(channel.webhookUrl, payload, {
        guildCode,
        webhookType: HERALD_WEBHOOK_TYPE,
        threadId: channel.threadId,
        retries: 2,
        logDelivery: logDiscordWebhookDelivery
      })
      if (result.ok) {
        posted += 1
      } else {
        failed += 1
        lastError =
          result.error?.message ?? `status:${result.status ?? 'unknown'}`
      }
    } catch (err) {
      failed += 1
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (i < channels.length - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, CHANNEL_FANOUT_DELAY_MS)
      )
    }
  }

  try {
    const firstChannel = channels[0]
    if (firstChannel) {
      const firstHash = createHash('sha256')
        .update(firstChannel.webhookUrl)
        .digest('hex')
      const mentionedRoles: Array<unknown> = [
        {
          role: MANUAL_OVERRIDE_AUDIT_ROLE,
          prime,
          officer: actorDisplayName ?? null,
          invocation_id: invocationId
        }
      ]
      // Columns not yet in the generated Supabase types; cast through unknown.
      const { error: auditError } = await supabase
        .from('discord_webhook_logs')
        .insert({
          guild_code: guildCode,
          webhook_type: HERALD_WEBHOOK_TYPE,
          webhook_url_hash: firstHash,
          // Aggregate audit/dedup row: excluded from delivery counts, included in health
          // recovery so a mixed fanout stays failed.
          status: posted > 0 && failed === 0 ? 'delivered' : 'failed',
          payload_preview: primeBossId,
          mentioned_roles: mentionedRoles,
          threshold_breach_type:
            prime === 'a' ? 'prime_a_threshold' : 'prime_b_threshold',
          manual_override: true
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns not yet in generated types
        } as any)
      if (auditError) {
        logger.warn(
          {
            herald_invocation_id: invocationId,
            guild_code: guildCode,
            err: auditError.message
          },
          'herald.manual_override.audit_write_failed'
        )
      }
    }
  } catch (auditErr) {
    logger.warn(
      {
        herald_invocation_id: invocationId,
        guild_code: guildCode,
        err: auditErr instanceof Error ? auditErr.message : String(auditErr)
      },
      'herald.manual_override.audit_write_failed'
    )
  }

  return {
    channels: channels.length,
    posted,
    failed,
    scope,
    role_ping_count: roleIds.length,
    prime_boss_id: primeBossId,
    ...(posted === 0 && lastError ? { error: `post_failed:${lastError}` } : {})
  }
}
