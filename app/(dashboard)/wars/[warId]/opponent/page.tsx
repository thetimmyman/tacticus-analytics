import WarPlayerStatsClient from '@/app/(dashboard)/wars/_components/WarPlayerStatsClient'
import { createPageMetadata } from '@/app/lib/metadata'

type OpponentStatsPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: OpponentStatsPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Opponent Stats`,
    description:
      'Opponent-side war statistics, defensive pressure, and matchup context for the selected war.',
    path: `/wars/${warId}/opponent`
  })
}

export default async function OpponentStatsPage({
  params
}: OpponentStatsPageProps) {
  const { warId } = await params
  return <WarPlayerStatsClient warId={warId} side="opponent" />
}
