import { redirect } from 'next/navigation'

type WarMapsPageProps = {
  params: Promise<{ warId: string }>
}

export default async function WarMapsPage({ params }: WarMapsPageProps) {
  const { warId } = await params
  redirect(`/wars/${warId}/board`)
}
