'use client'

import { memo, useState } from 'react'
import { X, Edit2, Check } from 'lucide-react'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import { StarDisplayFromCount } from '@/app/components/StarDisplay'
import type { HeroRequirement } from './HeroRequirementRow'
import { abbreviateRank, formatAbilities } from './requirement-formatters'

type HeroRequirementCardProps = {
  value: HeroRequirement
  onChange: (next: HeroRequirement) => void
  onRemove: () => void
  rankOptions: Array<{ label: string; index: number }>
  rarityOptions: string[]
  isEditing?: boolean
}

function HeroRequirementCard({
  value,
  onChange,
  onRemove,
  rankOptions,
  rarityOptions,
  isEditing: initialEditing = false
}: HeroRequirementCardProps) {
  const { data: heroCatalog } = useHeroCatalog()
  const [isEditing, setIsEditing] = useState(initialEditing)

  const resolved = resolveHeroPortrait(value.hero_name, heroCatalog)
  const displayName = resolved.displayName || 'Unknown Hero'
  const portraitUrl = resolved.portraitUrl
  const fallbackBadge = resolved.fallbackBadge || '?'

  const setField = <K extends keyof HeroRequirement>(
    key: K,
    nextValue: HeroRequirement[K]
  ) => {
    onChange({ ...value, [key]: nextValue })
  }

  if (isEditing) {
    return (
      <div className="rounded-lg border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {portraitUrl ? (
              <img
                src={portraitUrl}
                alt={displayName}
                className="h-8 w-8 rounded-full object-cover border border-[var(--card-border)]"
              />
            ) : (
              <div className="h-8 w-8 rounded-full bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-center text-xs font-bold text-[var(--text-tertiary)]">
                {fallbackBadge}
              </div>
            )}
            <input
              value={value.hero_name}
              onChange={(e) => setField('hero_name', e.target.value)}
              className="w-32 rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
              placeholder="Hero name"
            />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="p-1 text-[var(--accent)] hover:text-[color-mix(in_srgb,var(--accent)_80%,transparent)]"
              title="Done editing"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="p-1 text-red-400 hover:text-red-300"
              title="Remove hero"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
            <span>Min Rank</span>
            <select
              value={value.min_rank ?? ''}
              onChange={(e) => {
                const label = e.target.value || null
                const selected =
                  rankOptions.find((o) => o.label === label) || null
                onChange({
                  ...value,
                  min_rank: label,
                  min_rank_index: selected?.index ?? null
                })
              }}
              className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
            >
              <option value="">-</option>
              {rankOptions.map((opt) => (
                <option key={opt.label} value={opt.label}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
            <span>Stars</span>
            <input
              type="number"
              min={0}
              max={10}
              value={value.min_stars ?? ''}
              onChange={(e) => {
                const parsed = Number(e.target.value)
                setField('min_stars', Number.isFinite(parsed) ? parsed : null)
              }}
              className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
              placeholder="0"
            />
          </label>

          <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
            <span>Rarity</span>
            <select
              value={value.min_rarity ?? ''}
              onChange={(e) => setField('min_rarity', e.target.value || null)}
              className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
            >
              <option value="">-</option>
              {rarityOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
            <span>Active</span>
            <input
              type="number"
              min={0}
              value={value.min_ability_active ?? ''}
              onChange={(e) => {
                const parsed = Number(e.target.value)
                setField(
                  'min_ability_active',
                  Number.isFinite(parsed) ? parsed : null
                )
              }}
              className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
              placeholder="55"
            />
          </label>

          <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
            <span>Passive</span>
            <input
              type="number"
              min={0}
              value={value.min_ability_passive ?? ''}
              onChange={(e) => {
                const parsed = Number(e.target.value)
                setField(
                  'min_ability_passive',
                  Number.isFinite(parsed) ? parsed : null
                )
              }}
              className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
              placeholder="55"
            />
          </label>

          <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
            <span>Mythic</span>
            <input
              type="number"
              min={0}
              max={4}
              value={value.min_ability_mythic ?? ''}
              onChange={(e) => {
                const parsed = Number(e.target.value)
                setField(
                  'min_ability_mythic',
                  Number.isFinite(parsed) ? parsed : null
                )
              }}
              className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
              placeholder="0-4"
            />
          </label>
        </div>

        <label className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
          <span>Notes</span>
          <input
            value={value.notes ?? ''}
            onChange={(e) => setField('notes', e.target.value || null)}
            className="w-full rounded border border-[var(--card-border)] bg-[var(--bg-secondary)] px-1 py-0.5 text-[10px] text-[var(--text-primary)]"
            placeholder="Equipment, strategy notes..."
          />
        </label>
      </div>
    )
  }

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-2 hover:border-[var(--card-border-hover)] transition-colors">
      {/* Portrait */}
      {portraitUrl ? (
        <img
          src={portraitUrl}
          alt={displayName}
          className="h-10 w-10 rounded-full object-cover border-2 border-[var(--card-border)] flex-shrink-0"
        />
      ) : (
        <div className="h-10 w-10 rounded-full bg-[var(--card-bg)] border-2 border-[var(--card-border)] flex items-center justify-center text-sm font-bold text-[var(--text-tertiary)] flex-shrink-0">
          {fallbackBadge}
        </div>
      )}

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
            {displayName}
          </span>
          {value.min_stars != null && value.min_stars > 0 && (
            <StarDisplayFromCount stars={value.min_stars} size="sm" showLabel />
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]">
          {value.min_rank && (
            <span className="font-mono">{abbreviateRank(value.min_rank)}</span>
          )}
          {(value.min_ability_active != null ||
            value.min_ability_passive != null ||
            value.min_ability_mythic != null) && (
            <span className="font-mono">
              {formatAbilities(
                value.min_ability_active,
                value.min_ability_passive,
                value.min_ability_mythic
              )}
            </span>
          )}
        </div>
        {value.notes && (
          <div className="text-[9px] text-[var(--text-tertiary)] italic truncate mt-0.5">
            {value.notes}
          </div>
        )}
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--accent)]"
          title="Edit"
        >
          <Edit2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-[var(--text-tertiary)] hover:text-red-400"
          title="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

export default memo(HeroRequirementCard)
