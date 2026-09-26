'use client'

import { type ReactNode } from 'react'
import {
  MechanicusEmptyState as EmptyState,
  TableSkeleton
} from '@tacticus/ui-kit'
import { formatDamage } from '@tacticus/app-core/formatters'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import {
  formatDamagePercentage,
  getDamagePercentageColor
} from '@/app/lib/utils/damage-comparison'
import { getBattleLogPerformancePcts } from '@/app/lib/utils/battle-log-performance'
import {
  formatBattleLogTime,
  getDamageTypeIcon,
  isKillingBlow,
  parseHeroDetails,
  parseMachineOfWarDetails,
  type BattleLogEntry,
  type HeroMapping
} from '@/app/lib/utils/battle-log-helpers'

interface BattleLogFilterOption<T extends string> {
  value: T
  label: string
  activeClassName: string
}

interface BattleLogControlsProps<T extends string> {
  options: readonly BattleLogFilterOption<T>[]
  value: T
  onChange: (value: T) => void
  pageSize: number
  onPageSizeChange: (value: number) => void
  pageSizes: readonly number[]
}

export function BattleLogControls<T extends string>({
  options,
  value,
  onChange,
  pageSize,
  onPageSizeChange,
  pageSizes
}: BattleLogControlsProps<T>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`rounded px-2 py-1 text-xs transition-all ${active ? `${option.activeClassName} font-medium` : 'bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <label className="flex items-center gap-2">
        <span className="whitespace-nowrap text-xs text-[var(--text-secondary)]">
          Per page:
        </span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="min-w-[60px] cursor-pointer appearance-none rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-2 py-1 text-xs text-[var(--text-primary)] focus:border-[var(--primary)] focus:outline-none"
          // appearance-none strips the native arrow, so paint one back.
          style={{
            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
            backgroundPosition: 'right 6px center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '12px'
          }}
        >
          {pageSizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

interface PaginationProps {
  page: number
  setPage: (p: number) => void
  pageSize: number
  totalCount: number
  loading: boolean
}

export function BattleLogPagination({
  page,
  setPage,
  pageSize,
  totalCount,
  loading
}: PaginationProps) {
  if (totalCount <= 0) return null
  const totalPages = Math.ceil(totalCount / pageSize)

  return (
    <div className="flex items-center justify-between mb-3 p-2 bg-card/50 rounded border border-[var(--card-border)] gap-2">
      <div className="text-xs text-secondary-wh40k flex-shrink-0">
        {Math.min(page * pageSize + 1, totalCount)}-
        {Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPage(Math.max(0, page - 1))}
          disabled={page === 0 || loading}
          className="px-2 py-1 text-xs rounded bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          &lsaquo;
        </button>
        <span className="text-xs text-[var(--text-primary)] px-2">
          {page + 1}/{totalPages}
        </span>
        <button
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages - 1 || loading}
          className="px-2 py-1 text-xs rounded bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          &rsaquo;
        </button>
      </div>
    </div>
  )
}

interface HeroTeamIconsProps {
  heroes: string[]
  machine: string | null
  heroMappings: Map<string, HeroMapping>
  size?: 'sm' | 'lg'
}

export function HeroTeamIcons({
  heroes,
  machine,
  heroMappings,
  size = 'sm'
}: HeroTeamIconsProps) {
  const imgClass =
    size === 'sm'
      ? 'inline-block w-auto h-5 md:h-6 lg:h-7 max-w-[1.75rem]'
      : 'inline-block w-auto h-10 max-w-[2.5rem]'
  const fallbackClass =
    size === 'sm'
      ? 'w-5 h-5 md:w-6 md:h-6 lg:w-7 lg:h-7 bg-[var(--card-bg)] rounded flex items-center justify-center text-xs'
      : 'w-10 h-10 bg-[var(--card-bg)] rounded flex items-center justify-center text-sm'
  const imgSize = size === 'sm' ? 32 : 48

  const renderIcon = (unitId: string) => {
    const mapping = heroMappings.get(unitId)
    return mapping?.web_icon_url ? (
      <img
        src={mapping.web_icon_url}
        alt={mapping.display_name || unitId}
        title={mapping.display_name || unitId}
        width={imgSize}
        height={imgSize}
        className={imgClass}
        loading="lazy"
      />
    ) : (
      <div className={fallbackClass}>{unitId.charAt(0)}</div>
    )
  }

  return (
    <>
      {heroes.map((heroId) => (
        <span key={heroId} className="flex-shrink-0">
          {renderIcon(heroId)}
        </span>
      ))}
      {machine && <span className="flex-shrink-0">{renderIcon(machine)}</span>}
    </>
  )
}

interface BattleLogEntryRowProps {
  entry: BattleLogEntry
  heroMappings: Map<string, HeroMapping>
  guildPerformancePctMap: ReadonlyMap<string, number | null>
  clusterPerformancePctMap: ReadonlyMap<string, number | null>
  clusterCode: string | null
  hasMounted: boolean
  desktopPrimary: ReactNode
  desktopSecondary: ReactNode
  mobileIdentity: ReactNode
  desktopGridClassName: string
}

export function BattleLogEntryRow({
  entry,
  heroMappings,
  guildPerformancePctMap,
  clusterPerformancePctMap,
  clusterCode,
  hasMounted,
  desktopPrimary,
  desktopSecondary,
  mobileIdentity,
  desktopGridClassName
}: BattleLogEntryRowProps) {
  const heroes = parseHeroDetails(entry.heroDetails)
  const machine = parseMachineOfWarDetails(entry.machineOfWarDetails)
  const hasUnits =
    entry.damageType !== 'Bomb' && (heroes.length > 0 || machine != null)
  const { guildPct, clusterPct } = getBattleLogPerformancePcts(
    entry,
    guildPerformancePctMap,
    clusterPerformancePctMap
  )
  const damageClassName =
    entry.damageType === 'Bomb' ? 'text-red-400' : 'text-[var(--accent)]'

  return (
    <div
      className={`rounded border px-3 py-2 transition-all sm:py-1 ${isKillingBlow(entry) ? 'border-red-600 bg-red-900/30 hover:border-red-500' : 'border-[var(--card-border)] bg-slate-800/50 hover:border-accent-wh40k'}`}
    >
      <div
        className={`hidden items-center gap-2 text-sm sm:grid ${desktopGridClassName}`}
      >
        <span className="text-lg">{getDamageTypeIcon(entry.damageType)}</span>
        {desktopPrimary}
        {desktopSecondary}
        <div className="flex min-h-[24px] items-center justify-start">
          {entry.categories && entry.categories.length > 0 ? (
            <MultipleCategoryBadges categories={entry.categories} />
          ) : (
            <span className="text-transparent">-</span>
          )}
        </div>
        <div className="flex min-h-[24px] flex-nowrap items-center gap-0.5">
          {hasUnits ? (
            <HeroTeamIcons
              heroes={heroes}
              machine={machine}
              heroMappings={heroMappings}
              size="sm"
            />
          ) : (
            <span className="text-xs text-[var(--text-secondary)]">-</span>
          )}
        </div>
        <div className={`text-right font-bold ${damageClassName}`}>
          {formatDamage(entry.damageDealt)}
          {isKillingBlow(entry) && (
            <span className="ml-1 text-yellow-400">{'\uD83D\uDC80'}</span>
          )}
        </div>
        <div
          className={`text-right text-xs font-medium ${getDamagePercentageColor(guildPct)}`}
          title="vs Guild (player stats)"
        >
          {formatDamagePercentage(guildPct)}
        </div>
        <div
          className={`text-right text-xs font-medium ${getDamagePercentageColor(clusterPct)}`}
          title="vs Cluster (player stats)"
        >
          {clusterCode ? formatDamagePercentage(clusterPct) : '--'}
        </div>
        <div className="text-right text-xs text-secondary-wh40k">
          HP:{' '}
          <span className="text-red-400">
            {formatDamage(entry.remainingHp)}
          </span>
        </div>
        <div className="text-right text-xs text-secondary-wh40k">
          {formatBattleLogTime(entry.completedOn, hasMounted)}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-center justify-between">
          <span className="flex-shrink-0 text-lg">
            {getDamageTypeIcon(entry.damageType)}
          </span>
          <div className="flex items-center gap-2">
            <span className={`font-bold ${damageClassName}`}>
              {formatDamage(entry.damageDealt)}
              {isKillingBlow(entry) && (
                <span className="ml-1 text-yellow-400">{'\uD83D\uDC80'}</span>
              )}
            </span>
            <span
              className={`text-xs font-medium ${getDamagePercentageColor(guildPct)}`}
              title="vs Guild (player stats)"
            >
              {formatDamagePercentage(guildPct)}
            </span>
          </div>
        </div>
        {mobileIdentity}
        <div className="flex items-center justify-between text-xs">
          <span className="text-secondary-wh40k">
            HP Left:{' '}
            <span className="text-red-400">
              {formatDamage(entry.remainingHp)}
            </span>
          </span>
          <span className="text-secondary-wh40k">
            {formatBattleLogTime(entry.completedOn, hasMounted)}
          </span>
        </div>
        {entry.categories && entry.categories.length > 0 && (
          <div className="flex items-center">
            <MultipleCategoryBadges categories={entry.categories} />
          </div>
        )}
        {hasUnits && (
          <div className="mt-2 w-full border-t border-[var(--card-border)] pt-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <HeroTeamIcons
                heroes={heroes}
                machine={machine}
                heroMappings={heroMappings}
                size="lg"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface BattleLogTableProps {
  loading: boolean
  isEmpty: boolean
  totalCount: number
  page: number
  setPage: (p: number) => void
  pageSize: number
  loadingMessage?: string
  emptyTitle?: string
  emptyDescription?: string
  children: ReactNode
  /** Defaults to 600px; 'none' renders full height with no inner scroll. */
  maxHeight?: string
}

export function BattleLogTable({
  loading,
  isEmpty,
  totalCount,
  page,
  setPage,
  pageSize,
  loadingMessage = 'Loading battle log...',
  emptyTitle = 'No Data Available',
  emptyDescription = 'No records match your search',
  children,
  maxHeight = '600px'
}: BattleLogTableProps) {
  return (
    <>
      <BattleLogPagination
        page={page}
        setPage={setPage}
        pageSize={pageSize}
        totalCount={totalCount}
        loading={loading}
      />

      {loading ? (
        <div className="py-6">
          <TableSkeleton rows={Math.min(pageSize, 6)} columns={6} />
          <p className="mt-4 text-center text-secondary-wh40k">
            {page > 0 ? `Loading page ${page + 1}...` : loadingMessage}
          </p>
        </div>
      ) : isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div
          className="space-y-1"
          style={
            maxHeight === 'none' ? undefined : { maxHeight, overflowY: 'auto' }
          }
        >
          {children}
        </div>
      )}
    </>
  )
}
