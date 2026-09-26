'use client'

import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  DragEvent
} from 'react'
import { dbClient } from '@/app/lib/db/client'
import { Card, CardContent } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import {
  Target,
  X,
  Sparkles,
  Save,
  RefreshCw,
  GripVertical,
  Info,
  GitCompare,
  ArrowRight
} from 'lucide-react'
import {
  buildAvatarFrameMap,
  resolveAvatarIconUrl
} from '@/app/lib/utils/avatar'
import {
  useActiveWar,
  useLiveZoneAssignments,
  useWarParticipation
} from '../_hooks/useWarZoneData'
import { useAvatarFrames } from '../_hooks/useWarLineups'
import LiveVsPlannedComparison from './LiveVsPlannedComparison'
import BattlefieldSelectorPanel from './BattlefieldSelectorPanel'
import ZonePlanningBoard from './ZonePlanningBoard'
import {
  BattlefieldLevel,
  GuildMember,
  WarZoneConfig
} from './zoneManagementShared'

interface ZoneManagementProps {
  guildCode: string
  userRole: string
  activeWarId?: string
  preferredBattlefieldLevel?: 1 | 2 | 3 | 4 | 5
}

export default function ZoneManagement({
  guildCode,
  userRole,
  preferredBattlefieldLevel
}: ZoneManagementProps) {
  const [zones, setZones] = useState<WarZoneConfig[]>([])
  const [assignments, setAssignments] = useState<Map<string, string[]>>(
    new Map()
  )
  const [guildMembers, setGuildMembers] = useState<GuildMember[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null)
  const [dragOverZone, setDragOverZone] = useState<string | null>(null)
  const [battlefieldLevel, setBattlefieldLevel] = useState<BattlefieldLevel>(
    preferredBattlefieldLevel || 3
  )
  // Once the user picks a tier, the async recommendation must not overwrite it.
  const userPickedLevelRef = useRef(false)
  const [savedBattlefieldLevel, setSavedBattlefieldLevel] =
    useState<BattlefieldLevel | null>(preferredBattlefieldLevel ?? null)
  const [activeTab, setActiveTab] = useState<'planning' | 'comparison'>(
    'planning'
  )
  const [useLiveLayout, setUseLiveLayout] = useState(false)
  const [showOnlySignedUp, setShowOnlySignedUp] = useState(false)

  const supabase = useMemo(() => dbClient(), [])
  const canManage = userRole === 'leader' || userRole === 'officer'

  const { data: activeWar } = useActiveWar(guildCode)
  const { data: liveZones = [] } = useLiveZoneAssignments(
    guildCode,
    activeWar?.war_id
  )
  const { data: warParticipants = [] } = useWarParticipation(
    guildCode,
    activeWar?.war_id
  )
  const { data: avatarFrames = [] } = useAvatarFrames()

  const defenseLiveZones = useMemo(
    () =>
      liveZones.filter(
        (zone) => zone.zone_number >= 1 && zone.zone_number <= 15
      ),
    [liveZones]
  )

  const avatarFrameMap = useMemo(
    () => buildAvatarFrameMap(avatarFrames),
    [avatarFrames]
  )

  const signedUpPlayerNames = useMemo(() => {
    const names = new Set<string>()
    warParticipants.forEach((p) => {
      if (p.opted_in && p.display_name) names.add(p.display_name)
    })
    return names
  }, [warParticipants])

  const eligibleMembers = useMemo(() => {
    if (!showOnlySignedUp || signedUpPlayerNames.size === 0) return guildMembers
    return guildMembers.filter((m) => signedUpPlayerNames.has(m.display_name))
  }, [guildMembers, showOnlySignedUp, signedUpPlayerNames])

  const averagePlayerLevel = useMemo(() => {
    const membersWithLevel = guildMembers.filter(
      (m) => m.player_level && m.player_level > 0
    )
    if (membersWithLevel.length === 0) return 0
    const total = membersWithLevel.reduce(
      (sum, m) => sum + (m.player_level || 0),
      0
    )
    return Math.round(total / membersWithLevel.length)
  }, [guildMembers])

  const recommendedBattlefield = useMemo((): BattlefieldLevel => {
    if (averagePlayerLevel >= 70) return 5
    if (averagePlayerLevel >= 60) return 4
    if (averagePlayerLevel >= 50) return 3
    if (averagePlayerLevel >= 40) return 2
    return 1
  }, [averagePlayerLevel])

  const activeBattlefieldLevel = useMemo(() => {
    const level = (
      activeWar as unknown as { battlefield_level?: number | null } | null
    )?.battlefield_level
    if (typeof level === 'number' && level >= 1 && level <= 5) {
      return level as BattlefieldLevel
    }
    return null
  }, [activeWar])

  const defaultBattlefieldLevel = useMemo(() => {
    if (savedBattlefieldLevel) return savedBattlefieldLevel
    if (activeBattlefieldLevel) return activeBattlefieldLevel
    return recommendedBattlefield
  }, [activeBattlefieldLevel, recommendedBattlefield, savedBattlefieldLevel])

  const fetchZoneConfig = useCallback(async (bf: BattlefieldLevel = 3) => {
    try {
      const response = await fetch(`/api/war/zone-config?bf=${bf}`)
      if (!response.ok) throw new Error('Failed to fetch zone config')
      const data = await response.json()
      setZones(data.zones || [])
    } catch (err) {
      console.error('Error fetching zone config:', err)
      setError('Failed to load zone configuration')
    }
  }, [])

  useEffect(() => {
    if (
      preferredBattlefieldLevel &&
      preferredBattlefieldLevel >= 1 &&
      preferredBattlefieldLevel <= 5
    ) {
      setSavedBattlefieldLevel(preferredBattlefieldLevel)
    } else {
      setSavedBattlefieldLevel(null)
    }
  }, [preferredBattlefieldLevel])

  useEffect(() => {
    if (userPickedLevelRef.current) return
    setBattlefieldLevel(defaultBattlefieldLevel)
  }, [defaultBattlefieldLevel])

  useEffect(() => {
    fetchZoneConfig(battlefieldLevel)
  }, [battlefieldLevel, fetchZoneConfig])

  const fetchGuildMembers = useCallback(async () => {
    try {
      const { data, error } = await guildRosterQuery(
        supabase,
        guildCode,
        'display_name, role, player_level, avatar_unit_id'
      ).order('display_name')

      if (error) {
        if (
          error.message?.includes('column') &&
          error.message?.includes('does not exist')
        ) {
          const { data: fallbackData, error: fallbackError } =
            await guildRosterQuery(
              supabase,
              guildCode,
              'display_name, role'
            ).order('display_name')

          if (fallbackError) throw fallbackError
          setGuildMembers((fallbackData as unknown as GuildMember[]) || [])
          return
        }
        throw error
      }
      setGuildMembers((data as unknown as GuildMember[]) || [])
    } catch (err) {
      console.error('Error fetching guild members:', err)
    }
  }, [guildCode, supabase])

  const fetchSavedAssignments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('guild_war_zone_assignments')
        .select('zone_id, assigned_players')
        .eq('guild_code', guildCode)

      if (error && error.code !== 'PGRST116') throw error

      const assignmentMap = new Map<string, string[]>()
      ;(data || []).forEach((row) => {
        assignmentMap.set(row.zone_id, row.assigned_players || [])
      })
      setAssignments(assignmentMap)
    } catch (err) {
      console.error('Error fetching assignments:', err)
    }
  }, [guildCode, supabase])

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      await Promise.all([fetchGuildMembers(), fetchSavedAssignments()])
      setLoading(false)
    }
    loadData()
  }, [fetchGuildMembers, fetchSavedAssignments])

  const cleanupRanRef = useRef(false)
  useEffect(() => {
    if (cleanupRanRef.current) return
    if (guildMembers.length === 0 || assignments.size === 0) return

    const currentNames = new Set(
      guildMembers.map((m) => m.display_name).filter(Boolean)
    )
    let changed = false
    const cleaned = new Map<string, string[]>()
    assignments.forEach((players, zoneId) => {
      const filtered = players.filter((p) => currentNames.has(p))
      cleaned.set(zoneId, filtered)
      if (filtered.length !== players.length) changed = true
    })

    if (changed) {
      cleanupRanRef.current = true
      setAssignments(cleaned)
      const upsertData = Array.from(cleaned.entries()).map(
        ([zoneId, players]) => ({
          guild_code: guildCode,
          zone_id: zoneId,
          assigned_players: players,
          updated_at: new Date().toISOString()
        })
      )
      supabase
        .from('guild_war_zone_assignments')
        .upsert(upsertData as never, { onConflict: 'guild_code,zone_id' })
        .then(({ error }) => {
          if (error)
            console.error('Failed to persist cleaned zone assignments:', error)
        })
    }
  }, [guildMembers, assignments, guildCode, supabase])

  const saveAssignments = async () => {
    if (!canManage) return
    setSaving(true)
    try {
      const upsertData = Array.from(assignments.entries()).map(
        ([zoneId, players]) => ({
          guild_code: guildCode,
          zone_id: zoneId,
          assigned_players: players,
          updated_at: new Date().toISOString()
        })
      )

      const { error } = await supabase
        .from('guild_war_zone_assignments')
        .upsert(upsertData as never, { onConflict: 'guild_code,zone_id' })

      if (error) throw error
    } catch (err) {
      console.error('Error saving assignments:', err)
      setError('Failed to save assignments')
    } finally {
      setSaving(false)
    }
  }

  const getAssignedPlayers = (zoneId: string): string[] => {
    return assignments.get(zoneId) || []
  }

  const getAllAssignedPlayers = (): Set<string> => {
    const assigned = new Set<string>()
    assignments.forEach((players) => players.forEach((p) => assigned.add(p)))
    return assigned
  }

  const getPlayerLevel = (name: string): number => {
    const member = guildMembers.find((m) => m.display_name === name)
    return member?.player_level || 0
  }

  const getAvatarUrlFromId = (
    avatarUnitId: string | undefined
  ): string | undefined =>
    resolveAvatarIconUrl(avatarUnitId, avatarFrameMap) ?? undefined

  const getPlayerAvatarUrl = (name: string): string | undefined => {
    const member = guildMembers.find((m) => m.display_name === name)
    return getAvatarUrlFromId(member?.avatar_unit_id)
  }

  const handleDragStart = (
    e: DragEvent<HTMLDivElement>,
    playerName: string
  ) => {
    if (!canManage) return
    setDraggedPlayer(playerName)
    e.dataTransfer.setData('text/plain', playerName)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragEnd = () => {
    setDraggedPlayer(null)
    setDragOverZone(null)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>, zoneId: string) => {
    if (!canManage) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverZone(zoneId)
  }

  const handleDragLeave = () => {
    setDragOverZone(null)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>, zoneId: string) => {
    if (!canManage) return
    e.preventDefault()
    const playerName = e.dataTransfer.getData('text/plain')

    if (!playerName) return

    setAssignments((prev) => {
      const next = new Map(prev)

      prev.forEach((players, existingZoneId) => {
        if (players.includes(playerName)) {
          next.set(
            existingZoneId,
            players.filter((p) => p !== playerName)
          )
        }
      })

      const currentPlayers = next.get(zoneId) || []
      if (currentPlayers.length < 2 && !currentPlayers.includes(playerName)) {
        next.set(zoneId, [...currentPlayers, playerName])
      }

      return next
    })

    setDraggedPlayer(null)
    setDragOverZone(null)
  }

  const removePlayerFromZone = (zoneId: string, playerName: string) => {
    if (!canManage) return
    setAssignments((prev) => {
      const next = new Map(prev)
      const players = next.get(zoneId) || []
      next.set(
        zoneId,
        players.filter((p) => p !== playerName)
      )
      return next
    })
  }

  const clearAssignments = () => {
    if (!canManage) return
    setAssignments(new Map())
  }

  const generateAutoAssignments = () => {
    if (!canManage) return

    const sortedMembers = [...eligibleMembers].sort(
      (a, b) => (b.player_level || 0) - (a.player_level || 0)
    )

    const sortedZones = [...zones].sort(
      (a, b) => b.recommendedPower - a.recommendedPower
    )

    const newAssignments = new Map<string, string[]>()
    const usedPlayers = new Set<string>()

    sortedZones.forEach((zone) => {
      const availablePlayers = sortedMembers
        .filter((m) => !usedPlayers.has(m.display_name))
        .slice(0, 2)

      const assigned = availablePlayers.map((p) => p.display_name)
      assigned.forEach((p) => usedPlayers.add(p))
      newAssignments.set(zone.zoneId, assigned)
    })

    setAssignments(newAssignments)
  }

  const handleApplyLiveToPlanned = (zoneId: string, players: string[]) => {
    if (!canManage) return
    setAssignments((prev) => {
      const next = new Map(prev)
      next.set(zoneId, players)
      return next
    })
  }

  const handleApplyAllLiveToPlanned = () => {
    if (!canManage) return
    const newAssignments = new Map<string, string[]>()
    defenseLiveZones.forEach((zone) => {
      if (!zone.zone_type) return
      newAssignments.set(zone.zone_type, zone.assigned_players)
    })
    setAssignments(newAssignments)
  }

  const plannedZonesForComparison = useMemo(() => {
    return Array.from(assignments.entries()).map(
      ([zone_id, assigned_players]) => ({
        zone_id,
        assigned_players,
        updated_at: new Date().toISOString()
      })
    )
  }, [assignments])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
        <span className="ml-2 text-[var(--text-secondary)]">
          Loading zone configuration...
        </span>
      </div>
    )
  }

  if (zones.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Target className="h-12 w-12 text-[var(--text-secondary)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
            Zone Configuration Unavailable
          </h3>
          <p className="text-[var(--text-secondary)]">
            Unable to load war zone configuration from game data.
          </p>
        </CardContent>
      </Card>
    )
  }

  const displayedZones = (() => {
    if (!useLiveLayout || defenseLiveZones.length === 0) return zones

    const positionByType = new Map<string, number>()
    defenseLiveZones.forEach((zone) => {
      if (zone.zone_type && typeof zone.zone_number === 'number') {
        positionByType.set(zone.zone_type, zone.zone_number)
      }
    })

    return zones.map((zone) => {
      const position = positionByType.get(zone.zoneId)
      if (typeof position !== 'number' || position < 1) return zone

      const index = position - 1
      const row = Math.floor(index / 3)
      const column = index % 3
      return { ...zone, row, column }
    })
  })()

  const groupedByRow = displayedZones.reduce(
    (acc, zone) => {
      const rowKey = zone.row
      const rowGroup = acc[rowKey] ?? []
      rowGroup.push(zone)
      acc[rowKey] = rowGroup
      return acc
    },
    {} as Record<number, WarZoneConfig[]>
  )

  const assignedPlayersSet = getAllAssignedPlayers()
  const unassignedPlayers = eligibleMembers
    .filter((m) => !assignedPlayersSet.has(m.display_name))
    .sort((a, b) => (b.player_level || 0) - (a.player_level || 0))

  return (
    <div className="space-y-4">
      {error && (
        <div className="border border-red-500/30 bg-red-500/10 p-4 rounded-lg">
          <p className="text-red-400">{error}</p>
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="sm"
            className="mt-2"
          >
            Dismiss
          </Button>
        </div>
      )}

      <BattlefieldSelectorPanel
        battlefieldLevel={battlefieldLevel}
        setBattlefieldLevel={setBattlefieldLevel}
        userPickedLevelRef={userPickedLevelRef}
        recommendedBattlefield={recommendedBattlefield}
        averagePlayerLevel={averagePlayerLevel}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-[var(--text-primary)]">
            Zone Defense Setup
          </h2>
          <p className="text-xs md:text-sm text-[var(--text-secondary)]">
            {assignedPlayersSet.size}/{eligibleMembers.length} assigned
            {activeWar && (
              <span className="ml-2 text-green-400">
                vs {activeWar.opponent_guild_name || 'Unknown'}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {defenseLiveZones.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setActiveTab(
                  activeTab === 'planning' ? 'comparison' : 'planning'
                )
              }
              className="text-xs"
            >
              <GitCompare className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
              {activeTab === 'planning' ? 'Compare' : 'Plan'}
            </Button>
          )}
          {defenseLiveZones.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUseLiveLayout((v) => !v)}
              className={`text-xs ${useLiveLayout ? 'border-[color-mix(in_srgb,var(--accent)_50%,transparent)] text-[var(--accent)]' : ''}`}
              title="Reposition the planning grid to match live zone numbers"
            >
              <GripVertical className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
              Live Layout
            </Button>
          )}
          {canManage && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={clearAssignments}
                className="text-xs text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/60"
                title="Clear all zone assignments (use Auto or manually reassign, then Save)"
              >
                <X className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={generateAutoAssignments}
                className="text-xs"
              >
                <Sparkles className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                Auto
              </Button>
              <Button
                size="sm"
                onClick={saveAssignments}
                disabled={saving}
                className="text-xs"
              >
                <Save className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                {saving ? '...' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {defenseLiveZones.length > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <Info className="h-4 w-4 text-blue-400" />
          <span className="text-sm text-blue-400">
            {defenseLiveZones.length} defense zones synced with{' '}
            {
              defenseLiveZones.filter((z) => z.assigned_players.length > 0)
                .length
            }{' '}
            player assignments
          </span>
          {canManage &&
            defenseLiveZones.some((z) => z.assigned_players.length > 0) && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-blue-400 hover:text-blue-300"
                onClick={handleApplyAllLiveToPlanned}
              >
                <ArrowRight className="h-4 w-4 mr-1" />
                Apply All to Plan
              </Button>
            )}
        </div>
      )}

      {activeTab === 'comparison' && defenseLiveZones.length > 0 ? (
        <LiveVsPlannedComparison
          liveZones={defenseLiveZones}
          plannedZones={plannedZonesForComparison}
          onApplyLiveToPlanned={handleApplyLiveToPlanned}
          onApplyAllLiveToPlanned={handleApplyAllLiveToPlanned}
          canManage={canManage}
        />
      ) : (
        <ZonePlanningBoard
          guildCode={guildCode}
          canManage={canManage}
          groupedByRow={groupedByRow}
          unassignedPlayers={unassignedPlayers}
          signedUpPlayerNames={signedUpPlayerNames}
          showOnlySignedUp={showOnlySignedUp}
          setShowOnlySignedUp={setShowOnlySignedUp}
          draggedPlayer={draggedPlayer}
          dragOverZone={dragOverZone}
          getAssignedPlayers={getAssignedPlayers}
          getPlayerLevel={getPlayerLevel}
          getPlayerAvatarUrl={getPlayerAvatarUrl}
          getAvatarUrlFromId={getAvatarUrlFromId}
          handleDragStart={handleDragStart}
          handleDragEnd={handleDragEnd}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          removePlayerFromZone={removePlayerFromZone}
        />
      )}
    </div>
  )
}
