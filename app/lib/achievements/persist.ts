import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.achievements.persist')
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { evaluateAchievements } from './evaluate'

export async function evaluateAndPersistAchievements(
  supabase: TypedSupabaseClient,
  guildCode: string
): Promise<void> {
  const { data: members } = await guildRosterQuery(
    supabase,
    guildCode,
    'id,user_id,player_id,display_name,guild_code,cluster_code,player_power,player_level,tacticus_api_key_encrypted,tacticus_share_url,discord_user_id,timezone,primary_boss,secondary_boss,primary_team,secondary_team,tertiary_team,is_app_admin'
  )

  if (!members || members.length === 0) return

  let persisted = 0
  for (const member of members) {
    if (!member.player_id || !member.user_id) continue

    try {
      const unlocked = await evaluateAchievements(
        supabase,
        member.player_id,
        {
          mappingId: member.id,
          userId: member.user_id,
          playerId: member.player_id,
          displayName: member.display_name,
          guildCode: member.guild_code,
          clusterCode: member.cluster_code,
          playerPower: member.player_power,
          playerLevel: member.player_level,
          tacticusApiKeyEncrypted: member.tacticus_api_key_encrypted,
          tacticusShareUrl: member.tacticus_share_url,
          discordUserId: member.discord_user_id,
          timezone: member.timezone,
          primaryBoss: member.primary_boss,
          secondaryBoss: member.secondary_boss,
          primaryTeam: member.primary_team,
          secondaryTeam: member.secondary_team,
          tertiaryTeam: member.tertiary_team,
          isAppAdmin: member.is_app_admin
        },
        { includeVotlwAwards: false }
      )
      if (unlocked.length === 0) continue

      const rows = unlocked.map((a) => ({
        user_id: member.user_id,
        achievement_key: a.achievement_key,
        value: a.value ?? null
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- player_achievements not in generated types until migration applied
      const { error } = (await (supabase.from as any)(
        'player_achievements'
      ).upsert(rows, {
        onConflict: 'user_id,achievement_key',
        ignoreDuplicates: true
      })) as { error: { code: string; message: string } | null }

      if (error) {
        // 42P01: table not migrated yet.
        if (error.code === '42P01') return
        logger.warn(
          { error: error.message, player_id: member.player_id },
          'Achievement persist failed for player'
        )
      } else {
        persisted += unlocked.length
      }
    } catch {
      // Non-fatal per player.
    }
  }

  if (persisted > 0) {
    logger.info(
      { guildCode, persisted, memberCount: members.length },
      'Persisted guild achievements'
    )
  }
}
