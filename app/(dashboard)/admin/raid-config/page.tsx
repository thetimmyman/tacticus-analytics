import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { RaidConfigPanel } from './RaidConfigPanel'

export const metadata: Metadata = {
  title: 'Guild Raid Progression Overrides | Admin',
  description: 'Manage guild-specific raid boss progression sequence overrides'
}

export default async function RaidConfigPage() {
  const { profile } = await requireAuth()

  if (!profile?.is_app_admin) {
    redirect('/home')
  }

  return <RaidConfigPanel />
}
