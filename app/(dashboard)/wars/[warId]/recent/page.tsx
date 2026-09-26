import RecentActivityClient from './RecentActivityClient'
import { createPageMetadata } from '@/app/lib/metadata'

type RecentActivityPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: RecentActivityPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Recent Activity`,
    description:
      'Recent guild war activity feed with attacks, zone changes, and current progress for the selected war.',
    path: `/wars/${warId}/recent`
  })
}

export default async function RecentActivityPage({
  params
}: RecentActivityPageProps) {
  const { warId } = await params
  return <RecentActivityClient warId={warId} />
}
