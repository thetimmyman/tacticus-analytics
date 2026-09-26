'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { Badge } from '@tacticus/ui-kit'
import { Input } from '@tacticus/ui-kit'
import { Textarea } from '@tacticus/ui-kit/textarea'
import {
  RadixDialog,
  RadixDialogContent,
  RadixDialogHeader,
  RadixDialogTitle,
  RadixDialogClose
} from '@tacticus/ui-kit/radix-dialog'
import {
  RadixSelect,
  RadixSelectContent,
  RadixSelectItem,
  RadixSelectTrigger,
  RadixSelectValue
} from '@tacticus/ui-kit/radix-select'
import {
  Shield,
  Sword,
  Plus,
  X,
  Save,
  Trash2,
  Search,
  Users,
  Cog,
  Edit2,
  AlertCircle,
  Filter,
  ArrowUpDown,
  Check,
  Key
} from 'lucide-react'
import {
  type WarLineup,
  useWarLineups,
  useHeroMappings,
  usePlayerRoster,
  useUpsertLineup,
  useDeleteLineup,
  getRankName,
  getRankShortName,
  getRankColor,
  getRankBorderColor,
  FACTIONS,
  ALLIANCES
} from '../_hooks/useWarLineups'
import {
  buildHeroMappingMap,
  buildLineupSlots,
  enrichRoster,
  filterAndSortRoster,
  filterMachinesOfWar,
  getAbilityLevels,
  getStarTierFromProgressionIndex,
  type LineupSortDirection,
  type LineupSortField
} from './lineup-editor-model'

interface LineupEditorProps {
  guildCode: string
  lineupType: 'defensive' | 'offensive'
  maxLineups?: number
  notesPrompt: string
}

