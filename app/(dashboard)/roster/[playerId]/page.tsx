import { requireRole } from '@/app/lib/auth'
import MemberRosterClient from './MemberRosterClient'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ playerId: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { playerId } = await params

  return createPageMetadata({
    title: `Roster Member ${playerId}`,
    description:
      'Officer roster detail view for reviewing a selected guild member and their roster data.',
    path: `/roster/${playerId}`
  })
}

export default async function MemberRosterPage({ params }: PageProps) {
  await requireRole('officer')
  const { playerId } = await params

  return <MemberRosterClient playerId={playerId} />
}
