import { requireRole } from '@/app/lib/auth'
import { Construction } from 'lucide-react'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Guild Theme Editor',
  description:
    'Guild theme customization status and branding controls for officers.',
  path: '/guild-management/theme'
})

export default async function GuildThemePage() {
  await requireRole('officer')

  return (
    <div className="space-y-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          Theme Editor Temporarily Disabled
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          The guild theme customization feature is temporarily disabled for
          troubleshooting purposes.
        </p>
      </div>

      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 border border-[var(--card-border)] rounded-lg p-8 text-center">
        <Construction className="mx-auto mb-4 h-16 w-16 text-[var(--text-tertiary)]" />
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
          Feature Temporarily Unavailable
        </h2>
        <p className="text-[var(--text-secondary)] mb-4">
          The theme editor is currently disabled while we focus on other system
          improvements.
        </p>
        <p className="text-sm text-[var(--text-tertiary)]">
          You can still use basic theme presets in Guild Settings → Identity &
          Branding
        </p>
      </div>
    </div>
  )
}
