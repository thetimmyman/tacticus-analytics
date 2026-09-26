import { requireRole } from '@/app/lib/auth'
import { createPageMetadata } from '@/app/lib/metadata'
import WarRoomClient from './WarRoomClient'

export const metadata = createPageMetadata({
  title: 'War Room',
  description:
    'Shared offense and defense lineups for your guild and cluster, with readiness and active-war hero usage for your own guild.',
  path: '/war-room'
})

export default async function WarRoomPage() {
  const { profile } = await requireRole('member')
  const role = profile.role?.toLowerCase() ?? ''
  const canEdit = role === 'officer' || role === 'leader'

  return (
    <div className="px-4 py-6">
      <WarRoomClient canEdit={canEdit} />
    </div>
  )
}
