'use client'

import { useState } from 'react'
import { CheckCircle2, Building2, Pencil, X, Check } from 'lucide-react'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import { StarDisplayFromCount } from '@/app/components/StarDisplay'
import { HeroRequirementRow, type HeroRequirement } from '../HeroRequirementRow'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import { abbreviateRank, formatAbilities } from '../requirement-formatters'
import { RANK_OPTIONS } from '@/app/lib/tacticus/ranks'
import {
  RARITY_OPTIONS,
  createHeroRequirement,
  type RequirementEntry
} from './requirements-shared'

function HeroCell({
  hero,
  heroCatalog
}: {
  hero: HeroRequirement
  heroCatalog: ReturnType<typeof useHeroCatalog>['data']
}) {
  const resolved = resolveHeroPortrait(hero.hero_name, heroCatalog)
  const displayName = resolved.displayName || '?'
  const portraitUrl = resolved.portraitUrl
  const fallbackBadge = resolved.fallbackBadge || '?'

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-1 min-w-0" title={displayName}>
        {portraitUrl ? (
          <img
            src={portraitUrl}
            alt={displayName}
            className="h-6 w-6 rounded-full object-cover border border-[var(--card-border)] flex-shrink-0"
          />
        ) : (
          <div className="h-6 w-6 rounded-full bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center text-[9px] font-bold text-[var(--text-tertiary)] flex-shrink-0">
            {fallbackBadge}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium text-[var(--text-primary)] truncate">
            {displayName}
          </div>
          <div className="flex items-center gap-1 text-[9px] text-[var(--text-tertiary)]">
            {hero.min_rank && (
              <span className="font-mono">{abbreviateRank(hero.min_rank)}</span>
            )}
            {hero.min_stars != null && hero.min_stars > 0 && (
              <StarDisplayFromCount stars={hero.min_stars} size="xs" />
            )}
            {(hero.min_ability_active != null ||
              hero.min_ability_passive != null) && (
              <span className="font-mono">
                {formatAbilities(
                  hero.min_ability_active,
                  hero.min_ability_passive
                )}
              </span>
            )}
          </div>
        </div>
      </div>
      {hero.notes && (
        <div
          className="text-[9px] text-[var(--text-tertiary)] italic pl-7 truncate"
          title={hero.notes}
        >
          {hero.notes}
        </div>
      )}
    </div>
  )
}

export function RequirementDisplayRow({
  requirement,
  heroCatalog,
  scopeLabel,
  scopeColor,
  onEdit,
  isActive
}: {
  requirement: RequirementEntry
  heroCatalog: ReturnType<typeof useHeroCatalog>['data']
  scopeLabel: string
  scopeColor: 'amber' | 'blue' | 'gray'
  onEdit?: () => void
  isActive?: boolean
}) {
  const heroes = requirement.hero_requirements || []
  const regularHeroes = heroes.slice(0, 5)
  const mow = heroes.length > 5 ? heroes[5] : null

  const colorClasses = {
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    gray: 'bg-gray-500/10 text-gray-400 border-gray-500/20'
  }

  return (
    <tr
      className={`border-b border-[var(--card-border)] hover:bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] ${isActive ? 'bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] border-l-2 border-l-[var(--accent)]' : ''}`}
    >
      <td className="py-2 px-2">
        <span
          className={`px-1.5 py-0.5 text-[9px] rounded border ${colorClasses[scopeColor]}`}
        >
          {scopeLabel}
        </span>
      </td>
      <td className="py-2 px-2">
        <div className="flex items-center gap-1.5">
          <MultipleCategoryBadges
            categories={
              requirement.team_name ? [requirement.team_name] : ['Unknown']
            }
          />
          {requirement.is_verified && (
            <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
          )}
        </div>
        {requirement.overall_notes && (
          <div
            className="text-[9px] text-[var(--text-tertiary)] italic mt-0.5 truncate max-w-[150px]"
            title={requirement.overall_notes}
          >
            {requirement.overall_notes}
          </div>
        )}
      </td>
      {[0, 1, 2, 3, 4].map((idx) => (
        <td key={`hero-slot-${idx}`} className="py-2 px-1">
          {regularHeroes[idx] ? (
            <HeroCell hero={regularHeroes[idx]!} heroCatalog={heroCatalog} />
          ) : (
            <span className="text-[9px] text-[var(--text-tertiary)]">-</span>
          )}
        </td>
      ))}
      <td className="py-2 px-1">
        {mow ? (
          <HeroCell hero={mow} heroCatalog={heroCatalog} />
        ) : (
          <span className="text-[9px] text-[var(--text-tertiary)]">-</span>
        )}
      </td>
      <td className="py-2 px-1">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent)] transition-colors"
            title="Edit requirements"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </td>
    </tr>
  )
}

