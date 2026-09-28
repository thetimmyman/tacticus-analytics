'use client'

/** Member Command Briefing (/home). */

import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { UserRole } from '@tacticus/app-core/types'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { getHrefWithSeason } from '@/app/lib/utils/navigation'
import { type NewsItem } from '@/app/components/landing/NewsBanner'
import { deriveNextMove } from '@/app/lib/briefing/derive-next-move'
import type { NextMoveAlternative, PrimeTarget } from '@/app/lib/briefing/types'
import type {
  LandingPageBossOverview,
  TokenData
} from '@/app/lib/dashboard/home-summary-types'
import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
import type { SinceLastVisit } from '@/app/lib/briefing/load-since-last-visit'
import type { MemberBossPerformance } from '@/app/lib/briefing/load-member-boss-performance'
import TokenAvailabilityWithBoundary from '@/app/components/TokenAvailabilityWithBoundary'
import { useTokenAlertNudge } from '@/app/components/token-usage/hooks/useTokenAlertNudge'
import {
  TOKEN_ALERT_NUDGE_ID,
  withTokenAlertSlide
} from '@/app/components/token-usage/token-alert-nudge-content'
import YourNextMoveCard from './YourNextMoveCard'
import PrimeTargetsCard from './PrimeTargetsCard'
import SeasonOutlookCard from './SeasonOutlookCard'
import BossPerformanceTable from './BossPerformanceTable'
import AnnouncementSlot from './AnnouncementSlot'
import SinceLastVisitStrip from './SinceLastVisitStrip'
import OfficerBriefing from './officer/OfficerBriefing'

interface BriefingPageProps {
  profile: {
    role: UserRole
    guild_code: string
    display_name?: string
    player_id?: string
  }
  seasonNumber?: string
  guildName?: string
  currentBoss?: LandingPageBossOverview
  tokenData?: TokenData
  newsItems?: NewsItem[]
  forecast: SeasonForecastEnvelope | null
  /** Server-loaded next-move signals (warding, per-bomb damage, Herald bomb flags). */
  nextMoveSignals?: {
    mainWarded: boolean | null
    bombDamagePerBomb?: number | null
    bombRangeEncounterIds?: number[] | null
    guildBombsAvailable?: number | null
  }
  nextMoveEconomy?: {
    currentBossValue: number | null
    alternatives: NextMoveAlternative[]
  }
  /**
   * Live primes to clear before the (warded) main. `undefined` = unknown (legacy
   * fallback); `[]` = none live (main not warded); `[...]` = clear these first.
   */
  primeTargets?: PrimeTarget[]
  sinceLastVisit?: SinceLastVisit
  canSeeOfficerView?: boolean
  bossPerformance?: MemberBossPerformance
  seasonOutlook?: SeasonOutlookProjection | null
  /** Seeds TokenAvailability, which self-fetches the full set. */
  hasPlayerApiKey?: boolean
}

const DISMISSIBLE_ANNOUNCEMENT_IDS: readonly string[] = [TOKEN_ALERT_NUDGE_ID]

