'use client'

import { useCallback, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Film, Loader2, Pin, Play, Search, Star, X } from 'lucide-react'
import clsx from 'clsx'
import { HeroUnitPortrait } from '@/app/components/ui/HeroUnitPortrait'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { useHeroCatalog } from '@/app/lib/catalogs/heroes'
import { sortTeamUnitNamesForDisplay } from '@/app/lib/team-display-order'
import {
  CATALOG_SORTS,
  type CatalogSort,
  type CommunityReplay,
  type CommunityReplayFacets,
  type CommunityReplayFilters,
  type CommunityReplayPage
} from '@/app/lib/replays/community-replay-catalog-shared'

const formatDamage = (damage: number | null) => {
  if (damage === null) return null
  if (damage >= 1_000_000) return `${(damage / 1_000_000).toFixed(2)}M`
  if (damage >= 1_000) return `${(damage / 1_000).toFixed(1)}K`
  return String(damage)
}

function ReplayTeam({ units }: { units: string[] }) {
  const { data: catalog } = useHeroCatalog()
  const display = useMemo(
    () => sortTeamUnitNamesForDisplay(units, { catalog }),
    [catalog, units]
  )
  if (display.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {display.slice(0, 6).map((unit) => (
        <HeroUnitPortrait key={unit} unitName={unit} className="!h-7 !w-7" />
      ))}
    </div>
  )
}

function ReplayCard({ replay }: { replay: CommunityReplay }) {
  const damage = formatDamage(replay.damage)
  return (
    <article className="relative flex flex-col gap-3 rounded-lg border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-secondary)_70%,transparent)] p-3 hover:border-[color-mix(in_srgb,var(--accent)_55%,transparent)]">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[var(--card-border)] bg-[color-mix(in_srgb,var(--bg-tertiary)_45%,transparent)]">
          <BossPortrait
            bossName={replay.bossName}
            lookupName={replay.bossId ?? replay.bossName}
            size="small"
            variant="portrait"
            lazy
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {replay.isFeatured && (
              <Star
                className="h-3.5 w-3.5 shrink-0 text-amber-300"
                aria-label="Featured"
              />
            )}
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {replay.title}
            </h3>
          </div>
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            {replay.bossName}
            {replay.raritySet ? ` · ${replay.raritySet}` : ''}
            {replay.season ? ` · S${replay.season}` : ''}
          </p>
        </div>
        {damage && (
          <span className="shrink-0 font-mono text-sm font-semibold text-emerald-300">
            {damage}
          </span>
        )}
      </div>

      <ReplayTeam units={replay.units} />

      {/* The Watch anchor's ::after makes the card open the video; Playbook sits above it (z-10). */}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <Link
          href={replay.href}
          className="relative z-10 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-[var(--accent)]"
        >
          <Film className="h-3.5 w-3.5" />
          Playbook
        </Link>
        {replay.videoUrl && (
          <a
            href={replay.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2.5 text-xs font-semibold text-[var(--accent)] after:absolute after:inset-0 after:content-[''] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]"
          >
            <Play className="h-3.5 w-3.5" />
            Watch
          </a>
        )}
        {replay.encounterRole && (
          <span className="rounded border border-[var(--card-border)] bg-black/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            {replay.encounterRole}
          </span>
        )}
        {replay.visibility && replay.visibility !== 'public' && (
          <span
            className="inline-flex items-center gap-1 rounded border border-sky-300/40 bg-sky-300/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200"
            title={`Visible to your ${replay.visibility}`}
          >
            <Pin className="h-3 w-3" />
            {replay.visibility}
          </span>
        )}
      </div>
    </article>
  )
}

