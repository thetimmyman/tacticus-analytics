// Cluster invite codes: multi-use; a NULL invite_expires_at never expires.

import { randomInt } from 'crypto'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.utils.invite-codes')

const INVITE_CODE_CHARS = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ'

// CSPRNG only: codes guard cluster access, so a predictable generator would expose live codes.
export async function generateInviteCode(length: number = 10): Promise<string> {
  const maxAttempts = 100
  let attempts = 0
  const supabase = await db()

  while (attempts < maxAttempts) {
    let code = ''
    for (let i = 0; i < length; i++) {
      const randomIndex = randomInt(0, INVITE_CODE_CHARS.length)
      code += INVITE_CODE_CHARS[randomIndex]
    }

    const { data: existing } = await supabase
      .from('clusters')
      .select('id')
      .eq('invite_code', code)
      .single()

    if (!existing) {
      logger.info(
        {
          codeLength: code.length,
          attempts: attempts + 1
        },
        'Generated unique invite code'
      )
      return code
    }

    attempts++
  }

  throw new Error(
    `Failed to generate unique invite code after ${maxAttempts} attempts`
  )
}

export function validateInviteCodeFormat(code: string): boolean {
  if (!code || typeof code !== 'string') return false
  if (code.length < 6 || code.length > 20) return false
  return /^[A-Z0-9]+$/.test(code)
}

export async function validateInviteCode(code: string): Promise<{
  valid: boolean
  cluster?: {
    id?: string
    cluster_code?: string
    display_name?: string
    invite_code?: string
    max_guilds?: number | null
    created_by?: string | null
  }
  error?: string
}> {
  if (!validateInviteCodeFormat(code)) {
    return { valid: false, error: 'Invalid invite code format' }
  }

  const supabase = await db()
  const { data: cluster, error } = await supabase
    .from('clusters')
    .select(
      'id, cluster_code, display_name, invite_code, max_guilds, created_by, invite_expires_at'
    )
    .eq('invite_code', code)
    .eq('is_active', true)
    .single()

  if (error || !cluster) {
    logger.warn(
      { code: code.substring(0, 3) + '***' },
      'Invalid invite code attempted'
    )
    return { valid: false, error: 'Invalid or expired invite code' }
  }

  const expiresAt = (
    cluster as unknown as { invite_expires_at?: string | null }
  ).invite_expires_at
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    logger.warn(
      { code: code.substring(0, 3) + '***' },
      'Expired invite code attempted'
    )
    return { valid: false, error: 'Invalid or expired invite code' }
  }

  const { data: currentGuilds } = await supabase
    .from('guild_config')
    .select('id')
    .eq('cluster_id', cluster.id)

  const currentCount = currentGuilds?.length || 0
  const maxGuilds = (cluster as unknown as { max_guilds?: number }).max_guilds
  if (maxGuilds != null && currentCount >= maxGuilds) {
    return { valid: false, error: 'Cluster is at maximum capacity' }
  }

  return {
    valid: true,
    cluster: cluster as {
      id: string
      cluster_code: string
      display_name?: string
      invite_code?: string
      max_guilds?: number | null
      created_by?: string | null
    }
  }
}

export async function regenerateClusterInviteCode(
  clusterId: string,
  userId: string,
  expiresAt: Date | string | null = null
): Promise<{
  success: boolean
  inviteCode?: string
  error?: string
}> {
  try {
    const supabase = await db()
    const { data: cluster } = await supabase
      .from('clusters')
      .select('created_by')
      .eq('id', clusterId)
      .single()

    if (!cluster || cluster.created_by !== userId) {
      return {
        success: false,
        error: 'Unauthorized - you do not own this cluster'
      }
    }

    const newCode = await generateInviteCode()

    // Expiry must move with the code, or a stale past timestamp rejects it.
    const { error } = await supabase
      .from('clusters')
      .update({
        invite_code: newCode,
        invite_expires_at:
          expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', clusterId)

    if (error) {
      logger.error({ clusterId, error }, 'Failed to update invite code')
      return { success: false, error: 'Failed to update invite code' }
    }

    logger.info({ clusterId, userId }, 'Regenerated cluster invite code')
    return { success: true, inviteCode: newCode }
  } catch (error) {
    logger.error({ clusterId, error }, 'Error regenerating invite code')
    return { success: false, error: 'Internal error' }
  }
}

export async function disableClusterInviteCode(
  clusterId: string,
  userId: string
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const supabase = await db()

    const { data: cluster } = await supabase
      .from('clusters')
      .select('created_by')
      .eq('id', clusterId)
      .single()

    if (!cluster || cluster.created_by !== userId) {
      return { success: false, error: 'Unauthorized' }
    }

    const { error } = await supabase
      .from('clusters')
      .update({
        invite_code: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', clusterId)

    if (error) {
      return { success: false, error: 'Failed to disable invite code' }
    }

    logger.info({ clusterId, userId }, 'Disabled cluster invite code')
    return { success: true }
  } catch {
    return { success: false, error: 'Internal error' }
  }
}