function isOfficerRole(role: UserRole): boolean {
  const r = String(role).toLowerCase()
  return r === 'officer' || r === 'leader' || r === 'admin'
}

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'season ended'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export default function BriefingPage({
  profile,
  seasonNumber,
  guildName,
  currentBoss,
  tokenData,
  newsItems,
  forecast,
  nextMoveSignals,
  nextMoveEconomy,
  primeTargets,
  sinceLastVisit,
  canSeeOfficerView = false,
  bossPerformance,
  seasonOutlook,
  hasPlayerApiKey
}: BriefingPageProps) {
  const hasMounted = useHasMounted()
  const season = seasonNumber ?? null
  const isOfficer = isOfficerRole(profile.role)
  const playerName = profile.display_name?.trim() || 'Commander'
  const rankLabel = profile.role
    ? String(profile.role).charAt(0).toUpperCase() +
      String(profile.role).slice(1).toLowerCase()
    : null

  // Live raid/bomb counts from TokenAvailability override the stale server snapshot.
  const [liveGuildRaid, setLiveGuildRaid] = useState<{
    current: number
    max: number
    nextInSeconds: number | null
  } | null>(null)
  const [liveBombs, setLiveBombs] = useState<{
    current: number
    max: number
    nextInSeconds: number | null
  } | null>(null)
  const onLiveTokens = useCallback(
    (
      guildRaid: { current: number; max: number; nextInSeconds: number | null },
      bomb?: {
        current: number
        max: number
        nextInSeconds: number | null
      } | null
    ) => {
      setLiveGuildRaid(guildRaid)
      if (bomb) setLiveBombs(bomb)
    },
    []
  )

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const officerView =
    canSeeOfficerView && searchParams.get('view') === 'officer'

  const setView = useCallback(
    (view: 'member' | 'officer') => {
      const params = new URLSearchParams(searchParams.toString())
      if (view === 'officer') params.set('view', 'officer')
      else params.delete('view')
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, router, searchParams]
  )

  const move = useMemo(
    () =>
      deriveNextMove({
        hasClaimedProfile: Boolean(profile.player_id),
        mainBoss: currentBoss
          ? {
              name: currentBoss.name,
              displayName: currentBoss.displayName,
              levelCode: currentBoss.levelCode,
              encounterId: currentBoss.encounterId,
              hpPercentage: currentBoss.hpPercentage,
              remainingHp: currentBoss.remainingHp
            }
          : null,
        tokens:
          (liveGuildRaid ?? tokenData?.guildRaid)
            ? {
                current: (liveGuildRaid ?? tokenData!.guildRaid!).current,
                max: (liveGuildRaid ?? tokenData!.guildRaid!).max,
                nextInSeconds: (liveGuildRaid ?? tokenData!.guildRaid!)
                  .nextInSeconds
              }
            : null,
        // Bomb-range inputs; when missing, bomb logic is skipped.
        bombs: liveBombs ?? tokenData?.bombs ?? null,
        bombDamagePerBomb: nextMoveSignals?.bombDamagePerBomb ?? null,
        bombRangeEncounterIds: nextMoveSignals?.bombRangeEncounterIds ?? null,
        guildBombsAvailable: nextMoveSignals?.guildBombsAvailable ?? null,
        // Warding is the only hard suppressor; missing values degrade to `unknown`.
        mainWarded: nextMoveSignals?.mainWarded ?? null,
        // Live primes steer toward the primes; `undefined` falls back to mainWarded.
        primeTargets,
        currentBossValue: nextMoveEconomy?.currentBossValue ?? null,
        alternatives: nextMoveEconomy?.alternatives ?? [],
        encounterHref: getHrefWithSeason('/boss-playbooks', season)
      }),
    [
      profile.player_id,
      currentBoss,
      tokenData,
      season,
      nextMoveSignals,
      nextMoveEconomy,
      primeTargets,
      liveGuildRaid,
      liveBombs
    ]
  )

  // Token-alert nudge slide (self-gating); off in the officer view, which has no rail.
  const {
    eligible: tokenAlertNudgeEligible,
    linked: tokenAlertNudgeLinked,
    dismissed: tokenAlertNudgeDismissed,
    dismiss: dismissTokenAlertNudge
  } = useTokenAlertNudge({ enabled: !officerView })

  const announcements = useMemo(
    () =>
      withTokenAlertSlide(newsItems, {
        eligible: tokenAlertNudgeEligible,
        linked: tokenAlertNudgeLinked,
        dismissed: tokenAlertNudgeDismissed
      }),
    [
      newsItems,
      tokenAlertNudgeEligible,
      tokenAlertNudgeLinked,
      tokenAlertNudgeDismissed
    ]
  )

  const onDismissAnnouncement = useCallback(
    (id: string) => {
      if (id === TOKEN_ALERT_NUDGE_ID) dismissTokenAlertNudge()
    },
    [dismissTokenAlertNudge]
  )

  const seasonEnds =
    hasMounted && forecast?.season
      ? formatTimeRemaining(forecast.season.seconds_remaining)
      : null

  return (
    <div className="mx-auto max-w-[1760px] space-y-4 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        {officerView ? (
          <div>
            {/* Visually hidden h1 keeps the heading outline for screen readers. */}
            <h1 className="sr-only">
              Officer intelligence{guildName ? ` — ${guildName}` : ''}
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-(--accent)">
              Command / Officer briefing
            </p>
            <p className="mt-1 text-lg font-bold text-primary-wh40k">
              Officer intelligence
            </p>
            <p className="mt-0.5 max-w-2xl text-sm text-secondary-wh40k">
              Roster-aware coaching, team optimization, and recognition—ranked
              by what will matter next.
            </p>
          </div>
        ) : (
          <div>
            {/* Visually hidden h1 keeps the heading outline for screen readers. */}
            <h1 className="sr-only">
              Daily briefing{guildName ? ` — ${guildName}` : ''}
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-(--accent)">
              Command / Daily briefing
            </p>
            <p className="mt-1 text-sm text-secondary-wh40k">
              {guildName ? `${guildName} · ` : ''}
              <span className="font-semibold text-primary-wh40k">
                {playerName}
              </span>
              {rankLabel ? ` · ${rankLabel}` : ''}
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          {canSeeOfficerView && (
            <div
              className="flex rounded-lg border border-(--card-border) bg-(--bg-primary) p-1"
              role="tablist"
              aria-label="Briefing view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!officerView}
                onClick={() => setView('member')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  !officerView
                    ? 'bg-card/60 text-primary-wh40k'
                    : 'text-secondary-wh40k'
                }`}
              >
                My briefing
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={officerView}
                onClick={() => setView('officer')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                  officerView
                    ? 'bg-card/60 text-primary-wh40k'
                    : 'text-secondary-wh40k'
                }`}
              >
                Officer view
              </button>
            </div>
          )}
          {seasonEnds && (
            <div className="rounded-lg border border-(--card-border) bg-(--bg-primary) px-3 py-2 text-xs text-secondary-wh40k">
              Season ends{' '}
              <span className="font-semibold text-primary-wh40k">
                {seasonEnds}
              </span>
            </div>
          )}
        </div>
      </header>

      {officerView ? (
        <OfficerBriefing season={season} guildCode={profile.guild_code} />
      ) : (
        <>
          {/* Token availability and announcements first; mobile drops the carousel. */}
          <TokenAvailabilityWithBoundary
            guildRaidTokens={tokenData?.guildRaid}
            bombTokens={tokenData?.bombs}
            hasPlayerApiKey={hasPlayerApiKey}
            onLiveTokens={onLiveTokens}
          />

          {/* Gated on the merged list so the nudge alone renders the rail; hidden on mobile. */}
          {announcements.length > 0 && (
            <div className="hidden sm:block">
              <AnnouncementSlot
                items={announcements}
                dismissibleIds={DISMISSIBLE_ANNOUNCEMENT_IDS}
                onDismissItem={onDismissAnnouncement}
              />
            </div>
          )}

          {sinceLastVisit && sinceLastVisit.deltas.length > 0 && (
            <SinceLastVisitStrip
              deltas={sinceLastVisit.deltas}
              snapshotAtIso={sinceLastVisit.snapshotAtIso}
            />
          )}

          {/* minmax(0,1fr): WebKit sizes an auto track to the LapChart's max-content and overflows. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.9fr_1fr]">
            <YourNextMoveCard move={move} />
            <SeasonOutlookCard
              forecast={forecast}
              outlook={seasonOutlook ?? null}
              isOfficer={isOfficer}
              guildCode={profile.guild_code}
            />
          </div>

          {primeTargets && primeTargets.length > 0 && (
            <PrimeTargetsCard targets={primeTargets} />
          )}

          {bossPerformance && (
            <BossPerformanceTable
              data={bossPerformance}
              seasonNumber={season}
            />
          )}
        </>
      )}
    </div>
  )
}
