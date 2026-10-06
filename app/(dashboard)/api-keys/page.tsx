import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { DesktopCredentialGuide } from '@/app/components/navigation/DesktopCredentialGuide'
import { requireRole } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { createPageMetadata } from '@/app/lib/metadata'
import ApiKeyManagementClient from './ApiKeyManagementClient'

export const metadata = createPageMetadata({
  title: 'API Key Management',
  description:
    'Manage the guild API key connection used for roster sync, raid data, and operational analytics.',
  path: '/api-keys'
})

interface GuildConfig {
  id: number
  guild_code: string
  display_name: string
  has_api_key: boolean
  API_Owner?: string | null
  api_key_is_valid: boolean | null
  enabled: boolean | null
  updated_at: string | null
  api_key_last_validated: string | null
}

export default async function ApiKeyManagementPage() {
  if (getRuntimeProfile() === 'desktop') return <DesktopCredentialGuide />
  // Any guild member may use this console (updating the key fixes a lagging roster sync).
  // Save/Replace need own-guild membership; Remove stays officer+ as it disables auto_sync.
  const { profile } = await requireRole('member')
  const supabase = await db()

  // API_Owner (an email) is not granted to authenticated; the officer-gated RPC below supplies it.
  const { data: guildConfig, error } = await supabase
    .from('guild_config')
    .select(
      'id, guild_code, display_name, api_key_is_valid, enabled, updated_at, api_key_last_validated'
    )
    .eq('guild_code', profile.guild_code ?? '')
    .single()

  if (error || !guildConfig) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">
          {error?.message ?? 'Guild configuration not found'}
        </p>
      </div>
    )
  }

  // Members get zero rows from the RPC, so the owner label is omitted.
  const { data: keyInfo } = await supabase
    .rpc('get_guild_api_key_info', { p_guild_code: profile.guild_code ?? '' })
    .maybeSingle()

  const config: GuildConfig = {
    ...guildConfig,
    API_Owner: keyInfo?.api_owner ?? null,
    has_api_key: guildConfig.api_key_is_valid != null
  }

  // Mirrors requireGuildCredentialAuthority (lowercase-only) so members never see a Remove that 403s.
  const canRemove = profile.role === 'officer' || profile.role === 'leader'

  return <ApiKeyManagementClient initialConfig={config} canRemove={canRemove} />
}
