import PerfectHitsClient from './PerfectHitsClient'
import { createPageMetadata } from '@/app/lib/metadata'

type PerfectHitsPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: PerfectHitsPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Perfect Hits`,
    description:
      'Perfect-hit analysis for the selected war, including clean attacks and high-value scoring outcomes.',
    path: `/wars/${warId}/perfect`
  })
}

export default async function PerfectHitsPage({
  params
}: PerfectHitsPageProps) {
  const { warId } = await params
  return <PerfectHitsClient warId={warId} />
}