export default function LineupEditor({
  guildCode,
  lineupType,
  maxLineups,
  notesPrompt
}: LineupEditorProps) {
  const effectiveMaxLineups = maxLineups ?? 50
  const { data: lineups = [], isLoading: lineupsLoading } = useWarLineups(
    guildCode,
    lineupType
  )
  const { data: heroMappings = [], isLoading: heroesLoading } =
    useHeroMappings()
  const {
    data: roster = [],
    isLoading: rosterLoading,
    error: rosterError
  } = usePlayerRoster()
  const upsertMutation = useUpsertLineup()
  const deleteMutation = useDeleteLineup()

  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<{
    lineupName: string
    heroes: string[]
    machineOfWar: string | null
    notes: string
  }>({
    lineupName: '',
    heroes: [],
    machineOfWar: null,
    notes: ''
  })

  const [heroSearch, setHeroSearch] = useState('')
  const [mowSearch, setMowSearch] = useState('')
  const [factionFilter, setFactionFilter] = useState<string>('all')
  const [allianceFilter, setAllianceFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<LineupSortField>('rank')
  const [sortDirection, setSortDirection] =
    useState<LineupSortDirection>('desc')

  const heroMappingMap = useMemo(() => {
    return buildHeroMappingMap(heroMappings)
  }, [heroMappings])

  const enrichedRoster = useMemo(
    () => enrichRoster(roster, heroMappingMap),
    [roster, heroMappingMap]
  )

  const machinesOfWar = useMemo(
    () => heroMappings.filter((h) => h.category === 'MOW'),
    [heroMappings]
  )

  const filteredAndSortedRoster = useMemo(() => {
    return filterAndSortRoster(enrichedRoster, {
      search: heroSearch,
      faction: factionFilter,
      alliance: allianceFilter,
      sortField,
      sortDirection
    })
  }, [
    enrichedRoster,
    heroSearch,
    factionFilter,
    allianceFilter,
    sortField,
    sortDirection
  ])

  const filteredMoW = useMemo(() => {
    return filterMachinesOfWar(machinesOfWar, mowSearch)
  }, [machinesOfWar, mowSearch])

  const getHeroById = (unitId: string) => heroMappingMap.get(unitId)
  const getRosterUnit = (unitId: string) =>
    enrichedRoster.find((u) => u.id === unitId)

  const { lineupMap, slots } = useMemo(
    () => buildLineupSlots(lineups, effectiveMaxLineups),
    [lineups, effectiveMaxLineups]
  )

  const openEditor = (slotNumber: number) => {
    const existing = lineupMap.get(slotNumber)
    setEditForm({
      lineupName:
        existing?.lineup_name ||
        `${lineupType === 'defensive' ? 'Defense' : 'Offense'} ${slotNumber}`,
      heroes: existing?.heroes || [],
      machineOfWar: existing?.machine_of_war || null,
      notes: existing?.notes || ''
    })
    setEditingSlot(slotNumber)
    setHeroSearch('')
    setMowSearch('')
    setFactionFilter('all')
    setAllianceFilter('all')
  }

  const closeEditor = () => {
    setEditingSlot(null)
    setEditForm({ lineupName: '', heroes: [], machineOfWar: null, notes: '' })
  }

  const toggleHero = (unitId: string) => {
    if (editForm.heroes.includes(unitId)) {
      setEditForm((prev) => ({
        ...prev,
        heroes: prev.heroes.filter((h) => h !== unitId)
      }))
    } else if (editForm.heroes.length < 5) {
      setEditForm((prev) => ({ ...prev, heroes: [...prev.heroes, unitId] }))
    }
  }

  const setMoW = (unitId: string | null) => {
    setEditForm((prev) => ({ ...prev, machineOfWar: unitId }))
  }

  const saveLineup = async () => {
    if (editingSlot === null) return

    await upsertMutation.mutateAsync({
      guildCode,
      lineupType,
      slotNumber: editingSlot,
      lineupName:
        editForm.lineupName ||
        `${lineupType === 'defensive' ? 'Defense' : 'Offense'} ${editingSlot}`,
      heroes: editForm.heroes,
      machineOfWar: editForm.machineOfWar,
      notes: editForm.notes || null
    })
    closeEditor()
  }

  const deleteLineup = async (lineup: WarLineup) => {
    await deleteMutation.mutateAsync({
      id: lineup.id,
      guildCode,
      lineupType
    })
  }

  const isLoading = lineupsLoading || heroesLoading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-[var(--text-secondary)]">Loading lineups...</div>
      </div>
    )
  }

  const Icon = lineupType === 'defensive' ? Shield : Sword
  const hasRoster = roster.length > 0
  const noApiKey = rosterError?.message?.includes('API key')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {slots.map((slotNumber) => {
          const lineup = lineupMap.get(slotNumber)
          const isEmpty =
            !lineup || (lineup.heroes.length === 0 && !lineup.machine_of_war)

          return (
            <Card
              key={slotNumber}
              className={`relative transition-all hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)] cursor-pointer ${
                isEmpty
                  ? 'border-dashed border-card-border/20'
                  : 'border-[var(--border)]'
              }`}
              onClick={() => openEditor(slotNumber)}
            >
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`p-1.5 rounded ${
                        lineupType === 'defensive'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[100px]">
                      {lineup?.lineup_name || `Slot ${slotNumber}`}
                    </span>
                  </div>
                  <Edit2 className="h-3 w-3 text-[var(--text-secondary)]" />
                </div>

                {isEmpty ? (
                  <div className="text-center py-4">
                    <Plus className="h-6 w-6 text-[var(--text-tertiary)] mx-auto mb-1" />
                    <p className="text-[10px] text-[var(--text-tertiary)]">
                      Add Lineup
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {lineup?.heroes.map((heroId) => {
                        const hero = getHeroById(heroId)
                        const rosterUnit = getRosterUnit(heroId)
                        return (
                          <div
                            key={heroId}
                            className={`w-8 h-8 rounded-lg overflow-hidden bg-card/40 border-2 ${
                              rosterUnit
                                ? getRankBorderColor(rosterUnit.rank ?? 0)
                                : 'border-[var(--border)]'
                            }`}
                            title={`${hero?.display_name || heroId}${rosterUnit ? ` - ${getRankName(rosterUnit.rank ?? 0)}` : ''}`}
                          >
                            {hero?.web_icon_url ? (
                              <img
                                src={hero.web_icon_url}
                                alt={hero.display_name || heroId}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[8px] text-[var(--text-secondary)]">
                                {heroId.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {lineup?.heroes.length === 0 && (
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                          No heroes
                        </span>
                      )}
                    </div>

                    {lineup?.machine_of_war && (
                      <div className="flex items-center gap-1 pt-1 border-t border-[var(--border)]">
                        <Cog className="h-3 w-3 text-orange-400" />
                        <span className="text-[10px] text-[var(--text-secondary)] truncate">
                          {getHeroById(lineup.machine_of_war)?.display_name ||
                            lineup.machine_of_war}
                        </span>
                      </div>
                    )}

                    {lineup?.notes && (
                      <div className="pt-1 border-t border-[var(--border)]">
                        <p className="text-[9px] text-[var(--text-tertiary)] line-clamp-2">
                          {lineup.notes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <RadixDialog
        open={editingSlot !== null}
        onOpenChange={(open) => !open && closeEditor()}
      >
        <RadixDialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <RadixDialogHeader>
            <RadixDialogTitle className="flex items-center gap-2">
              <Icon
                className={`h-5 w-5 ${lineupType === 'defensive' ? 'text-blue-400' : 'text-red-400'}`}
              />
              Edit {lineupType === 'defensive' ? 'Defensive' : 'Offensive'}{' '}
              Lineup {editingSlot}
            </RadixDialogTitle>
          </RadixDialogHeader>

          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                Lineup Name
              </label>
              <Input
                value={editForm.lineupName}
                onChange={(e) =>
                  setEditForm((prev) => ({
                    ...prev,
                    lineupName: e.target.value
                  }))
                }
                placeholder="Give this lineup a name..."
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-[var(--text-primary)]">
                  <Users className="h-4 w-4 inline mr-1" />
                  Heroes from Your Roster ({editForm.heroes.length}/5)
                </label>
                {editForm.heroes.length >= 5 && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                    Max reached
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-2 min-h-[56px] p-3 bg-card/20 rounded-lg border border-[var(--border)]">
                {editForm.heroes.length === 0 ? (
                  <span className="text-sm text-[var(--text-tertiary)]">
                    Tap heroes below to add them
                  </span>
                ) : (
                  editForm.heroes.map((heroId) => {
                    const hero = getHeroById(heroId)
                    const rosterUnit = getRosterUnit(heroId)
                    const starTier = rosterUnit
                      ? getStarTierFromProgressionIndex(
                          rosterUnit.progressionIndex ?? 0
                        )
                      : null
                    const abilityLevels = rosterUnit
                      ? getAbilityLevels(rosterUnit)
                      : null
                    return (
                      <button
                        key={heroId}
                        onClick={() => toggleHero(heroId)}
                        className={`flex items-center gap-2 bg-[var(--bg-secondary)] px-2 py-1.5 rounded-lg border-2 transition-all hover:border-red-500/50 ${
                          rosterUnit
                            ? getRankBorderColor(rosterUnit.rank ?? 0)
                            : 'border-[var(--border)]'
                        }`}
                        title={
                          rosterUnit
                            ? `${hero?.display_name || heroId} • ${getRankName(rosterUnit.rank ?? 0)} (${getRankShortName(rosterUnit.rank ?? 0)}) • ${starTier} stars${
                                abilityLevels ? ` • Ab ${abilityLevels}` : ''
                              }`
                            : hero?.display_name || heroId
                        }
                      >
                        {hero?.web_icon_url && (
                          <img
                            src={hero.web_icon_url}
                            alt=""
                            className="w-7 h-7 rounded object-cover"
                          />
                        )}
                        <div className="text-left">
                          <span className="text-xs text-[var(--text-primary)] block">
                            {hero?.display_name || heroId}
                          </span>
                          {rosterUnit && (
                            <span className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1 flex-wrap">
                              <span
                                className={getRankColor(rosterUnit.rank ?? 0)}
                              >
                                {getRankShortName(rosterUnit.rank ?? 0)}
                              </span>
                              {starTier !== null && (
                                <>
                                  <span className="text-[var(--text-tertiary)]">
                                    •
                                  </span>
                                  <span className="text-[var(--text-tertiary)]">
                                    {starTier} stars
                                  </span>
                                </>
                              )}
                              {abilityLevels && (
                                <>
                                  <span className="text-[var(--text-tertiary)]">
                                    •
                                  </span>
                                  <span className="text-[var(--text-tertiary)]">
                                    Ab {abilityLevels}
                                  </span>
                                </>
                              )}
                            </span>
                          )}
                        </div>
                        <X className="h-3 w-3 text-red-400" />
                      </button>
                    )
                  })
                )}
              </div>

              {!hasRoster && (
                <div className="flex items-center gap-2 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                  <Key className="h-4 w-4 text-yellow-400" />
                  <p className="text-sm text-yellow-400">
                    {noApiKey
                      ? 'Configure your Player API key in Profile to see your roster heroes.'
                      : rosterLoading
                        ? 'Loading your roster...'
                        : 'Unable to load roster. You can still select heroes from the full list below.'}
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                  <Input
                    value={heroSearch}
                    onChange={(e) => setHeroSearch(e.target.value)}
                    placeholder="Search heroes..."
                    className="pl-9"
                  />
                </div>
                <div className="flex gap-2">
                  <RadixSelect
                    value={factionFilter}
                    onValueChange={setFactionFilter}
                  >
                    <RadixSelectTrigger className="w-[130px]">
                      <Filter className="h-3 w-3 mr-1" />
                      <RadixSelectValue placeholder="Faction" />
                    </RadixSelectTrigger>
                    <RadixSelectContent>
                      <RadixSelectItem value="all">
                        All Factions
                      </RadixSelectItem>
                      {FACTIONS.map((f) => (
                        <RadixSelectItem key={f} value={f}>
                          {f}
                        </RadixSelectItem>
                      ))}
                    </RadixSelectContent>
                  </RadixSelect>
                  <RadixSelect
                    value={allianceFilter}
                    onValueChange={setAllianceFilter}
                  >
                    <RadixSelectTrigger className="w-[110px]">
                      <RadixSelectValue placeholder="Alliance" />
                    </RadixSelectTrigger>
                    <RadixSelectContent>
                      <RadixSelectItem value="all">All</RadixSelectItem>
                      {ALLIANCES.map((a) => (
                        <RadixSelectItem key={a} value={a}>
                          {a}
                        </RadixSelectItem>
                      ))}
                    </RadixSelectContent>
                  </RadixSelect>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (sortField === 'rank') {
                        setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))
                      } else {
                        setSortField('rank')
                        setSortDirection('desc')
                      }
                    }}
                    className="px-2"
                    title="Sort by rank"
                  >
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="max-h-[250px] overflow-y-auto grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 p-2 bg-card/10 rounded-lg border border-[var(--border)]">
                {hasRoster
                  ? filteredAndSortedRoster.map((unit) => {
                      const isSelected = editForm.heroes.includes(unit.id)
                      const isDisabled =
                        editForm.heroes.length >= 5 && !isSelected
                      const starTier = getStarTierFromProgressionIndex(
                        unit.progressionIndex ?? 0
                      )
                      const abilityLevels = getAbilityLevels(unit)
                      return (
                        <button
                          key={unit.id}
                          onClick={() => !isDisabled && toggleHero(unit.id)}
                          disabled={isDisabled}
                          className={`
                          relative p-1 rounded-lg border-2 transition-all flex flex-col items-center
                          ${
                            isSelected
                              ? `ring-2 ring-[var(--accent)] ${getRankBorderColor(unit.rank ?? 0)}`
                              : `${getRankBorderColor(unit.rank ?? 0)} hover:ring-1 hover:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]`
                          }
                          ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                          bg-card/30
                        `}
                          title={`${unit.name ?? 'Unknown'} • ${getRankName(unit.rank ?? 0)} (${getRankShortName(unit.rank ?? 0)}) • ${starTier} stars${
                            abilityLevels ? ` • Ab ${abilityLevels}` : ''
                          } • ${unit.faction}`}
                        >
                          {isSelected && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent)] flex items-center justify-center z-10">
                              <Check className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                          <div className="w-10 h-10 rounded overflow-hidden bg-card/40">
                            {unit.heroMapping?.web_icon_url ? (
                              <img
                                src={unit.heroMapping.web_icon_url}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
                                {unit.id.slice(0, 2).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <span className="text-[8px] text-[var(--text-secondary)] truncate w-full text-center mt-0.5">
                            {unit.name}
                          </span>
                          <div className="flex flex-col items-center gap-0.5">
                            <span
                              className={`text-[7px] ${getRankColor(unit.rank ?? 0)}`}
                            >
                              {getRankShortName(unit.rank ?? 0)}{' '}
                              <span className="text-[var(--text-tertiary)]">
                                {starTier} stars
                              </span>
                            </span>
                            {abilityLevels && (
                              <span className="text-[7px] text-[var(--text-tertiary)]">
                                Ab {abilityLevels}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })
                  : heroMappings
                      .filter((h) => h.category === 'Hero')
                      .slice(0, 60)
                      .map((hero) => {
                        const isSelected = editForm.heroes.includes(
                          hero.unit_id
                        )
                        const isDisabled =
                          editForm.heroes.length >= 5 && !isSelected
                        return (
                          <button
                            key={hero.unit_id}
                            onClick={() =>
                              !isDisabled && toggleHero(hero.unit_id)
                            }
                            disabled={isDisabled}
                            className={`
                          relative p-1 rounded-lg border transition-all flex flex-col items-center
                          ${
                            isSelected
                              ? 'bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] border-[var(--accent)] ring-1 ring-[var(--accent)]'
                              : 'bg-card/20 border-[var(--border)] hover:border-[color-mix(in_srgb,var(--accent)_50%,transparent)]'
                          }
                          ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                            title={hero.display_name || hero.unit_id}
                          >
                            {isSelected && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent)] flex items-center justify-center z-10">
                                <Check className="h-2.5 w-2.5 text-white" />
                              </div>
                            )}
                            <div className="w-10 h-10 rounded overflow-hidden bg-card/40">
                              {hero.web_icon_url ? (
                                <img
                                  src={hero.web_icon_url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
                                  {hero.unit_id.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                            </div>
                            <span className="text-[8px] text-[var(--text-secondary)] truncate w-full text-center mt-0.5">
                              {hero.display_name || hero.unit_id}
                            </span>
                          </button>
                        )
                      })}
                {hasRoster && filteredAndSortedRoster.length === 0 && (
                  <div className="col-span-full text-center py-4 text-sm text-[var(--text-secondary)]">
                    No heroes match your filters
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                <Cog className="h-4 w-4 inline mr-1 text-orange-400" />
                Machine of War (Optional)
              </label>

              {editForm.machineOfWar && (
                <div className="flex items-center gap-2 p-2 bg-orange-500/10 rounded-lg border border-orange-500/30">
                  {getHeroById(editForm.machineOfWar)?.web_icon_url && (
                    <img
                      src={getHeroById(editForm.machineOfWar)!.web_icon_url!}
                      alt=""
                      className="w-8 h-8 rounded object-cover"
                    />
                  )}
                  <span className="text-sm text-[var(--text-primary)] flex-1">
                    {getHeroById(editForm.machineOfWar)?.display_name ||
                      editForm.machineOfWar}
                  </span>
                  <button
                    onClick={() => setMoW(null)}
                    className="p-1 hover:bg-red-500/20 rounded"
                  >
                    <X className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)]" />
                <Input
                  value={mowSearch}
                  onChange={(e) => setMowSearch(e.target.value)}
                  placeholder="Search machines of war..."
                  className="pl-9"
                />
              </div>

              <div className="max-h-[120px] overflow-y-auto grid grid-cols-4 sm:grid-cols-6 gap-2 p-2 bg-card/10 rounded-lg">
                {filteredMoW.map((mow) => {
                  const isSelected = editForm.machineOfWar === mow.unit_id
                  return (
                    <button
                      key={mow.unit_id}
                      onClick={() => setMoW(isSelected ? null : mow.unit_id)}
                      className={`
                        relative p-1 rounded-lg border transition-all flex flex-col items-center
                        ${
                          isSelected
                            ? 'bg-orange-500/20 border-orange-500 ring-1 ring-orange-500'
                            : 'bg-card/20 border-[var(--border)] hover:border-orange-500/50'
                        }
                      `}
                      title={mow.display_name || mow.unit_id}
                    >
                      {isSelected && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-orange-500 flex items-center justify-center z-10">
                          <Check className="h-2.5 w-2.5 text-white" />
                        </div>
                      )}
                      <div className="w-10 h-10 rounded overflow-hidden bg-card/40">
                        {mow.web_icon_url ? (
                          <img
                            src={mow.web_icon_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
                            {mow.unit_id.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <span className="text-[8px] text-[var(--text-secondary)] truncate w-full text-center mt-0.5">
                        {mow.display_name || mow.unit_id}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                <AlertCircle className="h-4 w-4 inline mr-1 text-[var(--accent)]" />
                Notes
              </label>
              <p className="text-xs text-[var(--text-secondary)]">
                {notesPrompt}
              </p>
              <Textarea
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder={notesPrompt}
                className="h-24"
              />
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
              {lineupMap.get(editingSlot!) ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    const lineup = lineupMap.get(editingSlot!)
                    if (lineup) {
                      deleteLineup(lineup)
                      closeEditor()
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              ) : (
                <div />
              )}

              <div className="flex gap-2">
                <RadixDialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </RadixDialogClose>
                <Button
                  onClick={saveLineup}
                  disabled={upsertMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {upsertMutation.isPending ? 'Saving...' : 'Save Lineup'}
                </Button>
              </div>
            </div>
          </div>
        </RadixDialogContent>
      </RadixDialog>
    </div>
  )
}
