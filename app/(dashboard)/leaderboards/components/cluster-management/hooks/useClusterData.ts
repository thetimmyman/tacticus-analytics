'use client'

import { useState, useEffect, useCallback } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { extractErrorMessage as extractCanonicalErrorMessage } from '@/app/lib/utils/error-message'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.components.cluster-management.hooks.useClusterData'
)
import { useClusterContext } from '@/app/hooks/useClusterContext'
import type {
  Guild,
  GuildDiscordLink,
  ClusterInvite,
  ClusterConfig,
  RawInvite,
  RawGuildLink,
  DiscordLinksResponse
} from '../types'
import { resolveApiOwnerDisplay } from '../utils/apiOwner'

// guild_config.user_id is text; filter non-UUIDs before querying uuid player_mapping.user_id.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function extractErrorMessage(error: unknown): string {
  return extractCanonicalErrorMessage(error, 'Unknown error')
}

interface UseClusterDataOptions {
  clusterCode?: string
}

type ClusterGuildRow = {
  guild_code: string
  guild_tag: string | null
  display_name: string | null
  user_id: string | null
  API_Owner: string | null
  api_key_is_valid: boolean | null
  api_key_last_validated: string | null
  enabled: boolean | null
  GR_Ranking: number | null
  GW_Ranking: number | null
  token_offender_threshold: number | null
  token_abuser_threshold: number | null
  cluster_code: string | null
}

interface UseClusterDataReturn {
  guilds: Guild[]
  loading: boolean
  clusterId: string | null
  clusterConfig: ClusterConfig
  currentUserDisplayName: string | null
  discordLinks: GuildDiscordLink[]
  discordLinksLoading: boolean
  discordLinksError: string | null
  clusterInvites: ClusterInvite[]
  setGuilds: React.Dispatch<React.SetStateAction<Guild[]>>
  setClusterConfig: React.Dispatch<React.SetStateAction<ClusterConfig>>
  fetchGuilds: () => Promise<void>
  fetchDiscordLinks: () => Promise<void>
  setDiscordLinksError: React.Dispatch<React.SetStateAction<string | null>>
}

function hasGuildApiKey(
  guild: Pick<ClusterGuildRow, 'api_key_is_valid' | 'api_key_last_validated'>
): boolean {
  return (
    guild.api_key_is_valid !== null || guild.api_key_last_validated !== null
  )
}

