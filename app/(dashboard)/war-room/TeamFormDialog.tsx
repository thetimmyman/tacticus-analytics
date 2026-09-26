'use client'

import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Input, Label, Textarea } from '@tacticus/ui-kit'
import {
  RadixDialog,
  RadixDialogContent,
  RadixDialogDescription,
  RadixDialogFooter,
  RadixDialogHeader,
  RadixDialogTitle
} from '@tacticus/ui-kit/radix-dialog'
import {
  RadixSelect,
  RadixSelectContent,
  RadixSelectGroup,
  RadixSelectItem,
  RadixSelectLabel,
  RadixSelectTrigger,
  RadixSelectValue
} from '@tacticus/ui-kit/radix-select'
import type { HeroCatalog } from '@/app/lib/catalogs'
import type {
  HeroRole,
  MetaTeam,
  MetaTeamHero,
  TeamPayload,
  WarSide
} from './types'

const MAX_HEROES = 15
const ROLES: HeroRole[] = ['core', 'flex', 'mow']

interface TeamFormDialogProps {
  team: MetaTeam | null
  catalog: HeroCatalog | undefined
  onOpenChange: (open: boolean) => void
  onSave: (payload: TeamPayload) => Promise<void>
}

export default function TeamFormDialog({
  team,
  catalog,
  onOpenChange,
  onSave
}: TeamFormDialogProps) {
  const [name, setName] = useState(team?.name ?? '')
  const [side, setSide] = useState<WarSide>(team?.side ?? 'offense')
  const [priority, setPriority] = useState(
    team?.priority != null ? String(team.priority) : ''
  )
  const [notes, setNotes] = useState(team?.notes ?? '')
  const [heroes, setHeroes] = useState<MetaTeamHero[]>(team?.heroes ?? [])
  const [heroToAdd, setHeroToAdd] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const availableHeroes = useMemo(() => {
    const selected = new Set(heroes.map((hero) => hero.unitId))
    return (catalog?.getAll() ?? [])
      .filter((hero) => !selected.has(hero.unitId))
      .sort((a, b) => {
        const aIsMow = a.category === 'mow'
        const bIsMow = b.category === 'mow'
        if (aIsMow !== bIsMow) return aIsMow ? 1 : -1
        return a.displayName.localeCompare(b.displayName)
      })
  }, [catalog, heroes])

  const regularHeroes = availableHeroes.filter(
    (hero) => hero.category !== 'mow'
  )
  const machinesOfWar = availableHeroes.filter(
    (hero) => hero.category === 'mow'
  )

  function addHero(unitId: string) {
    if (!unitId || heroes.length >= MAX_HEROES) return
    const hero = catalog?.getById(unitId)
    const role: HeroRole = hero?.category === 'mow' ? 'mow' : 'flex'
    setHeroes((current) => [...current, { unitId, role }])
  }

  function setHeroRole(unitId: string, role: HeroRole) {
    setHeroes((current) =>
      current.map((hero) => (hero.unitId === unitId ? { ...hero, role } : hero))
    )
  }

  function removeHero(unitId: string) {
    setHeroes((current) => current.filter((hero) => hero.unitId !== unitId))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName || heroes.length === 0) return

    const parsedPriority = priority === '' ? null : Number(priority)
    if (
      parsedPriority !== null &&
      (!Number.isInteger(parsedPriority) ||
        parsedPriority < 1 ||
        parsedPriority > 99)
    ) {
      setSaveError('Priority must be from 1 to 99.')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await onSave({
        name: trimmedName,
        side,
        priority: parsedPriority,
        notes: notes.trim() || null,
        heroes
      })
      onOpenChange(false)
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save shared team'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <RadixDialog open onOpenChange={onOpenChange}>
      <RadixDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">
          <RadixDialogHeader>
            <RadixDialogTitle>
              {team ? 'Edit shared team' : 'New shared team'}
            </RadixDialogTitle>
            <RadixDialogDescription className="sr-only">
              {team
                ? 'Update a guild War Room team.'
                : 'Create a guild War Room team.'}
            </RadixDialogDescription>
          </RadixDialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="war-room-team-name">Team name</Label>
              <Input
                id="war-room-team-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ork swarm"
                maxLength={80}
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Side</Label>
              <RadixSelect
                value={side}
                onValueChange={(value) => setSide(value as WarSide)}
              >
                <RadixSelectTrigger aria-label="Team side">
                  <RadixSelectValue />
                </RadixSelectTrigger>
                <RadixSelectContent>
                  <RadixSelectItem value="offense">Offense</RadixSelectItem>
                  <RadixSelectItem value="defense">Defense</RadixSelectItem>
                </RadixSelectContent>
              </RadixSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="war-room-team-priority">Priority</Label>
              <Input
                id="war-room-team-priority"
                type="number"
                min={1}
                max={99}
                step={1}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                placeholder="Not prioritized"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="war-room-team-notes">Notes</Label>
              <Textarea
                id="war-room-team-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
                rows={3}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="war-room-add-hero">Heroes</Label>
              <span className="text-xs tabular-nums text-[var(--text-tertiary)]">
                {heroes.length}/{MAX_HEROES}
              </span>
            </div>

            {heroes.length > 0 ? (
              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {heroes.map((hero) => {
                  const heroName =
                    catalog?.getById(hero.unitId)?.displayName ?? hero.unitId
                  return (
                    <div
                      key={hero.unitId}
                      className="flex items-center gap-2 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] p-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                        {heroName}
                      </span>
                      <RadixSelect
                        value={hero.role}
                        onValueChange={(value) =>
                          setHeroRole(hero.unitId, value as HeroRole)
                        }
                      >
                        <RadixSelectTrigger
                          className="w-28"
                          aria-label={`Role for ${heroName}`}
                        >
                          <RadixSelectValue />
                        </RadixSelectTrigger>
                        <RadixSelectContent>
                          {ROLES.map((role) => (
                            <RadixSelectItem key={role} value={role}>
                              {role === 'mow' ? 'MoW' : role}
                            </RadixSelectItem>
                          ))}
                        </RadixSelectContent>
                      </RadixSelect>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-[var(--text-tertiary)] hover:text-red-500"
                        onClick={() => removeHero(hero.unitId)}
                        aria-label={`Remove ${heroName}`}
                        title={`Remove ${heroName}`}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-[var(--card-border)] px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
                No heroes selected
              </div>
            )}

            {availableHeroes.length > 0 ? (
              <RadixSelect
                value={heroToAdd}
                onValueChange={(unitId) => {
                  addHero(unitId)
                  setHeroToAdd('')
                }}
              >
                <RadixSelectTrigger id="war-room-add-hero">
                  <RadixSelectValue placeholder="Add hero" />
                </RadixSelectTrigger>
                <RadixSelectContent>
                  {regularHeroes.length > 0 ? (
                    <RadixSelectGroup>
                      <RadixSelectLabel>Heroes</RadixSelectLabel>
                      {regularHeroes.map((hero) => (
                        <RadixSelectItem key={hero.unitId} value={hero.unitId}>
                          {hero.displayName}
                        </RadixSelectItem>
                      ))}
                    </RadixSelectGroup>
                  ) : null}
                  {machinesOfWar.length > 0 ? (
                    <RadixSelectGroup>
                      <RadixSelectLabel>Machines of War</RadixSelectLabel>
                      {machinesOfWar.map((hero) => (
                        <RadixSelectItem key={hero.unitId} value={hero.unitId}>
                          {hero.displayName}
                        </RadixSelectItem>
                      ))}
                    </RadixSelectGroup>
                  ) : null}
                </RadixSelectContent>
              </RadixSelect>
            ) : null}
          </div>

          {saveError ? (
            <p role="alert" className="text-sm text-red-500">
              {saveError}
            </p>
          ) : null}

          <RadixDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={saving}
              loadingText="Saving..."
              disabled={!name.trim() || heroes.length === 0}
            >
              Save team
            </Button>
          </RadixDialogFooter>
        </form>
      </RadixDialogContent>
    </RadixDialog>
  )
}
