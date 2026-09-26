'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  RefreshCw,
  Key,
  Loader2,
  ExternalLink,
  Edit2,
  Check,
  X,
  BarChart3
} from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { dbClient } from '@/app/lib/db/client'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { useClusterContext } from '@/app/hooks/useClusterContext'
import {
  mergeRosterUnits,
  type RosterUnit
} from '@/app/(dashboard)/roster/utils/roster-helpers'
import { processUnits } from './_lib/process-units'
import { useHeroMappings } from './_lib/useHeroMappings'
import { useRosterFilters } from './_lib/useRosterFilters'
import { useRosterViewState } from './_lib/useRosterViewState'
import { RosterFilterBar } from './components/RosterFilterBar'
import { RosterPagination } from './components/RosterPagination'
import { RosterToolbar } from './components/RosterToolbar'
import { RosterUnitsView } from './components/RosterUnitsView'
import { MemberName } from '@/app/components/ui/MemberName'

interface RosterClientProps {
  hasApiKey: boolean
  playerName: string
  guildCode?: string
  tacticusShareUrl?: string
}

function safeExternalHttpUrl(value: string | undefined): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch {
    return ''
  }
}

export default function RosterClient({
  hasApiKey,
  playerName,
  guildCode,
  tacticusShareUrl: initialShareUrl
}: RosterClientProps) {
  const { userId } = useClusterContext()
  const [units, setUnits] = useState<RosterUnit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

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

  const [tacticusShareUrl, setTacticusShareUrl] = useState(() =>
    safeExternalHttpUrl(initialShareUrl)
  )
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlInput, setUrlInput] = useState(initialShareUrl || '')
  const [savingUrl, setSavingUrl] = useState(false)

  const fetchRoster = async () => {
    setLoading(true)
    setError(null)
    setErrorCode(null)

    try {
      const response = await fetch('/api/player/roster')
      const data = await response.json()

      if (!response.ok) {
        const errorMsg =
          typeof data.error === 'object' ? data.error?.message : data.error
        setError(errorMsg || 'Failed to fetch roster')
        setErrorCode(data.code || null)
        return
      }

      const mergedUnits = mergeRosterUnits(
        Array.isArray(data.units) ? data.units : [],
        Array.isArray(data.machinesOfWar) ? data.machinesOfWar : []
      )
      setUnits(mergedUnits)
    } catch {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasApiKey) {
      fetchRoster()
    } else {
      setLoading(false)
    }
  }, [hasApiKey])

  const handleSaveUrl = async () => {
    if (!userId) return

    const safeUrl = safeExternalHttpUrl(urlInput)
    if (urlInput && !safeUrl) {
      setError('Planner URL must be a valid HTTP or HTTPS URL')
      return
    }

    setSavingUrl(true)
    try {
      const supabase = dbClient()

      const { error } = await supabase
        .from(CURRENT_USER_PLAYER_MAPPING)
        .update({ tacticus_share_url: safeUrl || null })
        .eq('user_id', userId)
        .eq('is_current', true)

      if (error) throw error
      setTacticusShareUrl(safeUrl)
      setEditingUrl(false)
    } catch (err) {
      console.error('Failed to save URL:', err)
    } finally {
      setSavingUrl(false)
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

  if (!hasApiKey) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-[var(--text-primary)]">
          My Roster
        </h1>
        <div className="card-wh40k p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center">
              <Key className="h-8 w-8 text-amber-400" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            Player API Key Required
          </h2>
          <p className="text-[var(--text-secondary)] mb-6 max-w-md mx-auto">
            To view your roster, you need to configure your Player API key in
            your profile settings.
          </p>
          <Link href="/profile/edit">
            <Button>
              <Key className="h-4 w-4 mr-2" />
              Configure API Key
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-[var(--text-primary)]">
          My Roster
        </h1>
        <div className="card-wh40k p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)] mx-auto mb-4" />
          <p className="text-[var(--text-secondary)]">
            Loading roster from Tacticus...
          </p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-[var(--text-primary)]">
          My Roster
        </h1>
        <div className="card-wh40k p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            Failed to Load Roster
          </h2>
          <p className="text-[var(--text-secondary)] mb-2">{error}</p>
          {errorCode === 'NO_API_KEY' && (
            <Link href="/profile/edit" className="inline-block mt-4">
              <Button>
                <Key className="h-4 w-4 mr-2" />
                Configure API Key
              </Button>
            </Link>
          )}
          {errorCode !== 'NO_API_KEY' && (
            <Button onClick={fetchRoster} className="mt-4">
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)]">
            My Roster
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            <MemberName value={playerName} />
            &apos;s character collection
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {guildCode && (
            <Link
              href={`/player-stats?player=${encodeURIComponent(playerName)}&guild=${encodeURIComponent(guildCode)}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs sm:text-sm bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] rounded-md text-[var(--accent)] transition-colors"
            >
              <BarChart3 className="h-4 w-4" />
              My Stats
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
          {editingUrl ? (
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://tacticusplanner.com/..."
                className="input-wh40k text-sm w-56"
                disabled={savingUrl}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveUrl}
                disabled={savingUrl}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingUrl(false)
                  setUrlInput(tacticusShareUrl)
                }}
                disabled={savingUrl}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUrlInput(tacticusShareUrl)
                setEditingUrl(true)
              }}
              className="text-[var(--text-secondary)]"
              title={tacticusShareUrl ? 'Edit Planner URL' : 'Add Planner URL'}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={fetchRoster} variant="outline" size="sm">
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
