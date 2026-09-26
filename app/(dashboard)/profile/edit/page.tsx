import { requireAuth } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import {
  getUserAvatar,
  resolveAvatarFrameMap,
  resolvePlayerAvatar
} from '@/app/lib/utils/avatar'
import { createPageMetadata } from '@/app/lib/metadata'
import EditProfileClient from './EditProfileClient'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'

export const metadata = createPageMetadata({
  title: 'Edit Profile',
  description:
    'Update your Tacticus Analytics profile details, avatar, and account preferences.',
  path: '/profile/edit'
})

// Placeholder fields not yet in the database.
interface ExtendedProfileFields {
  notify_boss_kills?: boolean
  notify_prime_kills?: boolean
  notify_when_capped?: boolean
  primary_team?: string
  secondary_team?: string
  tertiary_team?: string
}

export default async function EditProfilePage() {
  const supabase = await db()
  const { user, profile } = await requireAuth(supabase)
  const { data: onboardingState, error: onboardingStateError } =
    await supabase.rpc('get_my_onboarding_state')
  const hasApiKey =
    !onboardingStateError && onboardingState?.[0]?.api_key_configured === true

  const extendedProfile = profile as typeof profile & ExtendedProfileFields

  const hasDiscordLinked = Boolean(profile.discord_username)

  const displayName =
    profile.display_name || user.email?.split('@')[0] || 'User'
  const guildCode = profile.guild_code || 'GLOBAL'
  let avatarUrl = getUserAvatar(displayName, guildCode, 100)

  try {
    const { data: playerMapping } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('avatar_unit_id')
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    const avatarUnitId = playerMapping?.avatar_unit_id
    if (avatarUnitId) {
      const frameMap = await resolveAvatarFrameMap(supabase, avatarUnitId)

      // No datamine fallback: the <Image> has no onError, so a 404 would show a broken image.
      avatarUrl = resolvePlayerAvatar({
        avatarUnitId,
        playerName: displayName,
        guildCode,
        size: 100,
        frameMap,
        datamineFallback: false
      })
    }
  } catch {
    // Fall back to the default avatar.
  }

  const initialProfile = {
    player_id: profile.player_id,
    display_name: profile.display_name,
    guild_code: profile.guild_code ?? '',
    timezone: profile.timezone || undefined,
    discord_username: profile.discord_username || undefined,
    tacticus_share_url: profile.tacticus_share_url || undefined,
    theme_preference: profile.theme_preference || undefined,
    has_api_key: hasApiKey,
    api_key_is_valid: profile.api_key_is_valid || undefined,
    api_key_last_verified: profile.api_key_last_verified || undefined,
    notify_boss_kills: extendedProfile.notify_boss_kills,
    notify_prime_kills: extendedProfile.notify_prime_kills,
    notify_when_capped: extendedProfile.notify_when_capped,
    primary_team: extendedProfile.primary_team,
    secondary_team: extendedProfile.secondary_team,
    tertiary_team: extendedProfile.tertiary_team,
    avatar_url: avatarUrl
  }

  // From public.meta_teams, ordered like /api/herald/available-meta-teams so all surfaces agree.
  const { data: metaTeamRows } = await supabase
    .from('meta_teams')
    .select('team_name, sort_order')
    .order('sort_order', { ascending: true })
    .order('team_name', { ascending: true })
  const teamOptions = (metaTeamRows ?? []).map((row) => row.team_name)

  return (
    <EditProfileClient
      userId={user.id}
      initialProfile={initialProfile}
      hasDiscordLinked={hasDiscordLinked}
      teamOptions={teamOptions}
    />
  )
}
