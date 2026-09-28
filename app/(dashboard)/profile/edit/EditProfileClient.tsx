'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getUserAvatar } from '@/app/lib/utils/avatar'
import { dbClient } from '@/app/lib/db/client'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { validateUrl } from '@/app/lib/validation/auth'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('profile.edit.EditProfileClient')
import {
  RadixSelect,
  RadixSelectTrigger,
  RadixSelectContent,
  RadixSelectItem,
  RadixSelectValue
} from '@tacticus/ui-kit/radix-select'
import {
  RadixTooltip,
  RadixTooltipTrigger,
  RadixTooltipContent
} from '@tacticus/ui-kit/radix-tooltip'
import { StatusLabel } from '@tacticus/ui-kit'
import { useTheme } from '@/app/components/ThemeProvider'
import { featureFlags } from '@/app/lib/utils/feature-flags'
import { TACTICUS_API } from '@tacticus/app-core/app-config'
import { EditProfileCoreFields } from './EditProfileCoreFields'
import { EditProfileApiKeySection } from './EditProfileApiKeySection'
import { EditProfilePlayerIdSection } from './EditProfilePlayerIdSection'

interface EditProfileClientProps {
  userId: string
  hasDiscordLinked: boolean
  initialProfile: {
    player_id: string
    display_name: string
    guild_code: string
    timezone?: string
    discord_username?: string
    tacticus_share_url?: string
    theme_preference?: string
    primary_team?: string
    secondary_team?: string
    tertiary_team?: string
    has_api_key?: boolean
    api_key_is_valid?: boolean
    api_key_last_verified?: string
    avatar_url?: string
  }
  teamOptions: string[]
}

type ProfileUpdatePayload = {
  timezone?: string
  tacticus_share_url?: string
  theme_preference?: string
  primary_team?: string | null
  secondary_team?: string | null
  tertiary_team?: string | null
  discord_username?: string
}

