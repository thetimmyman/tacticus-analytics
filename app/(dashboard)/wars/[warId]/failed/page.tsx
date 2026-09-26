import FailedAttemptsClient from './FailedAttemptsClient'
import { createPageMetadata } from '@/app/lib/metadata'

type FailedAttemptsPageProps = {
  params: Promise<{ warId: string }>
}

export async function generateMetadata({ params }: FailedAttemptsPageProps) {
  const { warId } = await params

  return createPageMetadata({
    title: `War ${warId} Failed Attempts`,
    description:
      'Review failed attacks, missed scoring opportunities, and cleanup targets for the selected war.',
    path: `/wars/${warId}/failed`
  })
}

export default async function FailedAttemptsPage({
  params
}: FailedAttemptsPageProps) {
  const { warId } = await params
  return <FailedAttemptsClient warId={warId} />
}
