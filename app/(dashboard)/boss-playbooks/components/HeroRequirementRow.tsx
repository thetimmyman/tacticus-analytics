type HeroRequirement = {
  _id?: string
  hero_name: string
  min_rank: string | null
  min_rank_index: number | null
  min_ability_active: number | null
  min_ability_passive: number | null
  min_ability_mythic: number | null
  min_rarity: string | null
  min_stars: number | null
  notes?: string | null
}

type HeroRequirementRowProps = {
  value: HeroRequirement
  onChange: (next: HeroRequirement) => void
  onRemove: () => void
  rankOptions: Array<{ label: string; index: number }>
  rarityOptions: string[]
}

export function HeroRequirementRow({
  value,
  onChange,
  onRemove,
  rankOptions,
  rarityOptions
}: HeroRequirementRowProps) {
  const setField = <K extends keyof HeroRequirement>(
    key: K,
    nextValue: HeroRequirement[K]
  ) => {
    onChange({ ...value, [key]: nextValue })
  }

  return (
    <div className="grid gap-2 rounded-md border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.5fr_1fr_1fr]">
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Hero
          <input
            value={value.hero_name}
            onChange={(event) => setField('hero_name', event.target.value)}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            placeholder="Hero name"
          />
        </label>
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Min Rank
          <select
            value={value.min_rank ?? ''}
            onChange={(event) => {
              const label = event.target.value || null
              const selected =
                rankOptions.find((option) => option.label === label) || null
              setField('min_rank', label)
              setField('min_rank_index', selected?.index ?? null)
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value="">No minimum</option>
            {rankOptions.map((option) => (
              <option key={option.label} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Min Stars
          <input
            type="number"
            min={0}
            value={value.min_stars ?? ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              setField('min_stars', Number.isFinite(parsed) ? parsed : null)
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            placeholder="0"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Active Ability
          <input
            type="number"
            min={0}
            value={value.min_ability_active ?? ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              setField(
                'min_ability_active',
                Number.isFinite(parsed) ? parsed : null
              )
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            placeholder="0"
          />
        </label>
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Passive Ability
          <input
            type="number"
            min={0}
            value={value.min_ability_passive ?? ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              setField(
                'min_ability_passive',
                Number.isFinite(parsed) ? parsed : null
              )
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            placeholder="0"
          />
        </label>
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Mythic (MoW)
          <input
            type="number"
            min={0}
            max={4}
            value={value.min_ability_mythic ?? ''}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              setField(
                'min_ability_mythic',
                Number.isFinite(parsed) ? parsed : null
              )
            }}
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
            placeholder="0-4"
          />
        </label>
        <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
          Min Rarity
          <select
            value={value.min_rarity ?? ''}
            onChange={(event) =>
              setField('min_rarity', event.target.value || null)
            }
            className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value="">No minimum</option>
            {rarityOptions.map((rarity) => (
              <option key={rarity} value={rarity}>
                {rarity}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-[11px] text-[var(--text-tertiary)] space-y-1">
        Notes
        <input
          value={value.notes ?? ''}
          onChange={(event) => setField('notes', event.target.value || null)}
          className="w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
          placeholder="Optional notes"
        />
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] text-red-300 hover:text-red-200"
        >
          Remove hero
        </button>
      </div>
    </div>
  )
}

export type { HeroRequirement }
