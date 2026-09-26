import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import PrivacyPolicyClient from './PrivacyPolicyClient'
import { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Privacy Policy - Tacticus Analytics | Data Protection & Security',
  description:
    'Learn how Tacticus Analytics protects your data and privacy. This privacy policy covers data collection, usage, storage, and your rights regarding personal information.',
  keywords:
    'tacticus analytics privacy, data protection, privacy policy, data security, personal information, gdpr compliance'
}

export default async function PrivacyPolicy() {
  const authData = await getAuthUser()

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <PrivacyPolicyClient />
    </div>
  )
}