export function ReplayCatalogClient({
  result,
  facets,
  filters,
  sort
}: {
  result: CommunityReplayPage
  facets: CommunityReplayFacets
  filters: CommunityReplayFilters
  sort: CatalogSort
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  /** Writes to the URL (shareable, Back-steppable); any change resets to page 1. */
  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      if (!('page' in updates)) next.delete('page')
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`, { scroll: false })
      })
    },
    [pathname, router, searchParams]
  )

  const totalPages = Math.max(
    1,
    Math.ceil(result.total / Math.max(1, result.pageSize))
  )
  const activeFilterCount = [
    filters.boss,
    filters.board,
    filters.difficulty,
    filters.season,
    filters.role,
    filters.search,
    filters.featuredOnly ? '1' : null,
    filters.withVideoOnly ? '1' : null
  ].filter(Boolean).length

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-6">
      <header className="space-y-2 border-b border-[var(--card-border)] pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Replays
          </h1>
          <span className="text-sm text-[var(--text-tertiary)]">
            {result.loadFailed
              ? 'Catalogue unavailable'
              : `${result.total.toLocaleString()} replay${result.total === 1 ? '' : 's'}`}
          </span>
        </div>
        <p className="max-w-3xl text-sm text-[var(--text-secondary)]">
          Community YouTube replays. These are the same replays shown on the
          boss playbooks, browsable in one place.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                key={filters.search ?? ''}
                type="search"
                defaultValue={filters.search ?? ''}
                placeholder="Title or boss..."
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  setParam({ q: event.currentTarget.value.trim() || null })
                }}
                className="h-9 w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] pl-7 pr-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
              />
            </div>
          </label>

          <FacetSelect
            label="Boss"
            value={filters.boss ?? ''}
            options={facets.bosses.map((boss) => ({
              value: boss.value,
              label: `${boss.label} (${boss.count})`
            }))}
            onChange={(value) => setParam({ boss: value || null })}
          />
          <FacetSelect
            label="Difficulty"
            value={filters.difficulty ?? ''}
            options={facets.difficulties.map((entry) => ({
              value: entry.value,
              label: `${entry.value} (${entry.count})`
            }))}
            onChange={(value) => setParam({ difficulty: value || null })}
          />
          <FacetSelect
            label="Season"
            value={filters.season ?? ''}
            options={facets.seasons.map((entry) => ({
              value: entry.value,
              label: `Season ${entry.value} (${entry.count})`
            }))}
            onChange={(value) => setParam({ season: value || null })}
          />
          <FacetSelect
            label="Encounter"
            value={filters.role ?? ''}
            options={[
              { value: 'boss', label: 'Main boss' },
              { value: 'prime', label: 'Prime' },
              { value: 'sideboss', label: 'Side boss' }
            ]}
            onChange={(value) => setParam({ role: value || null })}
          />

          <div className="space-y-2">
            <Toggle
              label="Featured only"
              checked={Boolean(filters.featuredOnly)}
              onChange={(checked) =>
                setParam({ featured: checked ? '1' : null })
              }
            />
            <Toggle
              label="Has video"
              checked={Boolean(filters.withVideoOnly)}
              onChange={(checked) => setParam({ video: checked ? '1' : null })}
            />
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => router.push(pathname)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--accent)]"
            >
              <X className="h-3.5 w-3.5" />
              Clear {activeFilterCount} filter
              {activeFilterCount === 1 ? '' : 's'}
            </button>
          )}
        </aside>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                Sort
              </span>
              <select
                value={sort}
                onChange={(event) => setParam({ sort: event.target.value })}
                className="h-8 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 text-xs font-semibold text-[var(--text-primary)]"
              >
                {Object.entries(CATALOG_SORTS).map(([value, config]) => (
                  <option key={value} value={value}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
            {isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
            )}
          </div>

          {result.loadFailed ? (
            <div
              role="alert"
              className="rounded-lg border border-[var(--warning)]/40 bg-[color-mix(in_srgb,var(--warning)_12%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"
            >
              The replay catalogue could not be loaded. This is a read error,
              not an empty catalogue — reload the page to try again.
            </div>
          ) : result.replays.length === 0 ? (
            <p className="rounded-lg border border-[var(--card-border)] bg-black/15 px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
              No replays match these filters.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {result.replays.map((replay) => (
                <ReplayCard key={replay.id} replay={replay} />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav
              className="flex items-center justify-center gap-3"
              aria-label="Catalogue pages"
            >
              <button
                type="button"
                disabled={result.page <= 1}
                onClick={() => setParam({ page: String(result.page - 1) })}
                className={clsx(
                  'h-8 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 text-xs font-semibold',
                  result.page <= 1
                    ? 'cursor-not-allowed text-[var(--text-tertiary)] opacity-50'
                    : 'text-[var(--text-secondary)] hover:text-[var(--accent)]'
                )}
              >
                Previous
              </button>
              <span className="text-xs text-[var(--text-tertiary)]">
                Page {result.page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={result.page >= totalPages}
                onClick={() => setParam({ page: String(result.page + 1) })}
                className={clsx(
                  'h-8 rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-3 text-xs font-semibold',
                  result.page >= totalPages
                    ? 'cursor-not-allowed text-[var(--text-tertiary)] opacity-50'
                    : 'text-[var(--text-secondary)] hover:text-[var(--accent)]'
                )}
              >
                Next
              </button>
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}

function FacetSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  if (options.length === 0) return null
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-[var(--card-border)] bg-[var(--bg-secondary)] px-2 text-sm text-[var(--text-primary)]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--accent)]"
      />
      {label}
    </label>
  )
}
