'use client'

/**
 * Officer-only briefing. The expensive detail analysis runs only when a member is
 * selected; a 403 reads as "Officer access required".
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, ArrowUpRight } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import { BriefingCards } from '@/app/components/briefing/officer/BriefingCards'
import {
  PeopleToReviewList,
  computeDisplayBuckets
} from '@/app/components/briefing/officer/PeopleToReviewList'
import { MemberDetailPanel } from '@/app/components/briefing/officer/MemberDetailPanel'
import { RecognitionQueue } from '@/app/components/briefing/officer/RecognitionQueue'
import { GuildPatterns } from '@/app/components/briefing/officer/GuildPatterns'
import { FollowUpsList } from '@/app/components/briefing/officer/FollowUpsList'
import type { BriefingFilter } from '@/app/components/briefing/officer/FilterChips'
import type { OfficerBriefingResponse } from '@/app/lib/officer-briefing/types'

interface OfficerBriefingProps {
  season: string | null
  guildCode: string
}

class BriefingFetchError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'BriefingFetchError'
    this.status = status
  }
}

async function fetchBriefing(
  season: string | null
): Promise<OfficerBriefingResponse> {
  const params = new URLSearchParams()
  if (season) params.set('season', season)
  const qs = params.toString()
  const res = await fetch(`/api/officer/briefing${qs ? `?${qs}` : ''}`, {
    cache: 'no-store'
  })
  if (!res.ok) {
    throw new BriefingFetchError(
      res.status === 403
        ? 'Officer access required'
        : `Failed to load briefing (${res.status})`,
      res.status
    )
  }
  return (await res.json()) as OfficerBriefingResponse
}

/** "Magnus M1" → "Magnus": strips a trailing level/Prime N/number token. */
function bossNameFromLabel(label: string | null): string | null {
  if (!label) return null
  const trimmed = label.trim()
  const withoutPrime = trimmed.replace(/\s+Prime\s+\d+\s*$/i, '').trim()
  const withoutLevel = withoutPrime.replace(/\s+[ML]?\d+\s*$/i, '').trim()
  return withoutLevel || trimmed
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return 'now'
}

function StatTile({
  label,
  value,
  color
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] px-3 py-2 text-center">
      <p className="text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  )
}

