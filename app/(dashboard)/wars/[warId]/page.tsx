import WarSummaryClient from './WarSummaryClient'
import { createPageMetadata } from '@/app/lib/metadata'

type WarPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: WarPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Summary`,
    description:
      'Guild war summary with score, progress, map context, and matchup overview.',
    path: `/wars/${warId}`
  })
}

export default async function WarSummaryPage({ params }: WarPageProps) {
  const { warId } = await params
  return <WarSummaryClient warId={warId} />
}
