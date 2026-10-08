import { requireRole } from '@/app/lib/auth'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { db } from '@/app/lib/db'
import { createPageMetadata } from '@/app/lib/metadata'

import { GuildTeamsClient } from './GuildTeamsClient'
import { pickPageTitle } from './guild-teams-shared'

export const metadata = createPageMetadata({
  title: 'Guild Meta Tracker',
  description:
    'Track guild raid team compositions, hero usage, and shared meta-team planning data.',
  path: '/guild-teams'
})

export default async function GuildTeamsPage() {
  const desktopMode = getRuntimeProfile() === 'desktop'
  // Local owners keep their member role. The canonical roster RPC restricts
  // members to their own guild and their own roster.
  const { profile } = await requireRole(desktopMode ? 'member' : 'officer')
  const supabase = await db()

  const { data: mappings } = await supabase
    .from('hero_mappings')
    .select('id, unit_id, display_name, web_icon_url, category')

  const heroMappings: Record<
    string,
    {
      id: number
      unit_id: string
      display_name: string | null
      web_icon_url: string | null
      category: string | null
    }
  > = {}

  for (const m of mappings ?? []) {
    heroMappings[m.unit_id] = m
  }

  return (
    <div className="space-y-6">
      <GuildTeamsClient
        guildCode={profile.guild_code!}
        heroMappings={heroMappings}
        pageTitle={pickPageTitle()}
        desktopMode={desktopMode}
      />
    </div>
  )
}