export default function EditProfileClient({
  userId,
  hasDiscordLinked,
  initialProfile,
  teamOptions
}: EditProfileClientProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const { setTheme: applyTheme } = useTheme() // Get the setTheme function from ThemeProvider

  const displayName = initialProfile.display_name || ''
  const [timezone, setTimezone] = useState(initialProfile.timezone || '')
  const [discordUsername, setDiscordUsername] = useState(
    initialProfile.discord_username || ''
  )
  const [tacticusShareUrl, setTacticusShareUrl] = useState(
    initialProfile.tacticus_share_url || ''
  )

  const isDiscordUsernameControlled =
    featureFlags.discordAuth && hasDiscordLinked
  const [themePreference, setThemePreference] = useState(
    initialProfile.theme_preference || 'guild'
  )

  const [apiKey, setApiKey] = useState('')
  const [hasExistingApiKey, setHasExistingApiKey] = useState(
    !!initialProfile.has_api_key
  )
  const [apiKeyIsValid, setApiKeyIsValid] = useState(
    initialProfile.api_key_is_valid || false
  )
  const [apiKeyLastVerified, setApiKeyLastVerified] = useState(
    initialProfile.api_key_last_verified || ''
  )
  const [savingApiKey, setSavingApiKey] = useState(false)
  const tacticusSite = `${TACTICUS_API.ORIGIN}/`
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [apiKeySuccess, setApiKeySuccess] = useState<string | null>(null)

  // Changing player ID needs the new account's API key as proof, separate from `apiKey`.
  const [showPlayerIdChange, setShowPlayerIdChange] = useState(false)
  const [newPlayerId, setNewPlayerId] = useState('')
  const [newAccountApiKey, setNewAccountApiKey] = useState('')
  const [savingPlayerId, setSavingPlayerId] = useState(false)
  const [playerIdError, setPlayerIdError] = useState<string | null>(null)
  const [playerIdSuccess, setPlayerIdSuccess] = useState<string | null>(null)

  const [primaryTeam, setPrimaryTeam] = useState(
    initialProfile.primary_team || ''
  )
  const [secondaryTeam, setSecondaryTeam] = useState(
    initialProfile.secondary_team || ''
  )
  const [tertiaryTeam, setTertiaryTeam] = useState(
    initialProfile.tertiary_team || ''
  )

  const handleApiKeySubmit = async () => {
    setApiKeyError(null)
    setApiKeySuccess(null)

    if (!apiKey.trim()) {
      setApiKeyError('Please enter an API key')
      return
    }

    try {
      setSavingApiKey(true)

      const response = await fetch('/api/player-api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ apiKey: apiKey.trim() })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Failed to save API key'))
      }

      setApiKeySuccess(data.message || 'API key saved successfully!')
      setHasExistingApiKey(true)
      setApiKeyIsValid(true)
      setApiKeyLastVerified(new Date().toISOString())
      setApiKey('') // Clear the input field

      setTimeout(() => {
        router.refresh()
      }, 1500)
    } catch (err) {
      setApiKeyError(
        err instanceof Error ? err.message : 'Failed to save API key'
      )
    } finally {
      setSavingApiKey(false)
    }
  }

  const handleApiKeyRemove = async () => {
    setApiKeyError(null)
    setApiKeySuccess(null)

    try {
      setSavingApiKey(true)

      const response = await fetch('/api/player-api-key', {
        method: 'DELETE'
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Failed to remove API key'))
      }

      setApiKeySuccess(data.message || 'API key removed successfully')
      setHasExistingApiKey(false)
      setApiKeyIsValid(false)
      setApiKeyLastVerified('')

      setTimeout(() => {
        router.refresh()
      }, 1500)
    } catch (err) {
      setApiKeyError(
        err instanceof Error ? err.message : 'Failed to remove API key'
      )
    } finally {
      setSavingApiKey(false)
    }
  }

  const handlePlayerIdChange = async () => {
    setPlayerIdError(null)
    setPlayerIdSuccess(null)

    if (!newPlayerId.trim()) {
      setPlayerIdError('Please enter a Player ID')
      return
    }

    if (!newAccountApiKey.trim()) {
      setPlayerIdError(
        "Please enter an API key created on the new account with Guild scope — it's how we verify the account is yours."
      )
      return
    }

    try {
      setSavingPlayerId(true)

      const response = await fetch('/api/profile/change-player-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPlayerId: newPlayerId.trim(),
          apiKey: newAccountApiKey.trim()
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(extractErrorMessage(data, 'Failed to change Player ID'))
      }

      setPlayerIdSuccess(data.message)
      setNewPlayerId('')
      setNewAccountApiKey('')
      setShowPlayerIdChange(false)

      if (data.status !== 'unchanged' && data.apiKeyStored === true) {
        // The key became the profile's credential; sync the API-key status card.
        setHasExistingApiKey(true)
        setApiKeyIsValid(true)
        setApiKeyLastVerified(new Date().toISOString())
      }

      if (data.status === 'inactive') {
        setTimeout(() => {
          router.push('/home')
        }, 2000)
      } else {
        setTimeout(() => {
          router.refresh()
        }, 1500)
      }
    } catch (err) {
      setPlayerIdError(
        err instanceof Error ? err.message : 'Failed to change Player ID'
      )
    } finally {
      setSavingPlayerId(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    // Display name is read-only.

    if (tacticusShareUrl && !validateUrl(tacticusShareUrl)) {
      const enhancedError = createError(
        'PROFILE_VALIDATION_FAILED',
        'Invalid URL format for Tacticus share URL',
        {
          component: 'EditProfileClient',
          action: 'validate_url',
          url: tacticusShareUrl
        }
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
      return
    }

    try {
      setSaving(true)
      const supabase = dbClient()

      if (
        themePreference &&
        themePreference !== initialProfile.theme_preference
      ) {
        const themeResult = await applyTheme(themePreference)
        if (!themeResult.success) {
          logger.warn({ data: themeResult.error }, 'Theme application warning:')
        }
      }

      const updateData: ProfileUpdatePayload = {
        timezone: timezone || undefined,
        tacticus_share_url: tacticusShareUrl || undefined,
        theme_preference: themePreference || undefined,
        primary_team: primaryTeam || null,
        secondary_team: secondaryTeam || null,
        tertiary_team: tertiaryTeam || null
      }

      if (!isDiscordUsernameControlled) {
        updateData.discord_username = discordUsername || undefined
      }

      const { error } = await supabase
        .from(CURRENT_USER_PLAYER_MAPPING)
        .update(updateData)
        .eq('user_id', userId)
        .eq('is_current', true)

      if (error) throw error

      setSuccess(true)
      setTimeout(() => {
        router.push('/profile')
        router.refresh()
      }, 1500)
    } catch (err) {
      const enhancedError = createError(
        'PROFILE_UPDATE_FAILED',
        err instanceof Error ? err.message : 'Failed to update profile',
        { component: 'EditProfileClient', action: 'update_profile', userId },
        err
      )
      const userError = formatErrorForUser(enhancedError)
      setError(userError.displayMessage)
    } finally {
      setSaving(false)
    }
  }

  const avatarUrl =
    initialProfile.avatar_url ||
    getUserAvatar(
      displayName || initialProfile.display_name || 'User',
      initialProfile.guild_code || 'GLOBAL',
      100
    )

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-primary-wh40k">
        Edit Profile
      </h1>

      <form
        method="post"
        onSubmit={handleSubmit}
        className="card-wh40k p-6 space-y-6"
      >
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
            <StatusLabel type="error">
              <LinkifiedText text={error} />
            </StatusLabel>
          </div>
        )}

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-md p-3">
            <p className="text-sm text-emerald-400">
              Profile updated successfully! Redirecting...
            </p>
          </div>
        )}

        <EditProfileCoreFields
          avatarUrl={avatarUrl}
          displayName={displayName}
          saving={saving}
          timezone={timezone}
          setTimezone={setTimezone}
          discordUsername={discordUsername}
          setDiscordUsername={setDiscordUsername}
          isDiscordUsernameControlled={isDiscordUsernameControlled}
          tacticusShareUrl={tacticusShareUrl}
          setTacticusShareUrl={setTacticusShareUrl}
          themePreference={themePreference}
          setThemePreference={setThemePreference}
          applyTheme={applyTheme}
        />

        {/* API Key Section */}
        <EditProfileApiKeySection
          hasExistingApiKey={hasExistingApiKey}
          apiKeyIsValid={apiKeyIsValid}
          apiKeyLastVerified={apiKeyLastVerified}
          savingApiKey={savingApiKey}
          apiKey={apiKey}
          setApiKey={setApiKey}
          handleApiKeySubmit={handleApiKeySubmit}
          handleApiKeyRemove={handleApiKeyRemove}
          apiKeyError={apiKeyError}
          apiKeySuccess={apiKeySuccess}
          tacticusSite={tacticusSite}
        />

        {/* Change Player ID Section */}
        <EditProfilePlayerIdSection
          initialProfile={initialProfile}
          showPlayerIdChange={showPlayerIdChange}
          setShowPlayerIdChange={setShowPlayerIdChange}
          newPlayerId={newPlayerId}
          setNewPlayerId={setNewPlayerId}
          newAccountApiKey={newAccountApiKey}
          setNewAccountApiKey={setNewAccountApiKey}
          savingPlayerId={savingPlayerId}
          handlePlayerIdChange={handlePlayerIdChange}
          playerIdError={playerIdError}
          setPlayerIdError={setPlayerIdError}
          playerIdSuccess={playerIdSuccess}
        />

        {/* Meta Team Preferences with Radix Select */}
        <div className="mt-6">
          <h3 className="text-lg font-medium text-primary-wh40k mb-4">
            Meta Team Preferences
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <RadixTooltip>
                <RadixTooltipTrigger asChild>
                  <label
                    htmlFor="primaryTeam"
                    className="block text-sm font-medium text-secondary-wh40k mb-1"
                  >
                    Primary Team
                  </label>
                </RadixTooltipTrigger>
                <RadixTooltipContent>
                  <p className="text-xs">
                    Your most preferred team composition
                  </p>
                </RadixTooltipContent>
              </RadixTooltip>
              <RadixSelect
                value={primaryTeam}
                onValueChange={setPrimaryTeam}
                disabled={saving}
              >
                <RadixSelectTrigger className="w-full">
                  <RadixSelectValue placeholder="Select team..." />
                </RadixSelectTrigger>
                <RadixSelectContent>
                  {teamOptions.map((team) => (
                    <RadixSelectItem
                      key={team}
                      value={team}
                      disabled={team === secondaryTeam || team === tertiaryTeam}
                    >
                      {team}
                    </RadixSelectItem>
                  ))}
                </RadixSelectContent>
              </RadixSelect>
            </div>

            <div>
              <RadixTooltip>
                <RadixTooltipTrigger asChild>
                  <label
                    htmlFor="secondaryTeam"
                    className="block text-sm font-medium text-secondary-wh40k mb-1"
                  >
                    Secondary Team
                  </label>
                </RadixTooltipTrigger>
                <RadixTooltipContent>
                  <p className="text-xs">Your second choice team composition</p>
                </RadixTooltipContent>
              </RadixTooltip>
              <RadixSelect
                value={secondaryTeam}
                onValueChange={setSecondaryTeam}
                disabled={saving}
              >
                <RadixSelectTrigger className="w-full">
                  <RadixSelectValue placeholder="Select team..." />
                </RadixSelectTrigger>
                <RadixSelectContent>
                  {teamOptions.map((team) => (
                    <RadixSelectItem
                      key={team}
                      value={team}
                      disabled={team === primaryTeam || team === tertiaryTeam}
                    >
                      {team}
                    </RadixSelectItem>
                  ))}
                </RadixSelectContent>
              </RadixSelect>
            </div>

            <div>
              <RadixTooltip>
                <RadixTooltipTrigger asChild>
                  <label
                    htmlFor="tertiaryTeam"
                    className="block text-sm font-medium text-secondary-wh40k mb-1"
                  >
                    Tertiary Team
                  </label>
                </RadixTooltipTrigger>
                <RadixTooltipContent>
                  <p className="text-xs">Your third choice team composition</p>
                </RadixTooltipContent>
              </RadixTooltip>
              <RadixSelect
                value={tertiaryTeam}
                onValueChange={setTertiaryTeam}
                disabled={saving}
              >
                <RadixSelectTrigger className="w-full">
                  <RadixSelectValue placeholder="Select team..." />
                </RadixSelectTrigger>
                <RadixSelectContent>
                  {teamOptions.map((team) => (
                    <RadixSelectItem
                      key={team}
                      value={team}
                      disabled={team === primaryTeam || team === secondaryTeam}
                    >
                      {team}
                    </RadixSelectItem>
                  ))}
                </RadixSelectContent>
              </RadixSelect>
            </div>
          </div>
          <p className="mt-2 text-xs text-secondary-wh40k">
            Select your preferred meta teams in order of preference. Each team
            can only be selected once.
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-(--card-border)">
          <button
            type="button"
            onClick={() => router.push('/profile')}
            className="btn-wh40k"
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-accent-wh40k" disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
