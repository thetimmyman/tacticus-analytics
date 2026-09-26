import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { requireAuth } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { createPageMetadata } from '@/app/lib/metadata'
import AchievementsClient, {
  type AchievementPlayerOption
} from './AchievementsClient'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Achievements',
  description:
    'Track player achievement progress and guild accomplishment signals across your Tacticus roster.',
  path: '/achievements'
})

interface PageProps {
  searchParams?: Promise<{ player?: string }>
}

export default async function AchievementsPage({ searchParams }: PageProps) {
  const [{ profile }, params] = await Promise.all([
    requireAuth(),
    searchParams ?? Promise.resolve<{ player?: string }>({})
  ])

  const role = profile.role ?? 'member'
  const canSelectPlayers = role === 'leader' || role === 'officer'
  const selfPlayerId = profile.player_id
  let players: AchievementPlayerOption[] = selfPlayerId
    ? [
        {
          playerId: selfPlayerId,
          displayName: profile.display_name || 'Commander',
          guildCode: profile.guild_code,
          role,
          isSelf: true
        }
      ]
    : []

  if (canSelectPlayers && profile.guild_code) {
    const { data } = await guildRosterQuery(
      serviceDb(),
      profile.guild_code,
      'player_id,display_name,guild_code,role,user_id'
    ).order('display_name', { ascending: true })

    players = (data ?? [])
      .filter((player) => Boolean(player.player_id))
      .map((player) => ({
        playerId: player.player_id,
        displayName: player.display_name?.trim() || 'Unnamed player',
        guildCode: player.guild_code,
        role: player.role ?? 'member',
        isSelf: player.player_id === selfPlayerId,
        claimed: Boolean(player.user_id)
      }))
  }

  let viewerGuildLabel: string | null = null
  if (profile.guild_code) {
    const { data: guildConfig } = await serviceDb()
      .from('guild_config')
      .select('display_name,guild_tag')
      .eq('guild_code', profile.guild_code)
      .maybeSingle()
    viewerGuildLabel = formatGuildDisplayLabel(
      {
        display_name: guildConfig?.display_name,
        guild_tag: guildConfig?.guild_tag,
        guild_code: profile.guild_code
      },
      profile.guild_code
    )
  }

  const requestedPlayer = params?.player
  const initialPlayerId =
    requestedPlayer &&
    players.some((player) => player.playerId === requestedPlayer)
      ? requestedPlayer
      : selfPlayerId

  return (
    <AchievementsClient
      initialPlayerId={initialPlayerId}
      players={players}
      canSelectPlayers={canSelectPlayers}
      viewerGuildLabel={viewerGuildLabel}
    />
  )
}
