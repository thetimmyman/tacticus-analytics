import { ShieldX } from 'lucide-react'
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'

export const metadata = createPageMetadata({
  title: 'Account Suspended',
  description: 'This Tacticus Analytics account has been suspended.',
  path: '/auth/suspended'
})

/** No reason or identifier shown: that would tell a ban evader which handle to change. */
export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4 p-8 rounded-lg bg-(--bg-secondary) border border-(--card-border)">
        <ShieldX className="h-12 w-12 mx-auto text-red-400" />
        <h1 className="text-2xl font-bold text-primary-wh40k">
          Account Suspended
        </h1>
        <p className="text-secondary-wh40k">
          This account has been suspended and cannot access Tacticus Analytics.
        </p>
        <p className="text-sm text-secondary-wh40k">
          If you believe this is a mistake, contact an app administrator.
        </p>
      </div>
    </div>
  )
}
