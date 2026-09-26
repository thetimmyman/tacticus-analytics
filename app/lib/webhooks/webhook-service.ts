import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.webhooks.webhook-service')
import { Errors } from '@/app/lib/errors/AppError'
import {
  LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE,
  PROACTIVE_TOKEN_MANAGEMENT_FEATURE_KEY,
  isProactiveTokenManagementWebhookType,
  normalizeProactiveTokenManagementWebhookType
} from '@/app/lib/discord/proactive-token-management'

type WebhookSupabaseClient = SupabaseClient<Database>

export {
  LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE,
  isProactiveTokenManagementWebhookType,
  normalizeProactiveTokenManagementWebhookType
} from '@/app/lib/discord/proactive-token-management'

export const DIAGNOSTIC_WEBHOOK_TYPE = 'diagnostic_messages'

export const PROACTIVE_TOKEN_MANAGEMENT_ALPHA_LOCK_MESSAGE =
  'Proactive Token Management is currently in alpha and is not enabled for your account.'

export type ExistingWebhookRow = {
  id: string
  webhook_type: string
}

export type WebhookRow = {
  cluster_id: string | null
  guild_code: string | null
  webhook_type: string
  webhook_url: string | null
  enabled: boolean | null
  updated_at: string | null
}

/** Throws Errors.forbidden without alpha access to proactive-token-management. */
export async function requireProactiveTokenManagementAccess(
  supabase: WebhookSupabaseClient,
  userId: string,
  endpoint: string
): Promise<void> {
  const { data: accessData, error: accessError } = await supabase.rpc(
    'check_feature_access',
    {
      p_user_id: userId,
      p_feature_key: PROACTIVE_TOKEN_MANAGEMENT_FEATURE_KEY
    }
  )

  const hasAccess = Boolean(
    (accessData as { has_access?: boolean } | null)?.has_access
  )
  if (accessError || !hasAccess) {
    logger.warn(
      {
        userId,
        endpoint,
        error: accessError?.message,
        hasAccess
      },
      'Blocked proactive token management webhook access due to alpha lock'
    )

    throw Errors.forbidden(PROACTIVE_TOKEN_MANAGEMENT_ALPHA_LOCK_MESSAGE, {
      endpoint,
      user_id: userId
    })
  }
}

/** Falls back from legacy to canonical proactive-token-management webhook types. */
export async function findExistingWebhook(
  supabase: WebhookSupabaseClient,
  webhookType: string,
  guildCode: string | null,
  clusterId: string | null
): Promise<ExistingWebhookRow | null> {
  // Generic scope helper keeps PostgrestFilterBuilder types through `.single()` without `any`.
  const scoped = <T extends { eq: (column: string, value: string) => T }>(
    query: T
  ): T => {
    if (guildCode) {
      return query.eq('guild_code', guildCode)
    }
    if (clusterId) {
      return query.eq('cluster_id', clusterId)
    }
    return query
  }

  if (!isProactiveTokenManagementWebhookType(webhookType)) {
    const { data, error } = await scoped(
      supabase
        .from('webhook_config')
        .select('id, webhook_type')
        .eq('webhook_type', webhookType)
    ).single()

    if (error) {
      if (error.code !== 'PGRST116') {
        logger.error({ err: error }, 'Error checking for existing webhook:')
      }
      return null
    }
    return data as ExistingWebhookRow
  }

  const { data: canonicalData, error: canonicalError } = await scoped(
    supabase
      .from('webhook_config')
      .select('id, webhook_type')
      .eq('webhook_type', webhookType)
  ).single()

  if (canonicalData) {
    return canonicalData as ExistingWebhookRow
  }
  if (canonicalError && canonicalError.code !== 'PGRST116') {
    logger.error(
      { err: canonicalError },
      'Error checking canonical proactive webhook:'
    )
  }

  const { data: legacyData, error: legacyError } = await scoped(
    supabase
      .from('webhook_config')
      .select('id, webhook_type')
      .eq('webhook_type', LEGACY_TOKEN_CAP_ALERTS_WEBHOOK_TYPE)
  ).single()

  if (legacyError && legacyError.code !== 'PGRST116') {
    logger.error(
      { err: legacyError },
      'Error checking legacy proactive webhook:'
    )
  }

  return (legacyData as ExistingWebhookRow | null) ?? null
}

/** Keeps the best row per (guild_code, cluster_id, normalized_type). */
export function normalizeWebhookRows(rows: WebhookRow[]): WebhookRow[] {
  const byScopeAndType = new Map<
    string,
    { row: WebhookRow; score: number; updatedAt: number }
  >()

  for (const row of rows) {
    const originalType = row.webhook_type
    const normalizedType =
      normalizeProactiveTokenManagementWebhookType(originalType)
    const normalizedRow: WebhookRow =
      originalType === normalizedType
        ? row
        : { ...row, webhook_type: normalizedType }

    const key = `${normalizedRow.guild_code ?? ''}:${normalizedRow.cluster_id ?? ''}:${normalizedRow.webhook_type}`
    const score =
      (normalizedRow.webhook_url ? 4 : 0) +
      (normalizedRow.enabled ? 2 : 0) +
      (originalType === normalizedType ? 1 : 0)
    const updatedAt = Date.parse(normalizedRow.updated_at ?? '') || 0
    const current = byScopeAndType.get(key)

    if (
      !current ||
      score > current.score ||
      (score === current.score && updatedAt > current.updatedAt)
    ) {
      byScopeAndType.set(key, { row: normalizedRow, score, updatedAt })
    }
  }

  return Array.from(byScopeAndType.values())
    .map((entry) => entry.row)
    .sort((a, b) => a.webhook_type.localeCompare(b.webhook_type))
}

export function normalizeError(error: unknown): {
  message: string
  stack?: string
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? undefined }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (error && typeof error === 'object') {
    const potentialMessage = (error as { message?: unknown }).message
    const potentialStack = (error as { stack?: unknown }).stack
    return {
      message:
        typeof potentialMessage === 'string'
          ? potentialMessage
          : 'Unknown error',
      stack: typeof potentialStack === 'string' ? potentialStack : undefined
    }
  }

  return { message: 'Unknown error' }
}
