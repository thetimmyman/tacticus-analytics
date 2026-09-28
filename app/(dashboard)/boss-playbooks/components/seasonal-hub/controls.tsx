'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Minus, Plus, Save, Settings2, X } from 'lucide-react'
import clsx from 'clsx'
import { saveTargetToken } from '@/app/lib/boss-ops/persist-target-token'
import { asEncounterId } from '@/app/lib/boss-ops/identity'
import type {
  PingMode,
  SaveStatus
} from '@/app/lib/boss-ops/encounter-ops-types'
import type {
  SeasonalBossCardData,
  SeasonalEncounterData
} from '../../seasonal-hub-utils'
import {
  MAX_CUSTOM_LINKS,
  MESSAGE_INCLUDE_OPTIONS,
  type EncounterLinkTargets,
  type EncounterMessageState,
  type MessageIncludeOption
} from './types'
import {
  addCustomLink,
  removeCustomLink,
  safeDomId,
  updateCustomLink
} from './message-state'
import {
  EncounterMedia,
  EncounterTitle,
  MetaTeamBadge,
  MetricsStrip,
  MiniTeam,
  SmallEncounterMap
} from './encounter-blocks'
import { formatDamage } from './message-state'
import { EncounterReplays } from './EncounterReplays'

function EncounterContent({ encounter }: { encounter: SeasonalEncounterData }) {
  const team = encounter.metaAtlasTopTeam
  const benchmark =
    team?.damageP90 ?? team?.damageP75 ?? team?.damageAvg ?? null

  return (
    <div className="space-y-3">
      <div className="hidden xl:block">
        <EncounterMedia encounter={encounter} />
      </div>
      <MetricsStrip encounter={encounter} />
      {team && team.units.length > 0 && (
        <section className="rounded-md border border-[color-mix(in_srgb,var(--accent)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--accent)">
                Meta Atlas benchmark
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <MetaTeamBadge team={team} />
                <MiniTeam units={team.units} compact />
              </div>
            </div>
            {benchmark !== null && (
              <div className="text-right">
                <div className="text-sm font-semibold text-emerald-300">
                  {formatDamage(benchmark)}
                </div>
                <div className="text-[9px] uppercase tracking-wide text-(--text-tertiary)">
                  {team.damageP90 !== null
                    ? 'P90'
                    : team.damageP75 !== null
                      ? 'P75'
                      : 'Average'}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <EncounterReplays encounter={encounter} />
    </div>
  )
}

export function EncounterCommandRow({
  encounter,
  title,
  subtitle,
  href,
  children,
  actions,
  ops,
  mobileOpsFooter,
  mobileSummary,
  canExpandOps = true,
  sectionId
}: {
  encounter: SeasonalEncounterData
  title: string
  subtitle?: ReactNode
  href?: string
  children?: ReactNode
  actions?: ReactNode
  ops?: ReactNode
  mobileOpsFooter?: ReactNode
  // Mobile indicator row; tapping opens the same editor `ops` renders on desktop.
  mobileSummary?: ReactNode
  // Without manage permission: indicators only, no editor.
  canExpandOps?: boolean
  sectionId?: string
}) {
  const [mobileOpsOpen, setMobileOpsOpen] = useState(false)
  const mobileOpsTitleId = `${sectionId ?? safeDomId(title)}-mobile-ops-title`

  useEffect(() => {
    if (!mobileOpsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpsOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpsOpen])

  return (
    <section
      id={sectionId}
      className="scroll-mt-32 rounded-lg border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-secondary)_70%,transparent)]"
    >
      <div className="flex items-start justify-between gap-3 border-b border-(--card-border) px-4 py-4">
        <EncounterTitle
          encounter={encounter}
          title={title}
          subtitle={subtitle}
          href={href}
        >
          {children}
        </EncounterTitle>
        <div className="flex shrink-0 items-center gap-2">
          {ops && !mobileSummary && canExpandOps && (
            <button
              type="button"
              onClick={() => setMobileOpsOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent)_50%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--accent) hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] xl:hidden"
              aria-label={`Open ops settings for ${title}`}
            >
              <Settings2 className="h-4 w-4" />
            </button>
          )}
          <SmallEncounterMap encounter={encounter} />
          {actions && (
            <div className="hidden flex-wrap gap-2 xl:flex">{actions}</div>
          )}
        </div>
      </div>
      {mobileSummary &&
        (canExpandOps ? (
          <button
            type="button"
            onClick={() => setMobileOpsOpen(true)}
            aria-label={`Expand ops settings for ${title}`}
            className="block w-full border-b border-(--card-border) px-4 py-3 text-left xl:hidden"
          >
            {mobileSummary}
          </button>
        ) : (
          <div className="border-b border-(--card-border) px-4 py-3 xl:hidden">
            {mobileSummary}
          </div>
        ))}
      <div
        className={clsx(
          'grid grid-cols-1 gap-4 p-4',
          ops &&
            'xl:grid-cols-[minmax(0,1fr)_480px] 2xl:grid-cols-[minmax(0,1fr)_540px]'
        )}
      >
        <EncounterContent encounter={encounter} />
        {ops && <div className="hidden xl:block">{ops}</div>}
      </div>
      {ops && mobileOpsOpen && (
        <div
          className="fixed inset-0 z-85 flex items-end bg-black/80 backdrop-blur-xs xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby={mobileOpsTitleId}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label={`Close ops for ${title}`}
            onClick={() => setMobileOpsOpen(false)}
          />
          <div className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-lg border border-(--card-border) bg-[#171a1f] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-(--card-border) bg-[#1b1f25] px-4 py-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-(--accent)">
                  Encounter ops
                </div>
                <h3
                  id={mobileOpsTitleId}
                  className="mt-1 text-lg font-semibold text-primary-wh40k"
                >
                  {title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpsOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-(--card-border) bg-black/20 text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] hover:text-primary-wh40k"
                aria-label={`Close ops for ${title}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              {ops}
              {mobileOpsFooter}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function TargetTokenControl({
  card,
  encounter,
  canManage
}: {
  card: SeasonalBossCardData
  encounter: SeasonalEncounterData
  canManage: boolean
}) {
  const [draft, setDraft] = useState(
    encounter.targetToken?.targetTokens
      ? String(encounter.targetToken.targetTokens)
      : ''
  )
  const [savedValue, setSavedValue] = useState<number | null>(
    encounter.targetToken?.targetTokens ?? null
  )
  const [status, setStatus] = useState<SaveStatus>('idle')
  const router = useRouter()

  const parsed = Number.parseFloat(draft)
  const valid = Number.isFinite(parsed) && parsed > 0
  const dirty = valid && parsed !== savedValue

  const setDraftNumber = (value: number) => {
    const next = Math.max(1, Math.round(value * 100) / 100)
    setDraft(
      Number.isInteger(next)
        ? String(next)
        : next.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    )
    setStatus('idle')
  }

  const save = async () => {
    if (!valid || !canManage) return
    setStatus('saving')
    try {
      // `skip` is deliberately omitted: sending `skip: false` would un-skip a prime on every edit.
      await saveTargetToken({
        bossType: card.bossType,
        rarity: card.rarity,
        set: card.setNumber + 1,
        encounterId: asEncounterId(encounter.encounterIndex),
        targetTokens: parsed,
        // Reads prefer this season's row over the '' legacy row, so writing '' would be a no-op.
        seasonNumber: String(card.seasonNumber)
      })
    } catch {
      setStatus('error')
      return
    }
    setSavedValue(parsed)
    setStatus('saved')
    router.refresh()
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
        Target tokens
      </div>
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() =>
            setDraftNumber((valid ? parsed : (savedValue ?? 1)) - 1)
          }
          disabled={!canManage || status === 'saving' || (valid && parsed <= 1)}
          aria-label={`Decrease target tokens for ${encounter.bossName}`}
          className="inline-flex h-9 w-8 items-center justify-center rounded-md border border-(--card-border) bg-black/20 text-secondary-wh40k hover:text-primary-wh40k disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setStatus('idle')
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
          }}
          disabled={!canManage || status === 'saving'}
          inputMode="decimal"
          className="h-9 w-20 rounded-md border border-(--card-border) bg-[color-mix(in_srgb,var(--bg-primary)_90%,transparent)] px-2 text-center font-mono text-sm font-semibold text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_60%,transparent)] disabled:opacity-50"
          placeholder="--"
          aria-label={`${encounter.bossName} target tokens`}
        />
        <button
          type="button"
          onClick={() =>
            setDraftNumber((valid ? parsed : (savedValue ?? 0)) + 1)
          }
          disabled={!canManage || status === 'saving'}
          aria-label={`Increase target tokens for ${encounter.bossName}`}
          className="inline-flex h-9 w-8 items-center justify-center rounded-md border border-(--card-border) bg-black/20 text-secondary-wh40k hover:text-primary-wh40k disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canManage || !dirty || status === 'saving'}
          aria-label={`Save target tokens for ${encounter.bossName}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--accent) hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] disabled:cursor-not-allowed disabled:border-(--card-border) disabled:bg-black/10 disabled:text-[color-mix(in_srgb,var(--text-secondary)_35%,transparent)]"
        >
          {status === 'saving' ? (
            <Loader2 className="h-3.5 w-3.5" />
          ) : status === 'saved' && !dirty ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {status === 'error' && (
        <div className="text-[10px] text-red-400">Save failed</div>
      )}
    </div>
  )
}

export function PingModeToggle({
  value,
  disabled,
  onChange
}: {
  value: PingMode
  disabled: boolean
  onChange: (value: PingMode) => void
}) {
  const options: Array<{ value: PingMode; label: string }> = [
    { value: 'combined', label: 'Combined ping' },
    { value: 'per_side', label: 'Per-side ping' },
    { value: 'skip_all', label: 'Skip all sides' }
  ]

  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-(--card-border) bg-black/20 p-1">
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={clsx(
              'min-h-[38px] rounded-sm border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              active
                ? option.value === 'skip_all'
                  ? 'border-(--card-border) bg-(--card-bg) text-primary-wh40k'
                  : 'border-[color-mix(in_srgb,var(--accent)_75%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent)'
                : 'border-transparent text-secondary-wh40k hover:bg-[color-mix(in_srgb,var(--card-bg)_70%,transparent)] hover:text-primary-wh40k'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function MessageIncludePicker({
  settings,
  links,
  disabled,
  onToggle,
  onCustomLinkChange
}: {
  settings: EncounterMessageState
  links: EncounterLinkTargets
  disabled: boolean
  onToggle: (option: MessageIncludeOption) => void
  onCustomLinkChange: (patch: Partial<EncounterMessageState>) => void
}) {
  const optionAvailable = (option: MessageIncludeOption) => {
    if (option === 'wiki') return links.wiki !== null
    if (option === 'tacticusTable') return links.tacticusTable !== null
    return true
  }
  const customSelected = settings.include.includes('customLink')
  const atCustomLinkCap = settings.customLinks.length >= MAX_CUSTOM_LINKS
  const patchCustomLinks = (next: EncounterMessageState) =>
    onCustomLinkChange({
      customLinks: next.customLinks,
      include: next.include
    })
  const inputClass =
    'h-9 rounded-md border border-(--card-border) bg-black/20 px-2 text-sm text-primary-wh40k placeholder-[color-mix(in_srgb,var(--text-secondary)_50%,transparent)] focus:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus:outline-hidden disabled:opacity-50'

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-(--text-tertiary)">
        Include in Herald message
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MESSAGE_INCLUDE_OPTIONS.map(({ value, label, Icon }) => {
          const active = settings.include.includes(value)
          const available = optionAvailable(value)
          return (
            <button
              key={value}
              type="button"
              disabled={disabled || !available}
              aria-pressed={active}
              onClick={() => onToggle(value)}
              className={clsx(
                'inline-flex min-h-[32px] items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                active
                  ? 'border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-(--accent)'
                  : 'border-(--card-border) bg-black/15 text-secondary-wh40k hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:text-primary-wh40k'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          )
        })}
      </div>
      {customSelected && (
        <div className="space-y-2">
          {settings.customLinks.map((link, index) => (
            <div
              key={link.clientKey}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)_auto]"
            >
              <input
                value={link.label}
                disabled={disabled}
                onChange={(event) =>
                  patchCustomLinks(
                    updateCustomLink(settings, link.clientKey, {
                      label: event.target.value
                    })
                  )
                }
                className={inputClass}
                placeholder="Label"
                aria-label={`Custom link ${index + 1} label`}
              />
              <input
                value={link.url}
                disabled={disabled}
                onChange={(event) =>
                  patchCustomLinks(
                    updateCustomLink(settings, link.clientKey, {
                      url: event.target.value
                    })
                  )
                }
                className={inputClass}
                placeholder="https://..."
                aria-label={`Custom link ${index + 1} URL`}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  patchCustomLinks(removeCustomLink(settings, link.clientKey))
                }
                aria-label={`Remove custom link ${index + 1}`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-(--card-border) bg-black/20 text-secondary-wh40k transition-colors hover:border-red-500/60 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={disabled || atCustomLinkCap}
            onClick={() => patchCustomLinks(addCustomLink(settings))}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-(--card-border) bg-black/15 px-2 text-xs font-semibold text-secondary-wh40k transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,transparent)] hover:text-primary-wh40k disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            {atCustomLinkCap ? `Max ${MAX_CUSTOM_LINKS} links` : 'Add link'}
          </button>
        </div>
      )}
    </div>
  )
}
