'use client'

import { useEffect, useState } from 'react'
import { Input } from '@tacticus/ui-kit'
import { Label } from '@tacticus/ui-kit'
import { Globe, Hash, FileText, Link, Tag } from 'lucide-react'
import { SettingsSection } from './SettingsSection'
import { FormRow } from '@/app/components/ui'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'

const logger = createComponentLogger('guild-management.identity-settings')

interface IdentitySettingsPanelProps {
  guildCode: string
  displayName: string
  tagline: string
  onTaglineChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  discordInvite: string
  onDiscordInviteChange: (value: string) => void
  website: string
  onWebsiteChange: (value: string) => void
  twitter: string
  onTwitterChange: (value: string) => void
  saving: boolean
}

export function IdentitySettingsPanel({
  guildCode,
  displayName,
  tagline,
  onTaglineChange,
  description,
  onDescriptionChange,
  discordInvite,
  onDiscordInviteChange,
  website,
  onWebsiteChange,
  twitter,
  onTwitterChange,
  saving
}: IdentitySettingsPanelProps) {
  const [guildTag, setGuildTag] = useState<string>('')
  const [loadingTag, setLoadingTag] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false

    const loadGuildTag = async () => {
      setLoadingTag(true)
      try {
        const supabase = dbClient()
        const { data, error } = await supabase
          .from('guild_config')
          .select('guild_tag')
          .eq('guild_code', guildCode)
          .maybeSingle()

        if (!cancelled) {
          if (error) {
            logger.warn('Failed to fetch guild tag')
            setGuildTag('')
          } else {
            setGuildTag(data?.guild_tag ?? '')
          }
        }
      } catch {
        if (!cancelled) {
          logger.warn('Unexpected error fetching guild tag')
          setGuildTag('')
        }
      } finally {
        if (!cancelled) {
          setLoadingTag(false)
        }
      }
    }

    if (guildCode) {
      loadGuildTag()
    } else {
      setGuildTag('')
    }

    return () => {
      cancelled = true
    }
  }, [guildCode])

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Guild Identity"
        description="Keep your Tacticus Analytics dossier accurate. These details appear anywhere your guild is referenced across the platform."
        icon={Globe}
        tone="accent"
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="displayName">Guild Name</Label>
            <Input
              id="displayName"
              value={displayName}
              className="bg-(--bg-secondary) opacity-60 cursor-not-allowed"
              disabled
              readOnly
            />
            <p className="text-xs text-(--text-tertiary)">
              Game-synced. Use tagline & description to add your own war cry.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="guildTag">
              <Tag className="w-3 h-3 inline mr-1" />
              Guild Tag
            </Label>
            <Input
              id="guildTag"
              value={guildTag || ''}
              disabled
              readOnly
              className="font-mono bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)]"
              placeholder={loadingTag ? 'Loading...' : 'Not assigned'}
            />
            <p className="text-xs text-(--text-tertiary)">
              Searchable identifier players use to find your guild in Tacticus.
            </p>
          </div>
        </div>
        <FormRow
          label={
            <span className="inline-flex items-center gap-1">
              <Hash className="w-3 h-3" /> Tagline
            </span>
          }
          htmlFor="tagline"
          helper={`${tagline.length}/100 characters`}
        >
          {({ describedBy }) => (
            <Input
              id="tagline"
              value={tagline}
              onChange={(event) => onTaglineChange(event.target.value)}
              placeholder="The spear tip of the Long War."
              maxLength={100}
              disabled={saving}
              aria-describedby={describedBy}
            />
          )}
        </FormRow>
        <FormRow
          label={
            <span className="inline-flex items-center gap-1">
              <FileText className="w-3 h-3" /> Guild Description
            </span>
          }
          htmlFor="description"
          helper={`${description.length}/500 characters`}
        >
          {({ describedBy }) => (
            <textarea
              id="description"
              value={description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              className="w-full rounded-2xl border border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] px-4 py-3 text-primary-wh40k placeholder:text-(--text-tertiary) focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Describe your warband, doctrine, and expectations."
              rows={4}
              maxLength={500}
              disabled={saving}
              aria-describedby={describedBy}
            />
          )}
        </FormRow>
      </SettingsSection>
      <SettingsSection
        title="Signal Boosters"
        description="Link outposts and rally points so members can find your warband."
        icon={Link}
      >
        <FormRow label="Discord Invite" htmlFor="discordInvite">
          <Input
            id="discordInvite"
            type="url"
            value={discordInvite}
            onChange={(event) => onDiscordInviteChange(event.target.value)}
            placeholder="https://discord.gg/your-warband"
            disabled={saving}
            className="rounded-2xl"
          />
        </FormRow>
        <FormRow label="Website" htmlFor="website">
          <Input
            id="website"
            type="url"
            value={website}
            onChange={(event) => onWebsiteChange(event.target.value)}
            placeholder="https://your-faction.io"
            disabled={saving}
            className="rounded-2xl"
          />
        </FormRow>
        <FormRow label="Twitter / X" htmlFor="twitter">
          <Input
            id="twitter"
            type="url"
            value={twitter}
            onChange={(event) => onTwitterChange(event.target.value)}
            placeholder="https://twitter.com/warband"
            disabled={saving}
            className="rounded-2xl"
          />
        </FormRow>
      </SettingsSection>
    </div>
  )
}
