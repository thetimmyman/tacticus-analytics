import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { redirect } from 'next/navigation'

export const metadata = {
  title: 'Boss Assignments | Tacticus Analytics',
  description:
    'Boss target planning, token capacity, and assignment queues for guild officers'
}

export default async function BossAssignmentsPage() {
  await requireBossAssignmentsAccess()

  redirect('/boss-assignments/current')
}
