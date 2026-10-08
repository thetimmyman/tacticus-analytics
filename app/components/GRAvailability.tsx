'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { Card, CardContent } from '@tacticus/ui-kit'
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { Skeleton } from '@tacticus/ui-kit/loading'
import { useToast } from '@/app/hooks/useToast'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import type { GRAvailabilityProps } from '@/app/components/gr-availability/types'
import {
  createAvailabilityKey,
  createSeededAvailability
} from '@/app/components/gr-availability/parse'
import { AvailabilityHeader } from '@/app/components/gr-availability/AvailabilityHeader'
import { AvailabilitySummary } from '@/app/components/gr-availability/AvailabilitySummary'
import { AvailabilityTable } from '@/app/components/gr-availability/AvailabilityTable'
import { ApiKeyPanel } from '@/app/components/gr-availability/ApiKeyPanel'
import { ApiKeyModal } from '@/app/components/gr-availability/ApiKeyModal'
import { useAvailabilityExport } from '@/app/components/gr-availability/useAvailabilityExport'
import { usePlayerApiKeyManagement } from '@/app/components/gr-availability/usePlayerApiKeyManagement'
import { useAvailabilityData } from '@/app/components/gr-availability/useAvailabilityData'

export default function GRAvailability({
  guildCode,
  season,
  initialTokenRows
}: GRAvailabilityProps) {
  const hasMounted = useHasMounted()
  const { toast } = useToast()
  const normalizedGuildCode = useMemo(
    () => normalizeGuildIdentifier(guildCode),
    [guildCode]
  )
  const availabilityKey = useMemo(
    () => createAvailabilityKey(normalizedGuildCode, season),
    [normalizedGuildCode, season]
  )
  const seededAvailability = useMemo(
    () =>
      createSeededAvailability(initialTokenRows, normalizedGuildCode, season),
    [initialTokenRows, normalizedGuildCode, season]
  )
  const [showDetails, setShowDetails] = useState(false)
  const [useMentions, setUseMentions] = useState(false)
  const [showApiModal, setShowApiModal] = useState(false)
  const [showHowItWorks, setShowHowItWorks] = useState(false)
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)
  const [showPostDropdown, setShowPostDropdown] = useState(false)
  const copyDropdownRef = useRef<HTMLDivElement>(null)
  const postDropdownRef = useRef<HTMLDivElement>(null)

  const {
    players,
    playersWithApiKeys,
    loading,
    error,
    setError,
    syncing,
    syncStatus,
    fetchAvailability,
    syncGuildData,
    totalTokensAvailable,
    totalBombsAvailable,
    cappedPlayers,
    sortedPlayers
  } = useAvailabilityData({
    guildCode: normalizedGuildCode,
    season,
    availabilityKey,
    seededAvailability,
    toast
  })

  const clearAvailabilityError = useCallback(() => setError(null), [setError])
  const {
    apiKey,
    setApiKey,
    savingKey,
    hasApiKey,
    apiKeyValid,
    autoRefresh,
    setAutoRefresh,
    deletingKey,
    saveStatus,
    lastSuccessfulSync,
    saveApiKey,
    checkApiKey,
    deleteApiKey
  } = usePlayerApiKeyManagement({
    toast,
    refreshAvailability: fetchAvailability,
    clearAvailabilityError
  })

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        copyDropdownRef.current &&
        !copyDropdownRef.current.contains(event.target as Node)
      ) {
        setShowCopyDropdown(false)
      }
      if (
        postDropdownRef.current &&
        !postDropdownRef.current.contains(event.target as Node)
      ) {
        setShowPostDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    checkApiKey()

    if (autoRefresh) {
      const interval = setInterval(() => {
        syncGuildData()
      }, 60000)
      return () => clearInterval(interval)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedGuildCode, season, autoRefresh])

  const { exporting, exportStatus, exportToDiscord } = useAvailabilityExport({
    guildCode: normalizedGuildCode,
    season,
    players: sortedPlayers,
    totalTokensAvailable,
    totalBombsAvailable,
    cappedPlayers,
    useMentions
  })

  return (
    <div>
      <Card className="border-(--card-border) bg-(--card-bg)">
        <AvailabilityHeader
          season={season}
          useMentions={useMentions}
          setUseMentions={setUseMentions}
          copyDropdownRef={copyDropdownRef}
          postDropdownRef={postDropdownRef}
          loading={loading}
          exporting={exporting}
          players={players}
          showCopyDropdown={showCopyDropdown}
          setShowCopyDropdown={setShowCopyDropdown}
          showPostDropdown={showPostDropdown}
          setShowPostDropdown={setShowPostDropdown}
          exportToDiscord={exportToDiscord}
          hasApiKey={hasApiKey}
          setError={setError}
          setShowDetails={setShowDetails}
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          syncGuildData={syncGuildData}
          syncing={syncing}
        />
        <CardContent className="pt-0 pb-3">
          <AvailabilitySummary
            exportStatus={exportStatus}
            syncStatus={syncStatus}
            players={players}
            totalTokensAvailable={totalTokensAvailable}
            totalBombsAvailable={totalBombsAvailable}
            cappedPlayers={cappedPlayers}
            playersWithApiKeys={playersWithApiKeys}
          />

          {/* Show/Hide Details Button */}
          {!loading && players.length > 0 && (
            <div className="flex justify-center mb-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDetails(!showDetails)}
                className="h-7 px-3 text-xs"
              >
                {showDetails ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" />
                    Hide Details
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" />
                    Show Details
                  </>
                )}
              </Button>
            </div>
          )}

          {loading && <Skeleton className="h-16" />}

          {!loading && players.length === 0 && (
            <div className="text-center py-4 text-(--primary) text-xs">
              <AlertCircle className="h-3 w-3 inline mr-1" />
              No player data available for this season
            </div>
          )}

          {hasApiKey && !apiKeyValid && (
            <div
              role="alert"
              className="mb-3 py-2 px-3 rounded-md text-xs font-medium bg-(--error-bg) text-(--error) border border-(--error-border)"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Tacticus keeps rejecting your saved API key, so live sync has
                  stopped. Save a new key to resume it.
                </span>
              </div>
            </div>
          )}

          {error && !saveStatus.type && (
            <div className="mb-3 py-2 px-3 rounded-md text-xs font-medium bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--accent) border border-[color-mix(in_srgb,var(--accent)_20%,transparent)]">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <LinkifiedText
                  text={error}
                  linkClassName="underline hover:no-underline"
                />
              </div>
            </div>
          )}

          {showDetails && players.length > 0 && (
            <>
              <AvailabilityTable
                sortedPlayers={sortedPlayers}
                hasMounted={hasMounted}
              />
            </>
          )}

          {showDetails && (
            <ApiKeyPanel
              setShowApiModal={setShowApiModal}
              hasApiKey={hasApiKey}
              apiKey={apiKey}
              setApiKey={setApiKey}
              saveStatus={saveStatus}
              savingKey={savingKey}
              deletingKey={deletingKey}
              saveApiKey={saveApiKey}
              deleteApiKey={deleteApiKey}
              lastSuccessfulSync={lastSuccessfulSync}
              autoRefresh={autoRefresh}
              showHowItWorks={showHowItWorks}
              setShowHowItWorks={setShowHowItWorks}
            />
          )}

          <div className="mt-2 text-[10px] text-(--text-tertiary) text-right">
            {autoRefresh && 'Auto-refresh enabled • Syncing every minute'}
          </div>
        </CardContent>
      </Card>

      {/* API Key Management Modal for Mobile */}
      <ApiKeyModal
        showApiModal={showApiModal}
        setShowApiModal={setShowApiModal}
        apiKey={apiKey}
        setApiKey={setApiKey}
        hasApiKey={hasApiKey}
        saveStatus={saveStatus}
        savingKey={savingKey}
        deletingKey={deletingKey}
        saveApiKey={saveApiKey}
        deleteApiKey={deleteApiKey}
        lastSuccessfulSync={lastSuccessfulSync}
        autoRefresh={autoRefresh}
      />
    </div>
  )
}
