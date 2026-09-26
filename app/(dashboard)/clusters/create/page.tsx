import { requireAuth } from '@/app/lib/auth'
import { redirect } from 'next/navigation'
import ClusterCreationWizard from './ClusterCreationWizard'

export const metadata = {
  title: 'Create New Cluster | Guild Raid Dashboard',
  description: 'Create and configure a new guild cluster'
}

export default async function CreateClusterPage() {
  const { profile } = await requireAuth()

  if (profile.role !== 'leader') {
    redirect('/dashboard')
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-[var(--card-border)] pb-4">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          Create New Cluster
        </h1>
        <p className="text-[var(--text-secondary)] mt-2">
          Set up a new guild cluster with custom branding and configuration
        </p>
      </div>

      <ClusterCreationWizard />
    </div>
  )
}
