import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { AdminDashboard } from './AdminDashboard'

export const metadata: Metadata = {
  title: 'Admin Dashboard | Tacticus Analytics',
  description: 'Manage users, features, carousel items, and subscriptions'
}

export default async function AdminPage() {
  const { profile } = await requireAuth()

  if (!profile?.is_app_admin) {
    redirect('/home')
  }

  return <AdminDashboard />
}
