import { requireRole } from '@/app/lib/auth'
import { createPageMetadata } from '@/app/lib/metadata'
import { redirect } from 'next/navigation'

export const metadata = createPageMetadata({
  title: 'Guild Management',
  description:
    'Manage guild members, settings, reports, and operational guild tools.',
  path: '/guild-management'
})

export default async function GuildManagementPage() {
  await requireRole('officer')

  redirect('/guild-management/members')
}
