'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Card, CardContent } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
// Chrome icons only; per-token icons are datamine sprites.
import { Zap, Key, AlertCircle, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { extractErrorMessage } from '@/app/lib/utils/error-message'

interface TokenStatus {
  current: number
  max: number
  nextInSeconds: number | null
}

interface TokenAvailabilityProps {
  guildRaidTokens?: TokenStatus
  bombTokens?: TokenStatus
  hasPlayerApiKey?: boolean
  /** Reports the live raid count and bomb status (authoritative, not a snapshot). */
  onLiveTokens?: (guildRaid: TokenStatus, bomb?: TokenStatus | null) => void
}

export default function TokenAvailability({
  guildRaidTokens,
  bombTokens,
  hasPlayerApiKey = false,
  onLiveTokens
}: TokenAvailabilityProps) {
  const hasMounted = useHasMounted()
  const router = useRouter()
  const [tokenData, setTokenData] = useState<{
    arena?: TokenStatus
    guildRaid?: TokenStatus
    onslaught?: TokenStatus
    salvageRun?: TokenStatus
    expedition?: TokenStatus
    bomb?: TokenStatus
  }>({
    guildRaid: guildRaidTokens,
    bomb: bombTokens
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [tick, setTick] = useState(0)
  const syncTimeRef = useRef<number>(Date.now())

  useEffect(() => {
    if (guildRaidTokens) {
      setTokenData((prev) => ({
        ...prev,
        guildRaid: guildRaidTokens
      }))
    }
    if (bombTokens) {
      setTokenData((prev) => ({
        ...prev,
        bomb: bombTokens
      }))
    }
  }, [guildRaidTokens, bombTokens])

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const getAdjustedSeconds = useCallback(
    (originalSeconds: number | null): number | null => {
      if (originalSeconds === null) return null
      const elapsed = Math.floor((Date.now() - syncTimeRef.current) / 1000)
      return Math.max(0, originalSeconds - elapsed)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]
  )

  const formatTime = useCallback((seconds: number): string => {
    // HH:MM, rounded up so the last minute reads 00:01, not 00:00.
    if (seconds <= 0) return '00:00'

    const totalMinutes = Math.ceil(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60

    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}`
  }, [])

  const fetchTokenData = useCallback(async () => {
    if (!hasPlayerApiKey) {
      return
    }

    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/player-api-key/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Unknown error' }))
        const errorMessage = extractErrorMessage(
          errorData,
          `HTTP ${response.status}: Failed to connect to Player API`
        )
        throw new Error(errorMessage)
      }

      const data = await response.json()

      if (data.tokenInfo) {
        const tokenInfo = data.tokenInfo
        setTokenData((prev) => ({
          ...prev,
          guildRaid: {
            current: tokenInfo.tokensAvailable || 0,
            max: 3,
            nextInSeconds:
              typeof tokenInfo.nextTokenSeconds === 'number' &&
              Number.isFinite(tokenInfo.nextTokenSeconds)
                ? tokenInfo.nextTokenSeconds
                : null
          },
          arena:
            tokenInfo.arenaTokens !== undefined
              ? {
                  current: tokenInfo.arenaTokens,
                  max: 15,
                  nextInSeconds: tokenInfo.nextArenaTokenSeconds || null
                }
              : undefined,
          onslaught:
            tokenInfo.onslaughtTokens !== undefined
              ? {
                  current: tokenInfo.onslaughtTokens,
                  max: 3,
                  nextInSeconds: tokenInfo.nextOnslaughtTokenSeconds || null
                }
              : undefined,
          salvageRun:
            tokenInfo.salvageTokens !== undefined
              ? {
                  current: tokenInfo.salvageTokens,
                  max: 2,
                  nextInSeconds: tokenInfo.nextSalvageTokenSeconds || null
                }
              : undefined,
          expedition:
            tokenInfo.expeditionTokens !== undefined
              ? {
                  current: tokenInfo.expeditionTokens,
                  max: 2,
                  nextInSeconds: tokenInfo.nextExpeditionTokenSeconds || null
                }
              : undefined,
          bomb:
            tokenInfo.bombsAvailable !== undefined
              ? {
                  current: tokenInfo.bombsAvailable || 0,
                  max: 1,
                  nextInSeconds: tokenInfo.nextBombSeconds || null
                }
              : prev.bomb
        }))
        syncTimeRef.current = Date.now()
        setLastSync(new Date())
        // Live count (regen applied) for the briefing next-move.
        onLiveTokens?.(
          {
            current: tokenInfo.tokensAvailable || 0,
            max: 3,
            nextInSeconds:
              typeof tokenInfo.nextTokenSeconds === 'number' &&
              Number.isFinite(tokenInfo.nextTokenSeconds)
                ? tokenInfo.nextTokenSeconds
                : null
          },
          tokenInfo.bombsAvailable !== undefined
            ? {
                current: tokenInfo.bombsAvailable || 0,
                max: 1,
                nextInSeconds: tokenInfo.nextBombSeconds || null
              }
            : null
        )
      } else {
        throw new Error('No token data received from API')
      }
    } catch (fetchError) {
      const errorMessage =
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to connect to Player API endpoint'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }, [hasPlayerApiKey, onLiveTokens])

  useEffect(() => {
    if (hasPlayerApiKey) {
      fetchTokenData()
    }
  }, [hasPlayerApiKey, fetchTokenData])

  const getStatusColor = (current: number, max: number) => {
    const ratio = max > 0 ? current / max : 0
    if (ratio >= 1) return 'text-green-400'
    if (ratio >= 0.5) return 'text-yellow-400'
    if (ratio > 0) return 'text-orange-400'
    return 'text-red-400'
  }

  // Vendored datamine sprites (scripts/datamine/download-local-sprites.sh); never hot-link.
  const tokenItems = [
    {
      key: 'guild-raid',
      label: 'Guild Raid',
      img: '/images/tokens/ui_icon_resource_token_battle_guildboss.png',
      data: tokenData.guildRaid
    },
    {
      key: 'arena',
      label: 'Arena',
      img: '/images/tokens/ui_icon_resource_token_battle_pvp.png',
      data: tokenData.arena
    },
    {
      key: 'onslaught',
      label: 'Onslaught',
      img: '/images/tokens/ui_icon_resource_token_battle_waves.png',
      data: tokenData.onslaught
    },
    {
      key: 'salvage',
      label: 'Salvage Run',
      img: '/images/tokens/ui_icon_resource_salvage.png',
      data: tokenData.salvageRun
    },
    // Expedition tokens are hidden until the feature is live.
    {
      key: 'bomb',
      label: 'Bomb',
      img: '/images/tokens/ui_icon_bomb.png',
      data: tokenData.bomb
    }
  ].filter((item) => item.data !== undefined)

  if (!hasPlayerApiKey) {
    return (
      <Card className="border border-[var(--card-border)] bg-black/30">
        <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-transparent px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-[var(--accent)]">
              <Key className="h-4 w-4" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              Token Availability
            </h3>
          </div>
        </div>

        <CardContent className="p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-[#a5a5a5]">
              Connect your Player API key to view live token availability.
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push('/api-keys')}
            >
              Add API Key
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <div className="border border-[var(--card-border)] bg-black/30">
        <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-transparent px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-[var(--accent)]">
              <AlertCircle className="h-4 w-4" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              Token Availability
            </h3>
          </div>
          {loading && (
            <div className="h-1.5 w-1.5 animate-spin rounded-full border border-[var(--accent)] border-t-transparent" />
          )}
        </div>

        <div className="p-3">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm text-[var(--accent)]">
              <AlertCircle className="mr-2 inline h-4 w-4" />
              {error}
            </div>
            <Button
              className="flex items-center gap-2 whitespace-nowrap"
              onClick={fetchTokenData}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
              />
              Retry
            </Button>
          </div>
          {lastSync && hasMounted && (
            <div className="mt-2 text-xs text-[#666]">
              Last successful sync:{' '}
              {
                // eslint-disable-next-line no-restricted-syntax
                lastSync.toLocaleTimeString()
              }
            </div>
          )}
          {lastSync && !hasMounted && (
            <div className="mt-2 text-xs text-[#666]">
              Last successful sync: —
            </div>
          )}
        </div>
      </div>
    )
  }

  if (tokenItems.length === 0) {
    return (
      <div className="border border-[var(--card-border)] bg-black/30">
        <div className="flex items-center justify-between border-b border-[var(--card-border)] bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-transparent px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="text-[var(--accent)]">
              <Zap className="h-4 w-4" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
              Token Availability
            </h3>
          </div>
          <div className="h-1.5 w-1.5 animate-spin rounded-full border border-[var(--accent)] border-t-transparent" />
        </div>

        <div className="p-3">
          <div className="text-center text-sm text-[#a5a5a5]">
            Connecting to Player API endpoint...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-[var(--card-border)] bg-black/30">
      {/* Desktop-only header; mobile shows just the compact strip. */}
      <div className="hidden items-center justify-between border-b border-[var(--card-border)] bg-gradient-to-r from-[color-mix(in_srgb,var(--accent)_10%,transparent)] to-transparent px-3 py-1.5 sm:flex">
        <div className="flex items-center gap-2">
          <div className="text-[var(--accent)]">
            <Zap className="h-4 w-4" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]">
            Token Availability
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {lastSync && hasMounted && (
            <span className="text-[11px] text-[#666]">
              Last synced:{' '}
              {
                // eslint-disable-next-line no-restricted-syntax
                lastSync.toLocaleTimeString()
              }
            </span>
          )}
          {lastSync && !hasMounted && (
            <span className="text-[11px] text-[#666]">Last synced: —</span>
          )}
          {loading && (
            <div className="h-1.5 w-1.5 animate-spin rounded-full border border-[var(--accent)] border-t-transparent" />
          )}
        </div>
      </div>

      <div className="p-1.5 sm:p-2">
        {/* One row of five: sprite + count on mobile, plus label and timer on desktop. */}
        <div className="grid grid-cols-5 gap-1 sm:gap-1.5">
          {tokenItems
            .filter((item) => item.data)
            .map((item) => {
              const remaining = getAdjustedSeconds(item.data!.nextInSeconds)
              const showTimer =
                item.data!.nextInSeconds !== null &&
                item.data!.current < item.data!.max &&
                (remaining ?? 0) > 0
              return (
                <div
                  key={item.key}
                  className="flex flex-col items-center gap-0.5 rounded-md border border-[var(--card-border)] bg-black/50 p-1 text-center sm:flex-row sm:items-center sm:gap-2 sm:p-1.5 sm:text-left"
                >
                  <img
                    src={item.img}
                    alt={item.label}
                    title={item.label}
                    width={24}
                    height={24}
                    loading="eager"
                    decoding="async"
                    className="h-6 w-6 shrink-0 object-contain sm:h-5 sm:w-5"
                  />
                  <div className="min-w-0 sm:flex-1">
                    <div className="hidden truncate font-mono text-[9px] uppercase tracking-wider text-[#888] sm:block">
                      {item.label}
                    </div>
                    <div className="flex items-center justify-center gap-1.5 sm:justify-start">
                      <span
                        className={`font-mono text-xs font-bold tabular-nums sm:text-[13px] ${getStatusColor(item.data!.current, item.data!.max)}`}
                      >
                        {item.data!.current}/{item.data!.max}
                        {item.data!.current === item.data!.max && (
                          <span className="ml-1 hidden text-[9px] text-green-400 sm:inline">
                            Full
                          </span>
                        )}
                      </span>
                      {showTimer && (
                        <span className="hidden font-mono text-[10px] tabular-nums text-[var(--accent)] sm:inline">
                          {formatTime(remaining ?? 0)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
