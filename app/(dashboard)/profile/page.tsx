import Link from 'next/link'
import Image from 'next/image'
import { requireAuth } from '@/app/lib/auth'
import { labelForMember } from '@/app/lib/member-labels-server'
import { db } from '@/app/lib/db'
import {
  getUserAvatar,
  resolveAvatarFrameMap,
  resolvePlayerAvatar
} from '@/app/lib/utils/avatar'
import {
  getRoleDisplayName,
  getRoleBadgeColor
} from '@/app/lib/auth/permissions'
import DeleteAccountButton from './DeleteAccountButton'
import RequestMyDataButton from './RequestMyDataButton'
import BossFavorites from '@/app/components/BossFavorites'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { MetaTeamMembership } from './MetaTeamMembership'
import ThemePreviewPanel from '@/app/components/ThemePreviewPanel'
import OAuthAccountLink from '@/app/components/auth/OAuthAccountLink'
import { featureFlags } from '@/app/lib/utils/feature-flags'
import LinkRequiredNudge from '@/app/components/auth/LinkRequiredNudge'
import { WinterThemeSection } from './WinterThemeSection'
import { BossEasterEggSection } from './BossEasterEggSection'
import { TokenAlertSettings } from './TokenAlertSettings'
import { ClientDate } from '@tacticus/ui-kit'
import { ReweaveLink } from './ReweaveLink'
import { LifetimeStats } from './LifetimeStats'
import { MentionsReceivedChart } from './MentionsReceivedChart'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Profile',
  description:
    'Review your Tacticus Analytics profile, linked accounts, guild identity, and personal settings.',
  path: '/profile'
})

// Placeholder fields not yet in the database.
interface ExtendedProfile {
  primary_team?: string
  secondary_team?: string
  tertiary_team?: string
}

interface ProfilePageProps {
  searchParams?: Promise<{
    linkRequired?: string
    redirectTo?: string
  }>
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const supabase = await db()
  const { user, profile } = await requireAuth(supabase)
  const { data: onboardingState, error: onboardingStateError } =
    await supabase.rpc('get_my_onboarding_state')
  const hasApiKey =
    !onboardingStateError && onboardingState?.[0]?.api_key_configured === true

  const extendedProfile = profile as typeof profile & ExtendedProfile

  const discordUsername = profile.discord_username || null
  const discordUserId = profile.discord_user_id || null
  const hasDiscordLinked = Boolean(discordUserId)
  // Google linking status refreshes client-side in OAuthAccountLink.
  const hasGoogleLinked = false
  const googleDisplayName = null
  const linkRequiredParam = resolvedSearchParams?.linkRequired
  const redirectAfterLinkParam = resolvedSearchParams?.redirectTo
  const linkRequired =
    linkRequiredParam === 'discord' &&
    featureFlags.requireDiscordLink &&
    !hasDiscordLinked
  const redirectAfterLink = redirectAfterLinkParam
  const isOAuthEnabled = featureFlags.discordAuth || featureFlags.googleAuth

  const displayName =
    profile.display_name || user.email?.split('@')[0] || 'User'
  // Display label only; the raw `displayName` stays the avatar seed / playerName key.
  const displayLabel = profile.display_name
    ? await labelForMember(profile.display_name)
    : displayName
  const guildCode = profile.guild_code || 'No Guild'
  const defaultAvatarUrl = getUserAvatar(displayName, guildCode, 100)

  // Friendly guild label (display_name → guild_tag → fallback), never the raw UUID.
  let guildDisplayLabel: string = profile.guild_code ? '' : 'No Guild'
  if (profile.guild_code) {
    try {
      const { data: guildConfig } = await supabase
        .from('guild_config')
        .select('display_name, guild_tag, guild_code')
        .eq('guild_code', profile.guild_code)
        .maybeSingle()
      guildDisplayLabel = formatGuildDisplayLabel(
        guildConfig ?? null,
        profile.guild_code
      )
    } catch {
      guildDisplayLabel = formatGuildDisplayLabel(null, profile.guild_code)
    }
  }

