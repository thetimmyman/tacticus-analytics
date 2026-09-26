'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'

import { extractErrorMessage, getErrorMessage } from './error-helpers'
import {
  createEmptyStatus,
  logger,
  parseGuildTokensResponse,
  readResponseBody,
  toPlayerAvailability
} from './parse'
import type {
  PlayerAvailability,
  SeededAvailability,
  StatusState,
  SyncStatusType
} from './types'

interface ToastApi {
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
}

interface UseAvailabilityDataOptions {
  guildCode: string
  season: string
  availabilityKey: string
  seededAvailability: SeededAvailability | null
  toast: ToastApi
}

const cooldownSeconds = (cooldown: string | number | null | undefined) => {
  if (!cooldown) return 999999
  if (typeof cooldown === 'number') return cooldown
  const hours = Number.parseInt(cooldown.match(/(\d+)h/)?.[1] ?? '0', 10)
  const minutes = Number.parseInt(cooldown.match(/(\d+)m/)?.[1] ?? '0', 10)
  return hours * 3600 + minutes * 60
}

export function sortPlayersByAvailability(players: PlayerAvailability[]) {
  return [...players].sort((left, right) => {
    if (left.tokens_available !== right.tokens_available) {
      return right.tokens_available - left.tokens_available
    }
    return (
      cooldownSeconds(left.token_cooldown || left.time_to_next_token) -
      cooldownSeconds(right.token_cooldown || right.time_to_next_token)
    )
  })
}

export function summarizeSyncIssues(payload: {
  failedMemberDetails?: unknown
  failedMembers?: unknown
}) {
  const details: Array<{ player?: string; reason?: string }> = Array.isArray(
    payload.failedMemberDetails
  )
    ? payload.failedMemberDetails
    : []
  const members = Array.isArray(payload.failedMembers)
    ? payload.failedMembers.filter(
        (name: unknown): name is string =>
          typeof name === 'string' && name.trim().length > 0
      )
    : []
  const issues = details
    .filter((detail) => detail.player)
    .map((detail) =>
      detail.reason ? `${detail.player}: ${detail.reason}` : detail.player!
    )
  const source = issues.length > 0 ? issues : members
  const preview = source.slice(0, 4)
  const remaining = source.length - preview.length
  return preview.length > 0
    ? `${preview.join(', ')}${remaining > 0 ? `, +${remaining} more` : ''}`
    : ''
}

export function useAvailabilityData({
  guildCode,
  season,
  availabilityKey,
  seededAvailability,
  toast
}: UseAvailabilityDataOptions) {
  const seededKeyRef = useRef<string | null>(seededAvailability?.key ?? null)
  const [players, setPlayers] = useState<PlayerAvailability[]>(
    () => seededAvailability?.players ?? []
  )
  const [playersWithApiKeys, setPlayersWithApiKeys] = useState<Set<string>>(
    () => seededAvailability?.playersWithApiKeys ?? new Set()
  )
  const [loading, setLoading] = useState(() => !seededAvailability)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] =
    useState<StatusState<SyncStatusType>>(createEmptyStatus<SyncStatusType>())

  const fetchAvailability = useCallback(async () => {
    if (!guildCode) {
      setPlayers([])
      setError('Guild code is required to load availability data')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await fetch(
        `/api/guild-tokens?guild=${encodeURIComponent(guildCode)}&season=${season}`
      )
      const parsedBody = await readResponseBody(response)
      if (!response.ok) {
        const fallback =
          response.status === 401
            ? 'Authentication required to view guild tokens'
            : response.status === 403
              ? 'You need officer or leader permissions for this guild'
              : 'Failed to fetch token data'
        throw new Error(extractErrorMessage(parsedBody, fallback))
      }

      const result = parseGuildTokensResponse(parsedBody)
      setPlayers(result.players.map(toPlayerAvailability))
      setPlayersWithApiKeys(
        new Set(
          result.players
            .filter((player) => player.api_key_is_valid)
            .map((player) => player.player_id)
        )
      )
    } catch (caught) {
      logger.error({ err: caught }, 'Error fetching availability:')
      const message =
        caught instanceof Error && caught.message
          ? caught.message
          : 'Failed to load token availability data'
      setError(
        formatErrorForUser(
          createError(
            'TOKEN_DATA_LOAD_FAILED',
            message,
            {
              component: 'GRAvailability',
              action: 'fetch_availability',
              guildCode
            },
            caught
          )
        ).displayMessage
      )
    } finally {
      setLoading(false)
    }
  }, [guildCode, season])

  const syncGuildData = useCallback(async () => {
    setSyncing(true)
    setSyncStatus({
      type: 'info',
      message: 'Syncing all guild members with API keys...'
    })
    if (!guildCode) {
      setSyncStatus({
        type: 'error',
        message: 'Guild code missing. Unable to sync guild data.'
      })
      setSyncing(false)
      return
    }

    try {
      const response = await fetch('/api/guild-tokens/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild: guildCode })
      })
      const data = await response.json()
      if (!response.ok) {
        const message = `Guild sync failed: ${getErrorMessage(data, 'Unable to sync guild data')}`
        setSyncStatus({ type: 'error', message })
        toast.error('Sync Failed', message)
        setTimeout(() => setSyncStatus(createEmptyStatus()), 8000)
        return
      }

      const hasFailures =
        typeof data.failedCount === 'number' && data.failedCount > 0
      let message = data.message || 'Guild sync completed'
      if (data.fromCache) message += ` (cached ${data.cacheAge}s ago)`
      const issues = summarizeSyncIssues(data)
      const description = `${message}${issues && !message.includes(issues) ? ` — ${issues}` : ''}`
      setSyncStatus({ type: hasFailures ? 'warning' : 'success', message })
      if (hasFailures) {
        toast.warning('Sync completed with issues', description)
      } else {
        toast.success('Guild Sync Complete', description)
      }
      await fetchAvailability()
      setTimeout(() => setSyncStatus(createEmptyStatus()), 5000)
    } catch (caught) {
      logger.error({ err: caught }, 'Guild sync error:')
      const message = 'Network error - Unable to connect to sync service'
      setSyncStatus({ type: 'error', message })
      toast.error('Connection Error', message)
      setTimeout(() => setSyncStatus(createEmptyStatus()), 8000)
    } finally {
      setSyncing(false)
    }
  }, [fetchAvailability, guildCode, toast])

  useEffect(() => {
    if (!seededAvailability) return
    setPlayers(seededAvailability.players)
    setPlayersWithApiKeys(seededAvailability.playersWithApiKeys)
    setError(null)
    setLoading(false)
    seededKeyRef.current = seededAvailability.key
  }, [seededAvailability])

  useEffect(() => {
    const hasSeed =
      seededKeyRef.current === availabilityKey &&
      seededAvailability?.key === availabilityKey
    if (!hasSeed) void fetchAvailability()
  }, [availabilityKey, fetchAvailability, seededAvailability])

  const summary = useMemo(
    () => ({
      totalTokensAvailable: players.reduce(
        (total, player) => total + player.tokens_available,
        0
      ),
      totalBombsAvailable: players.reduce(
        (total, player) => total + player.bombs_available,
        0
      ),
      cappedPlayers: players.filter((player) => player.tokens_available >= 3)
        .length,
      sortedPlayers: sortPlayersByAvailability(players)
    }),
    [players]
  )

  return {
    players,
    playersWithApiKeys,
    loading,
    error,
    setError,
    syncing,
    syncStatus,
    fetchAvailability,
    syncGuildData,
    ...summary
  }
}
