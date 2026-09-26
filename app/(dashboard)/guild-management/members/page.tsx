import { requireRole } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { getCachedSeasonData } from '@/app/lib/api/cached-responses'
import { MemberManagementServer } from './MemberManagementServer'
import { createComponentLogger } from '@/app/lib/logging/client'
import { createPageMetadata } from '@/app/lib/metadata'
import { toBrowserGuildMemberRow } from './components'
const logger = createComponentLogger('guild-management.members.page')

export const metadata = createPageMetadata({
  title: 'Guild Members',
  description:
    'Manage guild membership, player roles, roster mapping, and member-level guild raid operations.',
  path: '/guild-management/members'
})

export default async function MemberManagementPage() {
  const { profile } = await requireRole('officer')
  const supabase = await db()

  const { data, error } = await supabase.rpc('get_guild_members_browser_safe')
  if (error) {
    logger.error(
      {
        err: error,
        code: error.code,
        message: error.message,
        details: error.details
      },
      'Failed to load members through browser-safe RPC'
    )
    throw new Error('Failed to load guild members', { cause: error })
  }

  // The RPC enforces guild scope; this filter is a second boundary before a Client Component.
  const allMembers = (data ?? []).map(toBrowserGuildMemberRow)
  const members = allMembers.filter((m) => m.guild_code === profile.guild_code)

  const hasCluster = Boolean(profile.cluster_code)

  // Resolve the latest season server-side so season-keyed columns render on first paint.
  let initialSeason = ''
  try {
    const seasons = await getCachedSeasonData(
      profile.guild_code ?? '',
      profile.cluster_code ?? undefined
    )
    initialSeason = seasons[0] ?? ''
  } catch (seasonError) {
    logger.error({ err: seasonError }, 'Failed to resolve latest season')
  }

  const claimedProfiles = members.filter((member) => member.is_claimed).length

  return (
    <div className="space-y-6">
      {/* Member Management Table */}
      <MemberManagementServer
        initialMembers={members}
        userRole={profile.role ?? 'member'}
        userGuildCode={profile.guild_code ?? ''}
        claimedProfiles={claimedProfiles}
        hasCluster={hasCluster}
        initialSeason={initialSeason}
        userTimezone={profile.timezone ?? undefined}
        isAppAdmin={Boolean(profile.is_app_admin)}
      />
    </div>
  )
}
