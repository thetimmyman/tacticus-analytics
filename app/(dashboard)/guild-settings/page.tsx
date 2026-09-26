// Alias of `/guild-management/settings` under the Settings workspace. `force-dynamic`
// because the actions revalidate only the canonical path.
import { createPageMetadata } from '@/app/lib/metadata'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Guild Settings',
  description:
    'Alias for officer guild settings, identity, API key, webhook, and branding configuration.',
  path: '/guild-settings'
})

export { default } from '@/app/(dashboard)/guild-management/settings/page'
