import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { DeploymentManager } from './DeploymentManager'

export const metadata: Metadata = {
  title: 'Deployment Manager | Tacticus Analytics',
  description: 'Manage container versions and rollbacks'
}

export default async function DeploymentsPage() {
  const { profile } = await requireAuth()

  if (!profile?.is_app_admin) {
    redirect('/home')
  }

  return <DeploymentManager />
}
