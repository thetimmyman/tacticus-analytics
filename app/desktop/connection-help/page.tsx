import { notFound } from 'next/navigation'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { DesktopCredentialGuide } from '@/app/components/navigation/DesktopCredentialGuide'

export default function ConnectionHelpPage() {
  if (getRuntimeProfile() !== 'desktop') notFound()
  return (
    <main className="max-w-4xl mx-auto p-8">
      <DesktopCredentialGuide />
      <a href="/player-performance">Return to analytics</a>
    </main>
  )
}
