'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  Sparkles,
  Users,
  BuildingComplex,
  Globe,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { useMetaTeams } from '@/app/hooks/useMetaTeams'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { HeroRequirementRow, type HeroRequirement } from './HeroRequirementRow'
import HeroRequirementCard from './HeroRequirementCard'
import RequirementCard from './RequirementCard'
import { extractErrorMessage } from '@/app/lib/utils/error-message'
import { RANK_OPTIONS } from '@/app/lib/tacticus/ranks'
import {
  RARITY_OPTIONS,
  parseTeamComposition,
  createHeroRequirement,
  type RaidTeam,
  type RequirementEntry
} from './min-requirements/requirements-shared'
import {
  RequirementDisplayRow,
  RequirementEditRow
} from './min-requirements/RequirementTableRows'
import { ReadOnlyRequirementsView } from './min-requirements/ReadOnlyRequirementsView'

type MinimumRequirementsEditorProps = {
  bossId: string
  canEdit: boolean
}

export function MinimumRequirementsEditor({
  bossId,
  canEdit
}: MinimumRequirementsEditorProps) {
  const { data: heroCatalog } = useHeroCatalog()
  const { metaTeams } = useMetaTeams()
  const [viewMode, setViewMode] = useState<'cards' | 'form'>('cards')
  const [requirements, setRequirements] = useState<RequirementEntry[]>([])
  const [guildRequirements, setGuildRequirements] = useState<
    RequirementEntry[]
  >([])
  const [userGuildCode, setUserGuildCode] = useState<string | null>(null)
  const [raidTeams, setRaidTeams] = useState<RaidTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedMetaTeamId, setSelectedMetaTeamId] = useState('')
  const [heroRequirements, setHeroRequirements] = useState<HeroRequirement[]>(
    []
  )
  const [overallNotes, setOverallNotes] = useState('')
  const [isVerified, setIsVerified] = useState(false)
  const [isGuildSpecific, setIsGuildSpecific] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSetupExpanded, setIsSetupExpanded] = useState(false)
  const [editingRequirementId, setEditingRequirementId] = useState<
    string | null
  >(null)

  const fetchRequirements = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [requirementsRes, teamsRes] = await Promise.all([
        fetch(`/api/playbooks/${bossId}/requirements`),
        fetch(`/api/playbooks/${bossId}/teams`)
      ])

      const requirementsPayload = await requirementsRes.json().catch(() => null)
      const teamsPayload = await teamsRes.json().catch(() => null)

      if (!requirementsRes.ok) {
        throw new Error(
          extractErrorMessage(
            requirementsPayload,
            'Failed to load requirements'
          )
        )
      }
      setRequirements(
        (requirementsPayload?.requirements as RequirementEntry[]) || []
      )
      setGuildRequirements(
        (requirementsPayload?.guild_requirements as RequirementEntry[]) || []
      )
      setUserGuildCode(requirementsPayload?.user_guild_code ?? null)

      if (teamsPayload?.rarity_teams) {
        const allTeams: RaidTeam[] = []
        for (const group of teamsPayload.rarity_teams) {
          if (group.teams) {
            for (const team of group.teams) {
              allTeams.push({ ...team, rarity_set: group.rarity_set })
            }
          }
        }
        setRaidTeams(allTeams)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load requirements'
      )
    } finally {
      setLoading(false)
    }
  }, [bossId])

  useEffect(() => {
    fetchRequirements()
  }, [fetchRequirements])

  const activeRequirement = useMemo(() => {
    if (!selectedMetaTeamId) return null
    // Guild-specific first, then cluster-wide.
    const guildReq = guildRequirements.find(
      (entry) => entry.meta_team_id === selectedMetaTeamId
    )
    if (guildReq) return guildReq
    return (
      requirements.find((entry) => entry.meta_team_id === selectedMetaTeamId) ??
      null
    )
  }, [requirements, guildRequirements, selectedMetaTeamId])

  const activeGuildRequirement = useMemo(() => {
    if (!selectedMetaTeamId) return null
    return (
      guildRequirements.find(
        (entry) => entry.meta_team_id === selectedMetaTeamId
      ) ?? null
    )
  }, [guildRequirements, selectedMetaTeamId])

  const activeClusterRequirement = useMemo(() => {
    if (!selectedMetaTeamId) return null
    return (
      requirements.find((entry) => entry.meta_team_id === selectedMetaTeamId) ??
      null
    )
  }, [requirements, selectedMetaTeamId])

  const matchingRaidTeams = useMemo(() => {
    if (!selectedMetaTeamId) return []
    const selectedTeam = metaTeams.find((t) => t.id === selectedMetaTeamId)
    if (!selectedTeam) return []
    return raidTeams.filter(
      (rt) =>
        rt.meta_team === selectedTeam.team_name ||
        rt.meta_team_id === selectedMetaTeamId
    )
  }, [selectedMetaTeamId, metaTeams, raidTeams])

  const allDisplayRequirements = useMemo(() => {
    const display: Array<{
      requirement: RequirementEntry
      scopeLabel: string
      scopeColor: 'amber' | 'blue' | 'gray'
    }> = []
    for (const r of guildRequirements) {
      display.push({ requirement: r, scopeLabel: 'Guild', scopeColor: 'amber' })
    }
    for (const r of requirements) {
      display.push({
        requirement: r,
        scopeLabel: 'Cluster',
        scopeColor: 'blue'
      })
    }
    return display
  }, [guildRequirements, requirements])

  useEffect(() => {
    if (!selectedMetaTeamId) {
      setHeroRequirements([])
      setOverallNotes('')
      setIsVerified(false)
      setIsGuildSpecific(false)
      return
    }
    if (activeRequirement) {
      setHeroRequirements(activeRequirement.hero_requirements || [])
      setOverallNotes(activeRequirement.overall_notes || '')
      setIsVerified(Boolean(activeRequirement.is_verified))
      setIsGuildSpecific(Boolean(activeRequirement.guild_code))
    } else {
      const selectedTeam = metaTeams.find((t) => t.id === selectedMetaTeamId)
      if (selectedTeam && selectedTeam.trigger_heroes.length > 0) {
        const autoFilled = selectedTeam.trigger_heroes.map(
          createHeroRequirement
        )
        setHeroRequirements(autoFilled)
      } else {
        setHeroRequirements([])
      }
      setOverallNotes('')
      setIsVerified(false)
      setIsGuildSpecific(false)
    }
  }, [activeRequirement, selectedMetaTeamId, metaTeams])

  const handleRowChange = (index: number, next: HeroRequirement) => {
    setHeroRequirements((prev) =>
      prev.map((entry, idx) => (idx === index ? next : entry))
    )
  }

  const handleAddRow = () => {
    setHeroRequirements((prev) => [...prev, createHeroRequirement('')])
  }

  const handlePopulateFromRaidTeam = (team: RaidTeam) => {
    const heroNames = parseTeamComposition(team.team_composition)
    if (heroNames.length === 0) return

    const existingNames = new Set(
      heroRequirements.map((h) => h.hero_name.toLowerCase())
    )
    const newHeroes = heroNames
      .filter((name) => !existingNames.has(name.toLowerCase()))
      .map(createHeroRequirement)

    if (newHeroes.length > 0) {
      setHeroRequirements((prev) => [...prev, ...newHeroes])
    }
  }

  const handleAutoFillFromMetaTeam = () => {
    const selectedTeam = metaTeams.find((t) => t.id === selectedMetaTeamId)
    if (!selectedTeam || selectedTeam.trigger_heroes.length === 0) return

    const existingNames = new Set(
      heroRequirements.map((h) => h.hero_name.toLowerCase())
    )
    const newHeroes = selectedTeam.trigger_heroes
      .filter((name) => !existingNames.has(name.toLowerCase()))
      .map(createHeroRequirement)

    if (newHeroes.length > 0) {
      setHeroRequirements((prev) => [...prev, ...newHeroes])
    }
  }

  const handleSave = async () => {
    if (!canEdit) return
    if (!selectedMetaTeamId) {
      setError('Select a meta team to save requirements.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const metaTeam = metaTeams.find((team) => team.id === selectedMetaTeamId)
      const response = await fetch(`/api/playbooks/${bossId}/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta_team_id: selectedMetaTeamId,
          team_name: metaTeam?.team_name ?? null,
          hero_requirements: heroRequirements,
          overall_notes: overallNotes,
          is_verified: isVerified,
          guild_specific: isGuildSpecific
        })
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to save requirements')
      }
      await fetchRequirements()
      setEditingRequirementId(null)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save requirements'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const selectedMetaTeam = metaTeams.find((t) => t.id === selectedMetaTeamId)

  if (!canEdit) {
    return (
      <ReadOnlyRequirementsView
        loading={loading}
        error={error}
        allDisplayRequirements={allDisplayRequirements}
        heroCatalog={heroCatalog}
      />
    )
  }
  const hasTriggerHeroes =
    selectedMetaTeam && selectedMetaTeam.trigger_heroes.length > 0

  return (
    <div className="card-wh40k p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <ClipboardList className="h-4 w-4 text-[var(--accent)]" />
          Minimum Viable Team Requirements
        </div>
        {heroRequirements.length > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-2 py-1 text-[10px] rounded ${viewMode === 'cards' ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('form')}
              className={`px-2 py-1 text-[10px] rounded ${viewMode === 'form' ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--accent)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
            >
              Form
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="text-xs text-[var(--text-tertiary)]">
          Loading requirements...
        </div>
      )}
      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Read-only display of all saved requirements */}
      {!loading && allDisplayRequirements.length > 0 && (
        <>
          {/* Mobile: Card Layout */}
          <div className="md:hidden space-y-3">
            {allDisplayRequirements.map(
              ({ requirement, scopeLabel, scopeColor }) => (
                <RequirementCard
                  key={requirement.id}
                  requirement={requirement}
                  scopeLabel={scopeLabel}
                  scopeColor={scopeColor}
                  onEdit={() => setEditingRequirementId(requirement.id)}
                  isActive={
                    selectedMetaTeamId === requirement.meta_team_id ||
                    editingRequirementId === requirement.id
                  }
                />
              )
            )}
          </div>

          {/* Desktop: Table Layout */}
          <div className="hidden md:block overflow-x-auto -mx-4 px-4">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-[var(--card-border)] text-[10px] text-[var(--text-tertiary)]">
                  <th className="py-2 px-2 font-medium">Category</th>
                  <th className="py-2 px-2 font-medium">Meta Team</th>
                  <th className="py-2 px-1 font-medium">Hero 1</th>
                  <th className="py-2 px-1 font-medium">Hero 2</th>
                  <th className="py-2 px-1 font-medium">Hero 3</th>
                  <th className="py-2 px-1 font-medium">Hero 4</th>
                  <th className="py-2 px-1 font-medium">Hero 5</th>
                  <th className="py-2 px-1 font-medium">MOW</th>
                  <th className="py-2 px-1 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {allDisplayRequirements.map(
                  ({ requirement, scopeLabel, scopeColor }) =>
                    editingRequirementId === requirement.id ? (
                      <RequirementEditRow
                        key={requirement.id}
                        requirement={requirement}
                        scopeLabel={scopeLabel}
                        scopeColor={scopeColor}
                        onSave={async (updates) => {
                          if (!canEdit) return
                          setIsSaving(true)
                          setError(null)
                          try {
                            const response = await fetch(
                              `/api/playbooks/${bossId}/requirements`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  meta_team_id: requirement.meta_team_id,
                                  team_name: requirement.team_name,
                                  hero_requirements: updates.hero_requirements,
                                  overall_notes: updates.overall_notes,
                                  is_verified: updates.is_verified,
                                  guild_specific: updates.guild_specific
                                })
                              }
                            )
                            const payload = await response
                              .json()
                              .catch(() => null)
                            if (!response.ok) {
                              throw new Error(
                                payload?.error || 'Failed to save requirements'
                              )
                            }
                            await fetchRequirements()
                            setEditingRequirementId(null)
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : 'Failed to save requirements'
                            )
                          } finally {
                            setIsSaving(false)
                          }
                        }}
                        onCancel={() => setEditingRequirementId(null)}
                        userGuildCode={userGuildCode}
                      />
                    ) : (
                      <RequirementDisplayRow
                        key={requirement.id}
                        requirement={requirement}
                        heroCatalog={heroCatalog}
                        scopeLabel={scopeLabel}
                        scopeColor={scopeColor}
                        onEdit={() => setEditingRequirementId(requirement.id)}
                        isActive={
                          selectedMetaTeamId === requirement.meta_team_id
                        }
                      />
                    )
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Collapsible Setup Section */}
      <div className="border border-[var(--card-border)] rounded-md">
        <button
          type="button"
          onClick={() => setIsSetupExpanded(!isSetupExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] transition-colors"
        >
          <span>Setup Team Requirements</span>
          {isSetupExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>

        {isSetupExpanded && (
          <div className="px-3 pb-3 space-y-3 border-t border-[var(--card-border)]">
            {/* Show teams that already have requirements configured - sorted: Guild > Cluster */}
            {(guildRequirements.length > 0 || requirements.length > 0) && (
              <div className="flex flex-wrap gap-1 text-[10px] pt-3">
                {guildRequirements.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedMetaTeamId(r.meta_team_id || '')}
                    className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
                    title="Guild-specific"
                  >
                    {typeof r.team_name === 'string' ? r.team_name : 'Unknown'}
                  </button>
                ))}
                {requirements.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedMetaTeamId(r.meta_team_id || '')}
                    className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
                    title="Cluster-wide"
                  >
                    {typeof r.team_name === 'string' ? r.team_name : 'Unknown'}
                  </button>
                ))}
              </div>
            )}

            <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
              Meta Team
              <select
                value={selectedMetaTeamId}
                onChange={(event) => setSelectedMetaTeamId(event.target.value)}
                className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value="">Select a meta team</option>
                {metaTeams.map((team) => {
                  const hasRequirement =
                    requirements.some((r) => r.meta_team_id === team.id) ||
                    guildRequirements.some((r) => r.meta_team_id === team.id)
                  return (
                    <option key={team.id} value={team.id}>
                      {team.team_name}
                      {hasRequirement ? ' set' : ''}
                    </option>
                  )
                })}
              </select>
            </label>

            {/* Auto-fill actions */}
            {selectedMetaTeamId && (
              <div className="flex flex-wrap gap-2">
                {hasTriggerHeroes && (
                  <button
                    type="button"
                    onClick={handleAutoFillFromMetaTeam}
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] rounded border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  >
                    <Sparkles className="h-3 w-3" />
                    Auto-fill from {selectedMetaTeam?.team_name}
                  </button>
                )}
                {matchingRaidTeams.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      Populate from:
                    </span>
                    {matchingRaidTeams.slice(0, 3).map((team, idx) => (
                      <button
                        key={team.team_hash || idx}
                        type="button"
                        onClick={() => handlePopulateFromRaidTeam(team)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--card-border)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                        title={team.team_composition || 'Raid team'}
                      >
                        <Users className="h-3 w-3" />
                        {team.rarity_set || 'Team'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Hero requirements display */}
            {selectedMetaTeamId && (
              <>
                {viewMode === 'cards' ? (
                  <div className="space-y-2">
                    {heroRequirements.length === 0 && (
                      <div className="text-xs text-[var(--text-tertiary)]">
                        Add hero minimums for this team to override roster
                        strength thresholds.
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {heroRequirements.map((entry, index) => (
                        <HeroRequirementCard
                          key={entry._id || `hero-${index}`}
                          value={entry}
                          onChange={(next) => handleRowChange(index, next)}
                          onRemove={() =>
                            setHeroRequirements((prev) =>
                              prev.filter((_, idx) => idx !== index)
                            )
                          }
                          rankOptions={RANK_OPTIONS}
                          rarityOptions={RARITY_OPTIONS}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {heroRequirements.length === 0 && (
                      <div className="text-xs text-[var(--text-tertiary)]">
                        Add hero minimums for this team to override roster
                        strength thresholds.
                      </div>
                    )}
                    {heroRequirements.map((entry, index) => (
                      <HeroRequirementRow
                        key={entry._id || `hero-${index}`}
                        value={entry}
                        onChange={(next) => handleRowChange(index, next)}
                        onRemove={() =>
                          setHeroRequirements((prev) =>
                            prev.filter((_, idx) => idx !== index)
                          )
                        }
                        rankOptions={RANK_OPTIONS}
                        rarityOptions={RARITY_OPTIONS}
                      />
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAddRow}
                  className="text-xs text-[var(--accent)] hover:text-[color-mix(in_srgb,var(--accent)_80%,transparent)]"
                >
                  + Add hero requirement
                </button>

                <hr className="border-[var(--card-border)]" />

                <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
                  Overall Notes
                  <textarea
                    value={overallNotes}
                    onChange={(event) => setOverallNotes(event.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] resize-y"
                    placeholder="Strategy notes, equipment recommendations..."
                  />
                </label>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                    <input
                      type="checkbox"
                      checked={isVerified}
                      onChange={(event) => setIsVerified(event.target.checked)}
                      className="h-4 w-4 rounded border border-[var(--card-border)]"
                    />
                    Mark as verified
                  </label>

                  {userGuildCode && (
                    <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                      <input
                        type="checkbox"
                        checked={isGuildSpecific}
                        onChange={(event) =>
                          setIsGuildSpecific(event.target.checked)
                        }
                        className="h-4 w-4 rounded border border-[var(--card-border)]"
                      />
                      <span className="flex items-center gap-1">
                        <BuildingComplex className="h-3 w-3" />
                        Guild-only
                      </span>
                    </label>
                  )}
                </div>

                {/* Show indicator if editing guild-specific vs cluster-wide content */}
                {(activeGuildRequirement || activeClusterRequirement) && (
                  <div className="flex items-center gap-2 text-[10px]">
                    {activeGuildRequirement && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <BuildingComplex className="h-3 w-3" />
                        Guild requirement exists
                      </span>
                    )}
                    {activeClusterRequirement && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Globe className="h-3 w-3" />
                        Cluster requirement exists
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!selectedMetaTeamId || isSaving}
                    className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)] disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {isSaving ? 'Saving...' : 'Save Requirements'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeRequirement) {
                        setHeroRequirements(
                          activeRequirement.hero_requirements || []
                        )
                        setOverallNotes(activeRequirement.overall_notes || '')
                        setIsVerified(Boolean(activeRequirement.is_verified))
                        setIsGuildSpecific(
                          Boolean(activeRequirement.guild_code)
                        )
                      } else {
                        const selectedTeam = metaTeams.find(
                          (t) => t.id === selectedMetaTeamId
                        )
                        if (
                          selectedTeam &&
                          selectedTeam.trigger_heroes.length > 0
                        ) {
                          setHeroRequirements(
                            selectedTeam.trigger_heroes.map(
                              createHeroRequirement
                            )
                          )
                        } else {
                          setHeroRequirements([])
                        }
                        setOverallNotes('')
                        setIsVerified(false)
                        setIsGuildSpecific(false)
                      }
                    }}
                    disabled={!selectedMetaTeamId || isSaving}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--card-border)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--card-border-hover)] disabled:opacity-50"
                  >
                    Discard Changes
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
