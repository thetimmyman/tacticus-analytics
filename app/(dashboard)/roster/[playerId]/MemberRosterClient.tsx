'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import {
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Loader2,
  BarChart3,
  ExternalLink,
  Key,
  MessageSquare,
  Check
} from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { formatNumber } from '@tacticus/app-core/formatters'
import {
  mergeRosterUnits,
  type RosterUnit
} from '@/app/(dashboard)/roster/utils/roster-helpers'
import {
  invalidateCachedRoster,
  readCachedRoster,
  writeCachedRoster
} from '@/app/(dashboard)/roster/utils/roster-response-cache'
import { processUnits } from '../_lib/process-units'
import { useHeroMappings } from '../_lib/useHeroMappings'
import { useRosterFilters } from '../_lib/useRosterFilters'
import { useRosterViewState } from '../_lib/useRosterViewState'
import { RosterFilterBar } from '../components/RosterFilterBar'
import { RosterPagination } from '../components/RosterPagination'
import { RosterToolbar } from '../components/RosterToolbar'
import { RosterUnitsView } from '../components/RosterUnitsView'
import { MemberName } from '@/app/components/ui/MemberName'
import { dbClient } from '@/app/lib/db/client'

interface MemberRosterClientProps {
  playerId: string
}

interface RosterPagePayload {
  units: RosterUnit[]
  playerName: string
  powerLevel: number | null
  guildCode: string | null
  tacticusShareUrl: string | null
}

