import { requireRole } from '@/app/lib/auth'
import GuildSettingsClient from './GuildSettingsClient'
import {
  fetchGuildSettings,
  createDefaultGuildSettings
} from '@/app/lib/services/guild-settings-service'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { createPageMetadata } from '@/app/lib/metadata'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('guild-management.settings')

export const metadata = createPageMetadata({
  title: 'Guild Settings',
  description:
    'Configure guild identity, privacy, integrations, and raid management settings.',
  path: '/guild-management/settings'
})

export default async function GuildSettingsPage() {
  const { user, profile } = await requireRole('officer') // Officers can edit guild settings
  const proactiveTokenManagementAccess = await checkFeatureAccess(
    user.id,
    'proactive_token_management'
  )

  let guildConfig

  try {
    guildConfig = await fetchGuildSettings(profile.guild_code ?? '')
  } catch (error) {
    logger.error(
      {
        guildCode: profile.guild_code,
        err: error,
        userId: user.id
      },
      'Guild settings fetch failed'
    )

    if (
      error instanceof Error &&
      error.message.includes('not found in database')
    ) {
      try {
        const guildName =
          (profile as { guild_name?: string | null }).guild_name ??
          profile.guild_code
        guildConfig = await createDefaultGuildSettings(
          profile.guild_code ?? '',
          guildName ?? ''
        )
      } catch (createError) {
        console.error('Failed to create default guild settings:', createError)
        const message =
          createError instanceof Error
            ? createError.message
            : 'Failed to create guild configuration'
        return (
          <div className="text-center py-12 space-y-4">
            <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-6 max-w-md mx-auto">
              <h2 className="text-lg font-semibold text-red-400 mb-2">
                Configuration Error
              </h2>
              <p className="text-red-300 mb-4">{message}</p>
              <div className="text-sm text-secondary-wh40k">
                <p>
                  Guild:{' '}
                  <code className="bg-(--card-bg) px-2 py-1 rounded-sm">
                    {formatGuildDisplayLabel(null, profile.guild_code)}
                  </code>
                </p>
                <p className="mt-2">
                  Could not create or find guild settings. Please contact
                  support.
                </p>
              </div>
            </div>
          </div>
        )
      }
    } else {
      const message =
        error instanceof Error ? error.message : 'Guild configuration error'
      return (
        <div className="text-center py-12 space-y-4">
          <div className="rounded-lg border border-red-400/20 bg-red-500/10 p-6 max-w-md mx-auto">
            <h2 className="text-lg font-semibold text-red-400 mb-2">
              Configuration Error
            </h2>
            <p className="text-red-300 mb-4">{message}</p>
            <div className="text-sm text-secondary-wh40k">
              <p>
                Guild:{' '}
                <code className="bg-(--card-bg) px-2 py-1 rounded-sm">
                  {formatGuildDisplayLabel(null, profile.guild_code)}
                </code>
              </p>
              <p className="mt-2">
                If this error persists, please contact support with the guild
                name above.
              </p>
            </div>
          </div>
        </div>
      )
    }
  }

  return (
    <div className="w-full">
      <GuildSettingsClient
        initialConfig={guildConfig}
        userRole={profile.role}
        currentUserDisplayName={profile.display_name ?? user.email ?? null}
        isAppAdmin={profile.is_app_admin === true}
        proactiveTokenManagementEnabled={
          proactiveTokenManagementAccess.has_access
        }
      />
    </div>
  )
}
