import { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
import { isAppAdminProfile } from '@/app/lib/auth/app-admin'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'
import { db } from '@/app/lib/db'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { BossPlaybookDetail } from './BossPlaybookDetail'
import playbooks from '@/data/boss-playbooks/playbooks.json'
import type { Boss } from '../types'

interface PageProps {
  params: Promise<{ bossId: string }>
}

interface AccessLevels {
  is_admin?: boolean
  is_app_admin?: boolean
  is_alpha_tester?: boolean
}

export async function generateMetadata({
  params
}: PageProps): Promise<Metadata> {
  const { bossId } = await params
  const boss = (playbooks.bosses as Boss[]).find((b) => b.id === bossId)

  if (!boss) {
    return { title: 'Boss Not Found | Tacticus Analytics' }
  }

  return {
    title: `${boss.name} Playbook | Tacticus Analytics`,
    description: `Detailed strategy guide for ${boss.name}`
  }
}

export async function generateStaticParams() {
  return (playbooks.bosses as Boss[]).map((boss) => ({
    bossId: boss.id
  }))
}

export default async function BossPlaybookPage({ params }: PageProps) {
  const { user, profile } = await requireAuth()
  const { bossId } = await params

  const access = await checkFeatureAccess(user.id, 'boss_playbooks')
  if (!access.has_access) {
    redirect('/home')
  }

  const boss = (playbooks.bosses as Boss[]).find((b) => b.id === bossId)

  if (!boss) {
    notFound()
  }

  const supabase = await db()

  // Fall back to direct access checks if the RPC is missing.
  let canEdit = false
  try {
    const permissionResponse = await supabase.rpc('can_edit_playbooks', {
      user_id: user.id
    })
    if (permissionResponse.error) {
      const { data: accessDataRaw } = await supabase.rpc(
        'get_user_access_levels',
        { p_user_id: user.id }
      )
      const accessData = accessDataRaw as unknown as AccessLevels | null
      const isAdmin = accessData?.is_admin || accessData?.is_app_admin
      const isAlpha = accessData?.is_alpha_tester
      canEdit = !!(isAdmin || isAlpha)
    } else {
      canEdit = !!permissionResponse.data
    }
  } catch {
    canEdit =
      isOfficerLeaderOrAdminRole(profile.role) || isAppAdminProfile(profile)
  }

  return <BossPlaybookDetail boss={boss} canEdit={canEdit} />
}
