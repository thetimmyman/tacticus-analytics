'use client'

import { memo } from 'react'
import { CheckCircle2, BuildingComplex, Globe, Pencil } from 'lucide-react'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import { StarDisplayFromCount } from '@/app/components/StarDisplay'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import type { HeroRequirement } from './HeroRequirementRow'
import { abbreviateRank, formatAbilities } from './requirement-formatters'

type RequirementEntry = {
  id: string
  boss_id: string
  difficulty: string | null
  meta_team_id: string | null
  team_name: string | null
  hero_requirements: HeroRequirement[]
  overall_notes: string | null
  is_verified: boolean
  updated_at?: string | null
  guild_code?: string | null
  cluster_code?: string | null
}

type RequirementCardProps = {
  requirement: RequirementEntry
  scopeLabel: string
  scopeColor: 'amber' | 'blue' | 'gray'
  onEdit?: () => void
  isActive?: boolean
}

function HeroCardCell({ hero }: { hero: HeroRequirement }) {
  const { data: heroCatalog } = useHeroCatalog()
  const resolved = resolveHeroPortrait(hero.hero_name, heroCatalog)
  const displayName = resolved.displayName || '?'
  const portraitUrl = resolved.portraitUrl
  const fallbackBadge = resolved.fallbackBadge || '?'

  const hasStats =
    hero.min_rank ||
    hero.min_stars ||
    hero.min_ability_active != null ||
    hero.min_ability_passive != null

  return (
    <div className="flex items-center gap-2 p-1.5 rounded-md bg-[color-mix(in_srgb,var(--bg-secondary)_50%,transparent)] border border-card-border/50">
      {portraitUrl ? (
        <img
          src={portraitUrl}
          alt={displayName}
          className="h-8 w-8 rounded-full object-cover border border-(--card-border) shrink-0"
        />
      ) : (
        <div className="h-8 w-8 rounded-full bg-(--card-bg) border border-(--card-border) flex items-center justify-center text-[10px] font-bold text-(--text-tertiary) shrink-0">
          {fallbackBadge}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-medium text-primary-wh40k truncate"
          title={displayName}
        >
          {displayName}
        </div>
        {hasStats && (
          <div className="flex items-center gap-1.5 text-[9px] text-(--text-tertiary) flex-wrap">
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
                  hero.min_ability_passive,
                  hero.min_ability_mythic
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RequirementCard({
  requirement,
  scopeLabel,
  scopeColor,
  onEdit,
  isActive
}: RequirementCardProps) {
  const heroes = requirement.hero_requirements || []
  const regularHeroes = heroes.slice(0, 5)
  const mow = heroes.length > 5 ? heroes[5] : null

  const colorClasses = {
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    gray: 'bg-gray-500/10 text-gray-400 border-gray-500/20'
  }

  const scopeIcon =
    scopeColor === 'amber' ? (
      <BuildingComplex className="h-3 w-3" />
    ) : (
      <Globe className="h-3 w-3" />
    )

  return (
    <div
      className={`rounded-lg border p-3 space-y-3 transition-colors ${
        isActive
          ? 'border-accent-wh40k bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]'
          : 'border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_30%,transparent)] hover:border-(--card-border-hover)'
      }`}
    >
      {/* Header: Scope + Team Name + Verified + Edit */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-sm border ${colorClasses[scopeColor]}`}
            >
              {scopeIcon}
              {scopeLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <MultipleCategoryBadges
                categories={
                  requirement.team_name ? [requirement.team_name] : ['Unknown']
                }
              />
              {requirement.is_verified && (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              )}
            </div>
          </div>
          {requirement.overall_notes && (
            <div
              className="text-[10px] text-(--text-tertiary) italic mt-1.5 line-clamp-2"
              title={requirement.overall_notes}
            >
              {requirement.overall_notes}
            </div>
          )}
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 text-(--text-tertiary) hover:text-(--accent) transition-colors rounded-md hover:bg-(--bg-secondary)"
            title="Edit requirements"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Heroes Grid */}
      <div className="space-y-2">
        {/* Regular Heroes */}
        {regularHeroes.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5">
            {regularHeroes.map((hero, idx) => (
              <HeroCardCell key={hero._id || `hero-${idx}`} hero={hero} />
            ))}
          </div>
        )}

        {/* MOW (if present) */}
        {mow && (
          <div className="pt-1.5 border-t border-card-border/50">
            <div className="text-[9px] uppercase tracking-wide text-(--text-tertiary) mb-1">
              Machine of War
            </div>
            <HeroCardCell hero={mow} />
          </div>
        )}

        {/* Empty state */}
        {regularHeroes.length === 0 && !mow && (
          <div className="text-[10px] text-(--text-tertiary) italic text-center py-2">
            No hero requirements defined
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(RequirementCard)
