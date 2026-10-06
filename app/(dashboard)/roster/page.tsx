import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireAuth } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { createPageMetadata } from '@/app/lib/metadata'
import RosterClient from './RosterClient'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Roster',
  description:
    'Review your synced Tacticus roster, hero coverage, upgrade priorities, and guild raid readiness.',
  path: '/roster'
})

export default async function RosterPage() {
  const supabase = await db()
  const { profile } = await requireAuth(supabase)

  if (getRuntimeProfile() === 'desktop')
    return (
      <div>
        <RosterClient
          hasApiKey={true}
          desktopMode={true}
          playerName={profile.display_name || 'Commander'}
          guildCode={profile.guild_code || undefined}
          tacticusShareUrl={profile.tacticus_share_url || undefined}
        />
      </div>
    )

  // The projection excludes key ciphertext; presence comes from an auth.uid()-scoped boolean RPC.
  const { data: onboardingState, error: onboardingStateError } =
    await supabase.rpc('get_my_onboarding_state')
  const hasApiKey =
    !onboardingStateError && onboardingState?.[0]?.api_key_configured === true

  return (
    <RosterClient
      hasApiKey={hasApiKey}
      playerName={profile.display_name || 'Commander'}
      guildCode={profile.guild_code || undefined}
      tacticusShareUrl={profile.tacticus_share_url || undefined}
    />
  )
}
