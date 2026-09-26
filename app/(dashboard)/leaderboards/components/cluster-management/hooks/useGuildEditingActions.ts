'use client'

import { useState } from 'react'
import type { Database } from '@tacticus/app-core/types'

import { dbClient } from '@/app/lib/db/client'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { createComponentLogger } from '@/app/lib/logging/client'
import type { Guild } from '../types'
import { extractErrorMessage } from './useClusterData'

const logger = createComponentLogger(
  'leaderboards.cluster-management.useGuildEditingActions'
)
type GuildConfigUpdate = Database['public']['Tables']['guild_config']['Update']

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
}

interface Options {
  guilds: Guild[]
  currentUserDisplayName: string | null
  setGuilds: React.Dispatch<React.SetStateAction<Guild[]>>
  fetchGuilds: () => Promise<void>
  toast: ToastApi
}

function getGuildApiKeyStatus(guild: Guild) {
  if (!guild.has_api_key) {
    return { text: 'Not set', color: 'text-[var(--text-secondary)]' }
  }
  if (guild.guild_code === 'TEST') {
    return { text: 'Test Key', color: 'text-[var(--accent)]' }
  }
  if (guild.api_key_is_valid === true) {
    return { text: 'Valid', color: 'text-green-400' }
  }
  if (guild.api_key_is_valid === false) {
    return { text: 'Invalid', color: 'text-[var(--accent)]' }
  }
  return { text: '? Unverified', color: 'text-[var(--primary)]' }
}

export function useGuildEditingActions({
  guilds,
  currentUserDisplayName,
  setGuilds,
  fetchGuilds,
  toast
}: Options) {
  const supabase = dbClient()
  const [editingGuild, setEditingGuild] = useState<string | null>(null)
  const [editedGuild, setEditedGuild] = useState<Guild | null>(null)
  const [validatingKey, setValidatingKey] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [guildToDelete, setGuildToDelete] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const handleEdit = (guild: Guild) => {
    setEditingGuild(guild.guild_code)
    setEditedGuild({ ...guild })
  }
  const handleCancelEdit = () => {
    setEditingGuild(null)
    setEditedGuild(null)
  }

  const validateApiKey = async (guildCode: string) => {
    const guild = guilds.find((candidate) => candidate.guild_code === guildCode)
    if (!guild?.has_api_key) {
      toast.warning('No API key to validate')
      return
    }
    setValidatingKey(guildCode)
    try {
      const response = await fetch('/api/validate-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildCode })
      })
      if (!response.ok) {
        logger.error(
          { status: response.status, body: await response.text() },
          'API key validation request failed'
        )
        toast.error(`Validation request failed: ${response.status}`)
        return
      }

      const result = await response.json()
      const validatedAt = new Date().toISOString()
      const isValid = result.valid === true
      const update: GuildConfigUpdate = {
        api_key_is_valid: isValid,
        api_key_last_validated: validatedAt
      }
      const { error } = await supabase
        .from('guild_config')
        .update(update)
        .eq('guild_code', guildCode)

      if (error) {
        setGuilds((current) =>
          current.map((entry) =>
            entry.guild_code === guildCode
              ? {
                  ...entry,
                  api_key_is_valid: isValid,
                  api_key_last_validated: validatedAt
                }
              : entry
          )
        )
      } else {
        await fetchGuilds()
      }

      if (isValid) {
        toast.success(
          'API key is valid and working!',
          error
            ? 'Note: Database update failed due to permissions, but the key is working'
            : undefined
        )
      } else {
        toast.error(
          `API key is invalid: ${result.error || result.message || 'Unknown error'}`
        )
      }
    } catch (error) {
      logger.error({ err: error }, 'Error validating API key:')
      toast.error(`Failed to validate API key: ${extractErrorMessage(error)}`)
    } finally {
      setValidatingKey(null)
    }
  }

  const handleSaveEdit = async () => {
    if (!editedGuild) return
    try {
      const apiKeyChanged = Boolean(editedGuild.api_key?.trim())
      if (apiKeyChanged && editedGuild.api_key) {
        const response = await fetch('/api/guild/update-api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: editedGuild.guild_code,
            api_key: editedGuild.api_key,
            api_owner: editedGuild.API_Owner || currentUserDisplayName
          })
        })
        if (!response.ok) {
          const body = await response.json()
          throw new Error(body.details || body.error || 'Update failed')
        }
      }

      const update: GuildConfigUpdate = {
        enabled: editedGuild.enabled,
        token_offender_threshold: editedGuild.token_offender_threshold,
        token_abuser_threshold: editedGuild.token_abuser_threshold
      }
      if (!apiKeyChanged && editedGuild.API_Owner !== undefined) {
        update.API_Owner = editedGuild.API_Owner
      }
      const { error } = await supabase
        .from('guild_config')
        .update(update)
        .eq('guild_code', editedGuild.guild_code)
      if (error) throw error

      toast.success(
        `${formatGuildDisplayLabel(
          {
            display_name: editedGuild.display_name,
            guild_code: editedGuild.guild_code
          },
          editedGuild.guild_code
        )} updated successfully!`
      )
      await fetchGuilds()
      handleCancelEdit()
    } catch (error) {
      logger.error({ err: error }, 'Error saving guild:')
      toast.error(
        error instanceof Error
          ? error.message
          : `Failed to update guild: ${extractErrorMessage(error)}`
      )
    }
  }

  const handleDelete = (guildCode: string) => {
    setGuildToDelete(guildCode)
    setDeleteConfirmOpen(true)
    setDeleteConfirmText('')
  }

  const handleDeleteConfirmed = async () => {
    if (!guildToDelete) return
    if (deleteConfirmText !== 'delete this guild') {
      toast.warning(
        'Confirmation text did not match. Deletion cancelled for safety.'
      )
      return
    }

    const guildCode = guildToDelete
    setDeleteConfirmOpen(false)
    setGuildToDelete(null)
    setDeleteConfirmText('')
    try {
      const { error } = await supabase
        .from('guild_config')
        .update({ enabled: false } satisfies GuildConfigUpdate)
        .eq('guild_code', guildCode)
      if (error) throw error
      toast.success(
        `${formatGuildDisplayLabel(null, guildCode)} has been disabled from the cluster.`
      )
      await fetchGuilds()
    } catch (error) {
      logger.error({ err: error }, 'Error disabling guild:')
      toast.error(`Failed to disable guild: ${extractErrorMessage(error)}`)
    }
  }

  return {
    editingGuild,
    setEditingGuild,
    editedGuild,
    setEditedGuild,
    validatingKey,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    guildToDelete,
    setGuildToDelete,
    deleteConfirmText,
    setDeleteConfirmText,
    handleEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleDelete,
    handleDeleteConfirmed,
    validateApiKey,
    getApiKeyStatus: getGuildApiKeyStatus
  }
}