export function useClusterData({
  clusterCode
}: UseClusterDataOptions): UseClusterDataReturn {
  const supabase = dbClient()
  const { displayName: contextDisplayName } = useClusterContext()

  const [guilds, setGuilds] = useState<Guild[]>([])
  const [loading, setLoading] = useState(true)
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [clusterConfig, setClusterConfig] = useState<ClusterConfig>({
    minimum_player_level: 55,
    rejection_message:
      'We are an end-game cluster with all guilds in the top 30 rankings, we require players to be at least level {level}. Please come join our discord for conversation on how to increase your player level, check out the IVS cluster that has starter friendly guilds available, and check us out later.'
  })

  const [discordLinks, setDiscordLinks] = useState<GuildDiscordLink[]>([])
  const [discordLinksLoading, setDiscordLinksLoading] = useState(false)
  const [discordLinksError, setDiscordLinksError] = useState<string | null>(
    null
  )
  const [clusterInvites, setClusterInvites] = useState<ClusterInvite[]>([])

  const fetchClusterId = async () => {
    if (!clusterCode) return
    try {
      const { data, error } = await supabase
        .from('clusters')
        .select('id')
        .eq('cluster_code', clusterCode)
        .single()

      if (data?.id && !error) {
        setClusterId(data.id)
      }
    } catch (error) {
      logger.error({ err: error }, 'Error fetching cluster ID:')
    }
  }

  const fetchClusterConfig = async () => {
    if (!clusterCode) return

    try {
      type ClusterConfigRow = {
        minimum_player_level: number | null
        rejection_message: string | null
      }
      const { data, error } = await (supabase
        .from('cluster_config' as 'clusters')
        .select('minimum_player_level, rejection_message')
        .eq('cluster_code', clusterCode)
        .single() as unknown as Promise<{
        data: ClusterConfigRow | null
        error: unknown
      }>)

      if (data && !error) {
        setClusterConfig({
          minimum_player_level: data.minimum_player_level || 55,
          rejection_message:
            data.rejection_message || clusterConfig.rejection_message
        })
      }
    } catch (error) {
      logger.error({ err: error }, 'Error fetching cluster config:')
    }
  }

  const fetchGuilds = async () => {
    if (!clusterCode) {
      setGuilds([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      logger.debug({ clusterCode: clusterCode }, 'Fetching guilds for cluster:')

      // API_Owner (an email) is not granted to authenticated, so read via /api/cluster/guilds.
      const response = await fetch(
        `/api/cluster/guilds?cluster=${encodeURIComponent(clusterCode)}`,
        { credentials: 'same-origin' }
      )
      const payload = (await response.json().catch(() => null)) as {
        success?: boolean
        error?: string
        data?: { guilds?: unknown }
      } | null

      const error =
        !response.ok || !payload?.success
          ? new Error(payload?.error ?? `Request failed (${response.status})`)
          : null
      const data = payload?.data?.guilds

      logger.debug({ data, error, clusterCode }, 'Guild Response:')

      if (error) {
        logger.error({ err: error }, 'Error fetching guilds:')
        setGuilds([])
      } else {
        const guildRows = Array.isArray(data) ? (data as ClusterGuildRow[]) : []

        // Show player display names rather than the raw (sometimes email) API_Owner.
        const ownerUserIds = Array.from(
          new Set(
            guildRows
              .map((guild) => guild.user_id)
              .filter((id): id is string => !!id && UUID_PATTERN.test(id))
          )
        )

        const playerNameByUserId = new Map<string, string>()
        if (ownerUserIds.length > 0) {
          const { data: mappingData, error: mappingError } = await supabase
            .rpc('get_guild_members_browser_safe')
            .in('user_id', ownerUserIds)

          if (mappingError) {
            // Non-fatal: fall back to masked API_Owner labels below.
            logger.warn(
              { err: mappingError },
              'Could not resolve owner display names from player_mapping'
            )
          } else if (Array.isArray(mappingData)) {
            for (const row of mappingData) {
              if (!row?.user_id || !row.display_name) continue
              if (row.is_current || !playerNameByUserId.has(row.user_id)) {
                playerNameByUserId.set(row.user_id, row.display_name)
              }
            }
          }
        }

        const guildData: Guild[] = guildRows.map((guild) => ({
          guild_code: guild.guild_code,
          guild_tag: guild.guild_tag,
          display_name: guild.display_name,
          has_api_key: hasGuildApiKey(guild),
          API_Owner: guild.API_Owner,
          api_owner_display: resolveApiOwnerDisplay(
            guild.API_Owner,
            guild.user_id ? playerNameByUserId.get(guild.user_id) : null
          ),
          api_key_is_valid: guild.api_key_is_valid,
          api_key_last_validated: guild.api_key_last_validated,
          enabled: Boolean(guild.enabled),
          GR_Ranking: guild.GR_Ranking,
          GW_Ranking: guild.GW_Ranking,
          token_offender_threshold: guild.token_offender_threshold,
          token_abuser_threshold: guild.token_abuser_threshold,
          cluster_code: guild.cluster_code
        }))
        logger.debug(
          { guild_count: guildData.length, cluster_code: clusterCode },
          'Fetched guilds successfully'
        )
        setGuilds(guildData)
      }
    } catch (error) {
      logger.error({ err: error }, 'Exception in fetchGuilds:')
      setGuilds([])
    } finally {
      setLoading(false)
    }
  }

  const fetchDiscordLinks = useCallback(async () => {
    if (!clusterCode) return

    try {
      setDiscordLinksLoading(true)
      setDiscordLinksError(null)

      const response = await fetch(
        `/api/cluster/discord-links?cluster=${encodeURIComponent(clusterCode)}`,
        {
          cache: 'no-store'
        }
      )
      const payload: DiscordLinksResponse = await response.json()

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error ?? 'Failed to load Discord link data')
      }

      const mapInvite = (invite: RawInvite): ClusterInvite => ({
        id: invite.id,
        inviteCode: invite.inviteCode ?? invite.invite_code ?? '',
        createdAt: invite.createdAt ?? invite.created_at ?? null,
        expiresAt: invite.expiresAt ?? invite.expires_at ?? null,
        maxUses: invite.maxUses ?? invite.max_uses ?? 0,
        currentUses: invite.currentUses ?? invite.current_uses ?? 0,
        isActive: invite.isActive ?? invite.is_active ?? false
      })

      const guildRecords: GuildDiscordLink[] = (payload.data?.guilds ?? []).map(
        (guild: RawGuildLink) => ({
          guildCode: guild.guildCode,
          displayName: guild.displayName,
          discordLink: guild.discordLink
            ? {
                discordGuildId: guild.discordLink.discord_guild_id,
                invitedWithCode: guild.discordLink.invited_with_code,
                linkedAt: guild.discordLink.linked_at,
                linkedByUserId: guild.discordLink.linked_by_user_id
              }
            : null,
          invites: (guild.invites ?? []).map(mapInvite)
        })
      )

      setDiscordLinks(guildRecords)
      const clusterInviteRecords: ClusterInvite[] = (
        payload.data?.clusterInvites ?? []
      ).map(mapInvite)
      setClusterInvites(clusterInviteRecords)
    } catch (error) {
      setDiscordLinksError(extractErrorMessage(error))
    } finally {
      setDiscordLinksLoading(false)
    }
  }, [clusterCode])

  useEffect(() => {
    fetchGuilds()
    fetchClusterId()
    fetchClusterConfig()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchDiscordLinks()
  }, [fetchDiscordLinks])

  return {
    guilds,
    loading,
    clusterId,
    clusterConfig,
    currentUserDisplayName: contextDisplayName,
    discordLinks,
    discordLinksLoading,
    discordLinksError,
    clusterInvites,
    setGuilds,
    setClusterConfig,
    fetchGuilds,
    fetchDiscordLinks,
    setDiscordLinksError
  }
}