export default function MemberRosterClient({
  playerId
}: MemberRosterClientProps) {
  const [units, setUnits] = useState<RosterUnit[]>([])
  const [playerName, setPlayerName] = useState<string>('')
  const [powerLevel, setPowerLevel] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const [guildCode, setGuildCode] = useState<string | null>(null)
  const [tacticusShareUrl, setTacticusShareUrl] = useState<string | null>(null)
  const [hasDiscord, setHasDiscord] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savingApiKey, setSavingApiKey] = useState(false)
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [sendingDiscordMessage, setSendingDiscordMessage] = useState(false)
  const [discordMessageSent, setDiscordMessageSent] = useState(false)
  const [discordError, setDiscordError] = useState<string | null>(null)

  const heroMappings = useHeroMappings()
  const rf = useRosterFilters(units, heroMappings)
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    viewMode,
    changeViewMode
  } = useRosterViewState()

  // No server cache on the Tacticus branch, so cache repeat opens; the controller is the in-flight latch.
  const rosterRequestRef = useRef<AbortController | null>(null)
  const postSaveRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchRoster = async ({ force = false }: { force?: boolean } = {}) => {
    if (!force) {
      const cached = readCachedRoster<RosterPagePayload>('page', playerId)
      if (cached) {
        setUnits(cached.units)
        setPlayerName(cached.playerName)
        setPowerLevel(cached.powerLevel)
        setGuildCode(cached.guildCode)
        setTacticusShareUrl(cached.tacticusShareUrl)
        setError(null)
        setErrorCode(null)
        setLoading(false)
        return
      }
    }

    if (rosterRequestRef.current) return

    const controller = new AbortController()
    rosterRequestRef.current = controller
    setLoading(true)
    setError(null)
    setErrorCode(null)

    try {
      const response = await fetch(
        `/api/members/roster?player_id=${encodeURIComponent(playerId)}`,
        { signal: controller.signal }
      )
      const data = await response.json()
      if (controller.signal.aborted) return

      if (!response.ok) {
        const errorMsg =
          typeof data.error === 'object' ? data.error?.message : data.error
        setError(errorMsg || 'Failed to fetch roster')
        setErrorCode(data.code || null)
        if (data.playerName) setPlayerName(data.playerName)
        if (data.hasDiscord !== undefined) setHasDiscord(data.hasDiscord)
        return
      }

      // Merge Machines of War like /roster; the Loki partial response omits them.
      const payload: RosterPagePayload = {
        units: mergeRosterUnits(
          Array.isArray(data.units) ? data.units : [],
          Array.isArray(data.machinesOfWar) ? data.machinesOfWar : []
        ),
        playerName: data.playerName || '',
        powerLevel: data.powerLevel || null,
        guildCode: data.guildCode || null,
        tacticusShareUrl: data.tacticusShareUrl || null
      }
      writeCachedRoster('page', playerId, payload)

      setUnits(payload.units)
      setPlayerName(payload.playerName)
      setPowerLevel(payload.powerLevel)
      setGuildCode(payload.guildCode)
      setTacticusShareUrl(payload.tacticusShareUrl)
    } catch {
      if (controller.signal.aborted) return
      setError('Failed to connect to server')
    } finally {
      // An older aborted request must not clear a newer latch.
      if (rosterRequestRef.current === controller) {
        rosterRequestRef.current = null
      }
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  // Per-tab module cache: never leak one account's rosters into another session.
  useEffect(() => {
    const {
      data: { subscription }
    } = dbClient().auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED'
      ) {
        invalidateCachedRoster()
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    void fetchRoster()
    return () => {
      rosterRequestRef.current?.abort()
      rosterRequestRef.current = null
      if (postSaveRefreshRef.current !== null) {
        clearTimeout(postSaveRefreshRef.current)
        postSaveRefreshRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchRoster only depends on playerId
  }, [playerId])

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return

    setSavingApiKey(true)
    setApiKeyError(null)

    try {
      const response = await fetch('/api/admin/player-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, apiKey: apiKeyInput.trim() })
      })

      const data = await response.json()

      if (!response.ok) {
        setApiKeyError(extractErrorMessage(data, 'Failed to save API key'))
        return
      }

      setApiKeySaved(true)
      setApiKeyInput('')
      // The cached payload predates the key; do not show it after the save.
      invalidateCachedRoster(playerId)
      postSaveRefreshRef.current = setTimeout(() => {
        postSaveRefreshRef.current = null
        void fetchRoster({ force: true })
      }, 1500)
    } catch {
      setApiKeyError('Failed to connect to server')
    } finally {
      setSavingApiKey(false)
    }
  }

  const handleSendDiscordRequest = async () => {
    setSendingDiscordMessage(true)
    setDiscordError(null)

    try {
      const response = await fetch('/api/members/request-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId })
      })

      const data = await response.json()

      if (!response.ok) {
        setDiscordError(
          extractErrorMessage(data, 'Failed to send Discord message')
        )
        return
      }

      setDiscordMessageSent(true)
    } catch {
      setDiscordError('Failed to connect to server')
    } finally {
      setSendingDiscordMessage(false)
    }
  }

  useEffect(() => {
    setCurrentPage(1)
  }, [
    rf.searchTerm,
    rf.factionFilter,
    rf.allianceFilter,
    rf.rarityFilter,
    rf.rankTierFilter,
    rf.abilityMinFilter,
    rf.abilityMaxFilter,
    rf.metaTeamFilter,
    setCurrentPage
  ])

  const totalPages = Math.ceil(rf.filteredAndSortedUnits.length / pageSize)

  const paginatedUnits = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return processUnits(
      rf.filteredAndSortedUnits.slice(start, start + pageSize),
      heroMappings
    )
  }, [rf.filteredAndSortedUnits, currentPage, pageSize, heroMappings])

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/guild-management/members">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Members
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            Member Roster
          </h1>
        </div>
        <div className="card-wh40k p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)] mx-auto mb-4" />
          <p className="text-[var(--text-secondary)]">
            Loading roster from Tacticus...
          </p>
        </div>
      </div>
    )
  }

  if (error && errorCode === 'NO_API_KEY') {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/guild-management/members">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Members
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            {playerName ? `${playerName}'s Roster` : 'Member Roster'}
          </h1>
        </div>

        <div className="card-wh40k p-8">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Key className="h-8 w-8 text-amber-400" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2 text-center">
            Player API Key Not Configured
          </h2>
          <p className="text-[var(--text-secondary)] mb-6 text-center">
            {playerName || 'This player'} has not added their Player API key
            yet. You can add it for them or request they add it.
          </p>

          <div className="space-y-6">
            <div className="card-wh40k p-6 bg-[var(--bg-secondary)]">
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <Key className="h-5 w-5 text-[var(--accent)]" />
                Add API Key for {playerName || 'Player'}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                If you have {playerName || 'the player'}&apos;s API key, you can
                add it on their behalf.
              </p>

              {apiKeySaved ? (
                <div className="flex items-center gap-2 text-green-400 bg-green-500/10 p-3 rounded-md">
                  <Check className="h-5 w-5" />
                  <span>API key saved successfully! Loading roster...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Paste player API key here..."
                    className="input-wh40k w-full"
                    disabled={savingApiKey}
                  />
                  {apiKeyError && (
                    <p className="text-sm text-red-400">{apiKeyError}</p>
                  )}
                  <Button
                    onClick={handleSaveApiKey}
                    disabled={!apiKeyInput.trim() || savingApiKey}
                    className="w-full sm:w-auto"
                  >
                    {savingApiKey ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Validating &amp; Saving...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4 mr-2" />
                        Save API Key
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {hasDiscord && (
              <div className="card-wh40k p-6 bg-[var(--bg-secondary)]">
                <h3 className="text-lg font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-[#5865F2]" />
                  Request via Discord
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  {playerName || 'This player'} has Discord linked. Send them a
                  direct message requesting they add their API key.
                </p>

                {discordMessageSent ? (
                  <div className="flex items-center gap-2 text-green-400 bg-green-500/10 p-3 rounded-md">
                    <Check className="h-5 w-5" />
                    <span>Discord message sent to {playerName}!</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {discordError && (
                      <p className="text-sm text-red-400">{discordError}</p>
                    )}
                    <Button
                      onClick={handleSendDiscordRequest}
                      disabled={sendingDiscordMessage}
                      variant="outline"
                      className="border-[#5865F2]/50 text-[#5865F2] hover:bg-[#5865F2]/10"
                    >
                      {sendingDiscordMessage ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Send Discord Request
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!hasDiscord && (
              <div className="text-sm text-[var(--text-secondary)] text-center p-4 border border-dashed border-[var(--card-border)] rounded-md">
                <MessageSquare className="h-5 w-5 mx-auto mb-2 opacity-50" />
                <p>
                  {playerName || 'This player'} has not linked their Discord
                  account, so we cannot send them a message.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/guild-management/members">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Members
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            {playerName ? `${playerName}'s Roster` : 'Member Roster'}
          </h1>
        </div>
        <div className="card-wh40k p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            Failed to Load Roster
          </h2>
          <p className="text-[var(--text-secondary)] mb-4">{error}</p>
          <Button
            onClick={() => void fetchRoster({ force: true })}
            className="mt-4"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
        <div className="flex items-center gap-3">
          <Link href="/guild-management/members">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
              <MemberName value={playerName} />
              &apos;s Roster
            </h1>
            {powerLevel && (
              <p className="text-sm text-[var(--text-secondary)]">
                Power Level: {formatNumber(powerLevel)}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {guildCode && (
            <Link
              href={`/player-stats?player=${encodeURIComponent(playerName)}&guild=${encodeURIComponent(guildCode)}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs sm:text-sm bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-md text-[var(--accent)] transition-colors"
            >
              <BarChart3 className="h-4 w-4" />
              <MemberName value={playerName} />
              &apos;s Stats
            </Link>
          )}
          {tacticusShareUrl && (
            <a
              href={tacticusShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs sm:text-sm bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-md text-purple-400 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Planner
            </a>
          )}
          <Button
            onClick={() => void fetchRoster({ force: true })}
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      <RosterFilterBar rf={rf} />

      <RosterToolbar
        rf={rf}
        shownCount={rf.filteredAndSortedUnits.length}
        totalCount={units.length}
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
      />

      <RosterUnitsView
        units={paginatedUnits}
        totalFilteredCount={rf.filteredAndSortedUnits.length}
        viewMode={viewMode}
        rf={rf}
      />

      {rf.filteredAndSortedUnits.length > 0 && (
        <RosterPagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={rf.filteredAndSortedUnits.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setCurrentPage(1)
          }}
        />
      )}
    </div>
  )
}
