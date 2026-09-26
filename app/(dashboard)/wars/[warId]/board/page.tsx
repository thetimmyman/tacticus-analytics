import BoardClient from './BoardClient'
import ZoneStatsSection from './ZoneStatsSection'
import { createPageMetadata } from '@/app/lib/metadata'

type WarBoardPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: WarBoardPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Board`,
    description:
      'Interactive guild war board with zones, scoring state, and per-zone offense/defense stats for the selected war.',
    path: `/wars/${warId}/board`
  })
}

export default async function WarBoardPage({ params }: WarBoardPageProps) {
  const { warId } = await params
  return (
    <div className="space-y-6">
      <BoardClient warId={warId} />
      <ZoneStatsSection warId={warId} />
    </div>
  )
}
