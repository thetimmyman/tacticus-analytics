'use client'

import { useState, useCallback } from 'react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.components.cluster-management.hooks.useDiscordInvites'
)
import { extractErrorMessage } from './useClusterData'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

interface UseDiscordInvitesOptions {
  fetchDiscordLinks: () => Promise<void>
}

interface UseDiscordInvitesReturn {
  copiedInvite: string | null
  generatingInviteFor: string | null
  inviteSuccessMessage: string | null
  deletingInviteId: number | null
  handleCopyInvite: (inviteCode: string) => Promise<void>
  handleGenerateInvite: (guildCode?: string | null) => Promise<void>
  handleDeleteInvite: (inviteId: number) => Promise<void>
  setInviteSuccessMessage: React.Dispatch<React.SetStateAction<string | null>>
  setDiscordLinksError: (error: string | null) => void
}

export function useDiscordInvites({
  fetchDiscordLinks
}: UseDiscordInvitesOptions): UseDiscordInvitesReturn {
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null)
  const [generatingInviteFor, setGeneratingInviteFor] = useState<string | null>(
    null
  )
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState<
    string | null
  >(null)
  const [deletingInviteId, setDeletingInviteId] = useState<number | null>(null)
  const [_discordLinksErrorLocal, setDiscordLinksErrorLocal] = useState<
    string | null
  >(null)

  const handleCopyInvite = async (inviteCode: string) => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopiedInvite(inviteCode)
      setTimeout(() => setCopiedInvite(null), 2000)
    } catch (error) {
      logger.error({ err: error }, 'Failed to copy invite code:')
      setDiscordLinksErrorLocal(
        'Unable to copy invite code. Please copy manually.'
      )
      setTimeout(() => setDiscordLinksErrorLocal(null), 3000)
    }
  }

  const handleGenerateInvite = useCallback(
    async (guildCode?: string | null) => {
      try {
        const scope = guildCode ? 'guild' : 'cluster'
        setGeneratingInviteFor(guildCode ?? 'cluster')
        setInviteSuccessMessage(null)
        setDiscordLinksErrorLocal(null)

        const response = await fetch('/api/cluster/discord-links', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            scope === 'guild'
              ? { scope: 'guild', guildCode }
              : { scope: 'cluster' }
          )
        })
        const payload = await response.json()

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error ?? 'Failed to create invite.')
        }

        const inviteCode = payload.data?.invite_code ?? payload.data?.inviteCode
        if (scope === 'guild') {
          setInviteSuccessMessage(
            `Invite ${inviteCode ?? ''} created for ${formatGuildDisplayLabel(null, guildCode)}.`
          )
        } else {
          setInviteSuccessMessage(
            `Cluster invite ${inviteCode ?? ''} created successfully.`
          )
        }
        setTimeout(() => setInviteSuccessMessage(null), 4000)
        fetchDiscordLinks()
      } catch (error) {
        setDiscordLinksErrorLocal(extractErrorMessage(error))
        setTimeout(() => setDiscordLinksErrorLocal(null), 4000)
      } finally {
        setGeneratingInviteFor(null)
      }
    },
    [fetchDiscordLinks]
  )

  const handleDeleteInvite = useCallback(
    async (inviteId: number) => {
      try {
        setDeletingInviteId(inviteId)
        setInviteSuccessMessage(null)
        setDiscordLinksErrorLocal(null)

        const response = await fetch('/api/cluster/discord-links', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inviteId })
        })
        const payload = await response.json()

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error ?? 'Failed to deactivate invite.')
        }

        setInviteSuccessMessage('Invite deactivated.')
        setTimeout(() => setInviteSuccessMessage(null), 3000)
        fetchDiscordLinks()
      } catch (error) {
        setDiscordLinksErrorLocal(extractErrorMessage(error))
        setTimeout(() => setDiscordLinksErrorLocal(null), 4000)
      } finally {
        setDeletingInviteId(null)
      }
    },
    [fetchDiscordLinks]
  )

  return {
    copiedInvite,
    generatingInviteFor,
    inviteSuccessMessage,
    deletingInviteId,
    handleCopyInvite,
    handleGenerateInvite,
    handleDeleteInvite,
    setInviteSuccessMessage,
    setDiscordLinksError: setDiscordLinksErrorLocal
  }
}
