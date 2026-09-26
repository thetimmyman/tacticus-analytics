import { getVeteranStats } from '@/app/lib/data/veterans'
import MemberManagement from './MemberManagement'
import type { PlayerRole } from '@tacticus/app-core/types'
import type { BrowserGuildMemberRow, ExtendedMember } from './components'
import type { AvatarFrame } from '@/app/lib/utils/avatar'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.members.MemberManagementServer'
)
import { db } from '@/app/lib/db'

interface MemberManagementServerProps {
  initialMembers: BrowserGuildMemberRow[]
  userRole: PlayerRole
  userGuildCode: string
  claimedProfiles: number
  hasCluster?: boolean
  initialSeason?: string
  userTimezone?: string
  isAppAdmin?: boolean
}

export async function MemberManagementServer({
  initialMembers,
  userRole,
  userGuildCode,
  claimedProfiles,
  hasCluster = true,
  initialSeason = '',
  userTimezone,
  isAppAdmin = false
}: MemberManagementServerProps) {
  let initialVeteranCount = 0
  let avatarFrames: AvatarFrame[] = []

  try {
    const [veteranStats, supabase] = await Promise.all([
      getVeteranStats(userGuildCode),
      db()
    ])
    initialVeteranCount = veteranStats.count

    const { data: frames } = await supabase
      .from('player_avatar_frames')
      .select('avatar_id, icon_url')
    avatarFrames = frames || []
  } catch (error) {
    logger.error(
      { err: error },
      'Error pre-fetching veteran stats or avatar frames:'
    )
  }

  return (
    <MemberManagement
      initialMembers={initialMembers as unknown as ExtendedMember[]}
      userRole={userRole ?? 'member'}
      userGuildCode={userGuildCode}
      claimedProfiles={claimedProfiles}
      initialVeteranCount={initialVeteranCount}
      hasCluster={hasCluster}
      initialSeason={initialSeason}
      avatarFrames={avatarFrames}
      userTimezone={userTimezone}
      isAppAdmin={isAppAdmin}
    />
  )
}
