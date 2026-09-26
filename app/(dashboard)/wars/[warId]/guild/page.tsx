import WarPlayerStatsClient from '@/app/(dashboard)/wars/_components/WarPlayerStatsClient'
import { createPageMetadata } from '@/app/lib/metadata'

type GuildStatsPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: GuildStatsPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Guild Stats`,
    description:
      'Guild-side war statistics, scoring contribution, and member performance for the selected war.',
    path: `/wars/${warId}/guild`
  })
}

export default async function GuildStatsPage({ params }: GuildStatsPageProps) {
  const { warId } = await params
  return <WarPlayerStatsClient warId={warId} side="guild" />
}
