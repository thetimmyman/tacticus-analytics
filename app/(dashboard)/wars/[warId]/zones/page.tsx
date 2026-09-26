import { redirect } from 'next/navigation'

type ZonesPageProps = {
  params: Promise<{ warId: string }>
}

export default async function ZonesPage({ params }: ZonesPageProps) {
  const { warId } = await params
  redirect(`/wars/${warId}/board`)
}