export function RequirementEditRow({
  requirement,
  scopeLabel,
  scopeColor,
  onSave,
  onCancel,
  userGuildCode
}: {
  requirement: RequirementEntry
  scopeLabel: string
  scopeColor: 'amber' | 'blue' | 'gray'
  onSave: (updates: {
    hero_requirements: HeroRequirement[]
    overall_notes: string
    is_verified: boolean
    guild_specific: boolean
  }) => Promise<void>
  onCancel: () => void
  userGuildCode: string | null
}) {
  const [heroRequirements, setHeroRequirements] = useState<HeroRequirement[]>(
    requirement.hero_requirements || []
  )
  const [overallNotes, setOverallNotes] = useState(
    requirement.overall_notes || ''
  )
  const [isVerified, setIsVerified] = useState(Boolean(requirement.is_verified))
  const [isGuildSpecific, setIsGuildSpecific] = useState(
    Boolean(requirement.guild_code)
  )
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave({
        hero_requirements: heroRequirements,
        overall_notes: overallNotes,
        is_verified: isVerified,
        guild_specific: isGuildSpecific
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleRowChange = (index: number, next: HeroRequirement) => {
    setHeroRequirements((prev) =>
      prev.map((entry, idx) => (idx === index ? next : entry))
    )
  }

  const handleAddRow = () => {
    setHeroRequirements((prev) => [...prev, createHeroRequirement('')])
  }

  const colorClasses = {
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    gray: 'bg-gray-500/10 text-gray-400 border-gray-500/20'
  }

  return (
    <>
      <tr className="border-b border-[var(--card-border)] bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]">
        <td className="py-2 px-2">
          <span
            className={`px-1.5 py-0.5 text-[9px] rounded border ${colorClasses[scopeColor]}`}
          >
            {scopeLabel}
          </span>
        </td>
        <td className="py-2 px-2" colSpan={7}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <MultipleCategoryBadges
                categories={
                  requirement.team_name ? [requirement.team_name] : ['Unknown']
                }
              />
              <span className="text-[10px] text-[var(--text-tertiary)]">
                - Editing
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="p-1 text-green-500 hover:text-green-400 transition-colors disabled:opacity-50"
                title="Save changes"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving}
                className="p-1 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                title="Cancel editing"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </td>
      </tr>
      <tr className="border-b border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)]">
        <td colSpan={8} className="p-3">
          <div className="space-y-3">
            {/* Hero requirements */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                Hero Requirements
              </div>
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
              <button
                type="button"
                onClick={handleAddRow}
                className="text-xs text-[var(--accent)] hover:text-[color-mix(in_srgb,var(--accent)_80%,transparent)]"
              >
                + Add hero requirement
              </button>
            </div>

            {/* Overall notes */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] block mb-1">
                Overall Notes
              </label>
              <textarea
                value={overallNotes}
                onChange={(event) => setOverallNotes(event.target.value)}
                rows={2}
                className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] resize-y"
                placeholder="Strategy notes, equipment recommendations..."
              />
            </div>

            {/* Checkboxes */}
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
                    <Building2 className="h-3 w-3" />
                    Guild-only
                  </span>
                </label>
              )}
            </div>
          </div>
        </td>
      </tr>
    </>
  )
}
