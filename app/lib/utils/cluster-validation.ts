import { db } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import type { PlayerMapping } from '@tacticus/app-core/types'

async function validateGuildAccess(
  userProfile: PlayerMapping,
  targetGuildCode: string
): Promise<{ valid: boolean; error?: string }> {
  const supabase = await db()

  if (canManageHeraldRole(userProfile.role)) {
    const targetGuild = await GuildConfigService.getBasic(
      supabase,
      targetGuildCode
    )

    if (!targetGuild) {
      return { valid: false, error: 'Guild not found' }
    }

    const userGuild = await GuildConfigService.getBasic(
      supabase,
      userProfile.guild_code ?? ''
    )

    if (!userGuild) {
      return { valid: false, error: 'User guild not found' }
    }

    const sameCluster =
      targetGuild?.cluster_code &&
      targetGuild.cluster_code === userGuild?.cluster_code

    if (!sameCluster) {
      return {
        valid: false,
        error: 'Cannot access guilds from different clusters'
      }
    }

    return { valid: true }
  }

  return {
    valid: targetGuildCode === userProfile.guild_code,
    error:
      targetGuildCode !== userProfile.guild_code
        ? 'Insufficient permissions'
        : undefined
  }
}

export async function validateWebhookManagementAccess(
  userProfile: PlayerMapping,
  targetGuildCode?: string
): Promise<{
  valid: boolean
  error?: string
  accessLevel: 'cluster' | 'guild' | 'none'
}> {
  if (!canManageHeraldRole(userProfile.role)) {
    return {
      valid: false,
      error: 'Members cannot manage webhooks',
      accessLevel: 'none'
    }
  }

  if (!targetGuildCode) {
    return {
      valid: true,
      accessLevel: 'cluster' // Officers and leaders have cluster-wide access
    }
  }

  const guildAccess = await validateGuildAccess(userProfile, targetGuildCode)
  if (!guildAccess.valid) {
    return {
      valid: false,
      error: guildAccess.error,
      accessLevel: 'none'
    }
  }

  return {
    valid: true,
    accessLevel: 'cluster' // Officers and leaders manage entire cluster
  }
}