function RaidContextBanner({
  data,
  season
}: {
  data: OfficerBriefingResponse
  season: string | null
}) {
  const { context, counts } = data
  const bossName = bossNameFromLabel(context.activeBossLabel)
  const label = context.activeBossLabel
    ? context.openTargetsLabel
      ? `${context.activeBossLabel} · ${context.openTargetsLabel} open`
      : context.activeBossLabel
    : 'No active boss'

  return (
    <section
      className="rounded-xl border border-[var(--card-border)] bg-card/30 p-4"
      aria-label="Current raid context"
    >
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        Current raid context · Season {context.season}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {bossName ? (
            <BossPortrait
              bossName={bossName}
              size="medium"
              variant="icon"
              lazy={false}
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {label}
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Member insights below are weighted toward the active encounter,
              available tokens, and the next planned attack window.
            </p>
            {context.activeBossHpPct != null && (
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                <span
                  className="font-semibold"
                  style={{ color: 'var(--accent)' }}
                >
                  {context.activeBossHpPct}%
                </span>{' '}
                HP remaining
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {context.seasonOutlook && (
            <StatTile
              label="Season outlook"
              value={`Lap ${context.seasonOutlook.lap} + ${context.seasonOutlook.pctIntoLap}%`}
              color="var(--accent)"
            />
          )}
          {context.capacityLeft != null && (
            <StatTile
              label="Capacity left"
              value={formatNumber(context.capacityLeft, 0)}
              color="var(--success)"
            />
          )}
          <StatTile
            label="Unassigned"
            value={
              context.unassignedAttacks != null
                ? formatNumber(context.unassignedAttacks, 0)
                : '—'
            }
            color="var(--warning)"
          />
          {context.membersCappingWithin12h != null ? (
            <StatTile
              label="Cap within 12h"
              value={`${formatNumber(context.membersCappingWithin12h, 0)} members`}
              color="var(--info)"
            />
          ) : (
            <StatTile
              label="Cap risk"
              value={`${formatNumber(counts.tokenRisk, 0)} members`}
              color="var(--info)"
            />
          )}
          {context.nextReviewSeconds != null && (
            <StatTile
              label="Next review"
              value={formatCountdown(context.nextReviewSeconds)}
              color="var(--text-primary)"
            />
          )}
          <a
            href={getHrefWithSeason('/boss-assignments', season)}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition hover:brightness-110"
            style={{
              color: 'var(--accent)',
              borderColor: 'var(--accent)'
            }}
          >
            Open raid plan
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  )
}

function BriefingSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading officer briefing"
    >
      <div className="h-14 w-full animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="h-24 animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
        <div className="h-24 animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
        <div className="h-24 animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--card-border)_40%,transparent)]" />
      </div>
      <div className="h-64 w-full animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--card-border)_30%,transparent)]" />
    </div>
  )
}

export default function OfficerBriefing({
  season,
  guildCode
}: OfficerBriefingProps) {
  const [filter, setFilter] = useState<BriefingFilter>('needs_support')
  const [selectedMember, setSelectedMember] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['officer-briefing', guildCode, season],
    queryFn: () => fetchBriefing(season),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: (failureCount, err) => {
      // Auth/access failures will not fix themselves; do not retry.
      if (
        err instanceof BriefingFetchError &&
        (err.status === 403 || err.status === 401)
      ) {
        return false
      }
      return failureCount < 2
    }
  })

  if (isLoading) return <BriefingSkeleton />

  if (error) {
    const isAccess = error instanceof BriefingFetchError && error.status === 403
    return (
      <section className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_50%,transparent)] bg-card/30 p-6">
        <div
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--danger)' }}
        >
          <ShieldAlert className="h-4 w-4" aria-hidden />
          {isAccess
            ? 'Officer access required'
            : error instanceof Error
              ? error.message
              : 'Failed to load the officer briefing'}
        </div>
        {isAccess && (
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            The Officer Command Center is limited to guild officers.
          </p>
        )}
      </section>
    )
  }

  if (!data) return null

  const handleSelectMember = (displayName: string) => {
    setSelectedMember((current) =>
      current === displayName ? null : displayName
    )
  }

  // Cards use the same disjoint taxonomy as the list, so counts match the tab.
  const cardBuckets = computeDisplayBuckets(
    data.needsReview,
    data.teamUpgrades,
    data.recognition
  )
  const teamUpsideDisplayed = cardBuckets.teamUpgrades.reduce(
    (sum, t) => sum + (t.readyNowUpside ?? 0),
    0
  )
  const largestTeamGainPct = cardBuckets.teamUpgrades.reduce(
    (max, t) => Math.max(max, Math.abs(t.rosterAdjustedPct ?? 0)),
    0
  )

  return (
    <div className="space-y-4" data-testid="officer-briefing">
      <RaidContextBanner data={data} season={season} />

      <BriefingCards
        counts={{
          needsReview: cardBuckets.needsSupport.length,
          tokenRisk: data.counts.tokenRisk,
          recognition: cardBuckets.doingGreat.length,
          teamUpgrades: cardBuckets.teamUpgrades.length
        }}
        teamUpgradeUpsideTotal={teamUpsideDisplayed}
        largestGainPct={largestTeamGainPct > 0 ? largestTeamGainPct : null}
        needsReviewTop={cardBuckets.needsSupport[0] ?? null}
        recognitionTop={cardBuckets.doingGreat[0] ?? null}
        activeFilter={filter}
        onSelect={setFilter}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <PeopleToReviewList
            filter={filter}
            onFilterChange={setFilter}
            needsReview={data.needsReview}
            recognition={data.recognition}
            teamUpgrades={data.teamUpgrades}
            selectedMember={selectedMember}
            onSelectMember={handleSelectMember}
          />
          <RecognitionQueue
            recognition={data.recognition}
            selectedMember={selectedMember}
            onSelectMember={handleSelectMember}
          />
        </div>

        <MemberDetailPanel
          key={selectedMember ?? 'none'}
          displayName={selectedMember}
          guildCode={guildCode}
          season={data.context.season}
          rowContext={(() => {
            if (!selectedMember) return null
            const row = [
              ...data.needsReview,
              ...data.teamUpgrades,
              ...data.recognition,
              ...data.tokenRisk
            ].find((r) => r.displayName === selectedMember)
            return row
              ? {
                  tokensAvailable: row.tokensAvailable ?? null,
                  tokenCapacity: row.tokenCapacity ?? null,
                  lastBattleSecondsAgo: row.lastBattleSecondsAgo ?? null,
                  targetScore: row.targetScore ?? null
                }
              : null
          })()}
        />
      </div>

      <GuildPatterns patterns={data.patterns ?? []} />

      <FollowUpsList guildCode={guildCode} season={data.context.season} />
    </div>
  )
}