  let avatarUrl = defaultAvatarUrl
  if (user.id) {
    try {
      const { data: playerMapping } = await supabase
        .from(CURRENT_USER_PLAYER_MAPPING)
        .select('avatar_unit_id')
        .eq('user_id', user.id)
        .eq('is_current', true)
        .single()

      const avatarUnitId = playerMapping?.avatar_unit_id
      if (avatarUnitId) {
        const frameMap = await resolveAvatarFrameMap(supabase, avatarUnitId)

        // No datamine fallback: the <Image> has no onError, so a 404 would show a broken image.
        avatarUrl = resolvePlayerAvatar({
          avatarUnitId,
          playerName: displayName,
          guildCode,
          size: 100,
          frameMap,
          datamineFallback: false
        })
      }
    } catch {
      // Fall back to the default avatar.
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <LinkRequiredNudge active={linkRequired} />

      <h1 className="text-3xl font-bold mb-8 text-primary-wh40k">My Profile</h1>

      {linkRequired && (
        <div className="mb-6 p-4 border border-red-500/40 rounded-lg bg-red-500/10 text-sm text-red-100">
          <p className="font-semibold">Discord link required to continue.</p>
          <p className="mt-1 text-red-200">
            Connect your Discord account below to regain access. You&apos;ll
            return to {redirectAfterLink || '/home'} after linking.
          </p>
          <a
            href="#connected-accounts"
            className="inline-flex mt-3 px-3 py-1.5 text-xs font-semibold rounded-md bg-red-500 text-white hover:bg-red-400 transition-colors"
          >
            Jump to Discord linking
          </a>
        </div>
      )}

      <div className="card-wh40k p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:space-x-6">
          {/* Avatar */}
          <div className="shrink-0 mx-auto sm:mx-0 mb-4 sm:mb-0">
            <Image
              src={avatarUrl}
              alt="Profile"
              width={96}
              height={96}
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full"
              unoptimized
            />
          </div>

          {/* Profile Info */}
          <div className="flex-1 w-full">
            <div className="text-center sm:text-left">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-wh40k">
                {displayLabel}
              </h2>

              <div className="mt-2 flex flex-wrap justify-center sm:justify-start items-center gap-2 sm:gap-4">
                {/* Role Badge */}
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-primary-wh40k ${getRoleBadgeColor(profile.role)}`}
                >
                  {getRoleDisplayName(profile.role)}
                </span>

                {/* Guild */}
                <span className="text-sm text-secondary-wh40k">
                  Guild:{' '}
                  <span className="font-medium text-accent-wh40k">
                    {guildDisplayLabel ||
                      formatGuildDisplayLabel(null, guildCode)}
                  </span>
                </span>
              </div>

              {/* Discord handle binding */}
              <div className="mt-3">
                {discordUsername ? (
                  <p className="text-sm text-secondary-wh40k">
                    Known on Discord as{' '}
                    <span className="font-semibold text-primary-wh40k">
                      {discordUsername}
                    </span>
                  </p>
                ) : (
                  <a
                    href="#connected-accounts"
                    className="inline-flex items-center gap-1.5 text-sm text-(--accent) hover:text-(--primary) transition-colors"
                  >
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                    </svg>
                    Link your Discord account
                  </a>
                )}
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4 sm:gap-y-6">
              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                  Email
                </dt>
                <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k break-all">
                  {user.email}
                </dd>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                  Display Name
                </dt>
                <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k">
                  {displayLabel}
                  <span className="ml-2 text-xs text-secondary-wh40k">
                    (from game)
                  </span>
                </dd>
              </div>

              <div>
                <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                  Player ID
                </dt>
                <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k">
                  {profile.player_id || 'Not set'}
                </dd>
              </div>

              <div>
                <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                  Member Since
                </dt>
                <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k">
                  {profile.created_at ? (
                    <ClientDate date={profile.created_at} format="date" />
                  ) : (
                    'Unknown'
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                  Status
                </dt>
                <dd className="mt-1">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-(--success-bg) text-(--success) border border-(--success-border)">
                    Active
                  </span>
                </dd>
              </div>

              {profile.timezone && (
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                    Timezone
                  </dt>
                  <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k">
                    {profile.timezone}
                  </dd>
                </div>
              )}

              {profile.tacticus_share_url && (
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                    Tacticus Profile
                  </dt>
                  <dd className="mt-1 text-xs sm:text-sm">
                    <a
                      href={profile.tacticus_share_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-(--accent) hover:text-(--primary) underline"
                    >
                      View Profile
                    </a>
                  </dd>
                </div>
              )}

              {profile.theme_preference && (
                <div>
                  <dt className="text-xs sm:text-sm font-medium text-secondary-wh40k">
                    Theme Preference
                  </dt>
                  <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k">
                    {profile.theme_preference === 'guild' && 'Guild Theme'}
                    {profile.theme_preference === 'light' && 'Light Theme'}
                    {profile.theme_preference === 'dark' && 'Dark Theme'}
                    {profile.theme_preference === 'horus_heresy' &&
                      'Horus Heresy Theme'}
                  </dd>
                </div>
              )}
            </dl>

            {/* Meta Team Preferences Section */}
            {(extendedProfile?.primary_team ||
              extendedProfile?.secondary_team ||
              extendedProfile?.tertiary_team) && (
              <div className="mt-6 pt-6 border-t border-(--card-border)">
                <h3 className="text-sm font-medium text-secondary-wh40k mb-3">
                  Meta Team Preferences
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
                  {extendedProfile?.primary_team && (
                    <div>
                      <dt className="text-xs font-medium text-secondary-wh40k">
                        Primary Team
                      </dt>
                      <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k font-medium">
                        {extendedProfile.primary_team}
                      </dd>
                    </div>
                  )}
                  {extendedProfile?.secondary_team && (
                    <div>
                      <dt className="text-xs font-medium text-secondary-wh40k">
                        Secondary Team
                      </dt>
                      <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k font-medium">
                        {extendedProfile.secondary_team}
                      </dd>
                    </div>
                  )}
                  {extendedProfile?.tertiary_team && (
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="text-xs font-medium text-secondary-wh40k">
                        Tertiary Team
                      </dt>
                      <dd className="mt-1 text-xs sm:text-sm text-primary-wh40k font-medium">
                        {extendedProfile.tertiary_team}
                      </dd>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex space-x-3">
          <Link href="/profile/edit" className="btn-wh40k inline-block">
            Edit Profile
          </Link>
          <Link
            href="/profile/change-password"
            className="btn-wh40k inline-block"
          >
            Change Password
          </Link>
        </div>
      </div>

      {/* Lifetime Stats */}
      <div className="mt-8 card-wh40k p-6">
        <h2 className="text-lg font-semibold text-primary-wh40k mb-4">
          Lifetime Stats
        </h2>
        <LifetimeStats />
      </div>

      {/* Mentions Received (last 7 days) */}
      <div className="mt-8 card-wh40k p-6">
        <h2 className="text-lg font-semibold text-primary-wh40k mb-4">
          Mentions Received
          <span className="ml-2 text-xs font-normal text-secondary-wh40k">
            last 7 days
          </span>
        </h2>
        <MentionsReceivedChart />
      </div>

      {/* API key section. Its id is the "My API Key" nav target; renaming breaks the link. */}
      <div id="api-key" className="mt-8 card-wh40k p-6 scroll-mt-24">
        <h2 className="text-lg font-semibold text-primary-wh40k mb-4">
          Tacticus API Key
        </h2>
        <ReweaveLink
          hasKey={hasApiKey}
          lastVerified={profile.api_key_last_verified ?? null}
        />
      </div>

      {/* Theme Preview */}
      <div className="mt-8 card-wh40k p-6">
        <ThemePreviewPanel
          currentTheme={
            profile.theme_preference || profile.guild_code || 'dark'
          }
        />
      </div>

      {/* Winter Theme Settings */}
      <WinterThemeSection />

      {/* Boss Easter Egg Settings */}
      <BossEasterEggSection />

      {/* Connected Accounts */}
      {isOAuthEnabled && (
        <div id="connected-accounts" className="mt-8 card-wh40k p-6">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-primary-wh40k">
                Connected Accounts
              </h2>
              <p className="text-sm text-secondary-wh40k">
                Link Discord (required) and optionally Google for faster
                sign-ins.
              </p>
            </div>
            {linkRequired && (
              <span className="inline-flex items-center rounded-md bg-red-500/10 px-3 py-1 text-xs font-medium text-red-300 border border-red-500/30">
                Discord link required
              </span>
            )}
          </div>

          {linkRequired && (
            <div className="mb-4 p-4 border border-red-500/30 rounded-lg bg-red-500/5 text-sm text-red-100">
              <p className="font-semibold">
                You need to connect Discord to continue.
              </p>
              <p className="mt-1 text-red-200">
                Connect your Discord account below. You&apos;ll be returned to{' '}
                {redirectAfterLink || '/home'} once linked.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {featureFlags.discordAuth && (
              <OAuthAccountLink
                provider="discord"
                isLinked={hasDiscordLinked}
                displayName={discordUsername}
                profileRedirect={redirectAfterLink || '/home'}
              />
            )}
            {featureFlags.googleAuth && (
              <OAuthAccountLink
                provider="google"
                isLinked={hasGoogleLinked}
                displayName={googleDisplayName}
                profileRedirect={redirectAfterLink || '/home'}
              />
            )}
          </div>
        </div>
      )}

      {/* Token alert DMs; renders null when unavailable. */}
      <div className="mt-8">
        <TokenAlertSettings />
      </div>

      {/* Boss Preferences */}
      <div className="mt-8">
        <BossFavorites
          playerId={profile.player_id}
          guildCode={profile.guild_code ?? ''}
        />
      </div>

      {/* Meta team membership (self-service) */}
      <div className="mt-8">
        <MetaTeamMembership
          userId={user.id}
          guildCode={profile.guild_code ?? null}
        />
      </div>

      {/* Privacy & Data Rights */}
      <div className="mt-8 card-wh40k p-6 border-blue-500/30">
        <h2 className="text-lg font-semibold text-blue-300 mb-4">
          Privacy & Data Rights
        </h2>
        <p className="text-sm text-secondary-wh40k mb-4">
          Under GDPR and other privacy laws, you have the right to request a
          copy of your personal data (Article 15) and to delete your account
          (Article 17). See{' '}
          <Link href="/privacy-rights" className="text-(--accent) underline">
            Your Privacy Rights
          </Link>{' '}
          for details.
        </p>
        <RequestMyDataButton />
      </div>

      {/* Danger Zone */}
      <div className="mt-8 card-wh40k p-6 border-red-500/30">
        <h2 className="text-lg font-semibold text-red-400 mb-4">Danger Zone</h2>
        <p className="text-sm text-secondary-wh40k mb-4">
          Once you delete your account, there is no going back. Please be
          certain.
        </p>
        <DeleteAccountButton userId={user.id} />
      </div>
    </div>
  )
}
