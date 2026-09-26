import BriefingPage from '@/app/components/briefing/BriefingPage'
import { isAlphaDeploymentEnvironment } from '@/app/lib/utils/deployment-environment'
import { loadNextMoveSignalsWithTimeout } from '@/app/lib/briefing/load-next-move-signals'
import { loadPrimeTargetsWithTimeout } from '@/app/lib/briefing/load-prime-targets'
import { loadTokenEconomyWithTimeout } from '@/app/lib/briefing/load-token-economy'
import { buildNextMoveEconomyInputs } from '@/app/lib/briefing/build-next-move-economy'
import { loadSinceLastVisit } from '@/app/lib/briefing/load-since-last-visit'
import { loadMemberBossPerformance } from '@/app/lib/briefing/load-member-boss-performance'
import { getLandingPageData } from '@/app/lib/dashboard/home-summary'
import { getLandingPageRpcData } from '@/app/lib/dashboard/home-summary-rpc'
import { getLatestSeason } from '@/app/lib/utils/season'
// The client logger drops warn/info in production.
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('home.page')
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { db } from '@/app/lib/db'
import { EmptyState } from '@tacticus/ui-kit'
import { fetchSeasonForecast } from '@/app/lib/season-forecast/forecast-service'
import { computeSeasonOutlookWithTimeout } from '@/app/lib/season-forecast/season-outlook-projection'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
import type { NewsItem } from '@/app/components/landing/NewsBanner'
import type { LandingPageData } from '@/app/lib/dashboard/home-summary-types'
import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'
import type { AppUser } from '@/app/types'

// A slow forecast RPC must never block first paint; on timeout the widget hides.
async function fetchForecastWithTimeout(
  guildCode: string,
  seasonNumber: number,
  userId: string
): Promise<SeasonForecastEnvelope | null> {
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), 5000)
  })
  const fetchPromise = (async () => {
    try {
      const supabase = await db()
      // /home is member-accessible: aggregates plus the caller's own row only.
      return await fetchSeasonForecast(supabase, {
        guildCode,
        seasonNumber,
        includePerPlayer: false,
        userId,
        skipCache: false
      })
    } catch {
      return null
    }
  })()
  return Promise.race([fetchPromise, timeoutPromise])
}

// Cached ~15min per (guild, season); only the first caller after a miss can time out.

export interface ActiveHomePageProps {
  user: AppUser
  searchParams: Promise<{ season?: string }>
}

interface CarouselDbItem {
  id: string
  title: string
  description: string | null
  link_url: string | null
  item_type: 'news' | 'promo' | 'announcement' | 'event'
  promo_code: string | null
  expires_at: string | null
}

function mapCarouselItemToNewsItem(item: CarouselDbItem): NewsItem {
  const typeMap: Record<string, NewsItem['type']> = {
    news: 'feature',
    promo: 'promo',
    announcement: 'announcement',
    event: 'announcement'
  }

  const isExternal = item.link_url?.startsWith('http') ?? false

  return {
    id: item.id,
    type: typeMap[item.item_type] || 'announcement',
    title: item.title,
    description: item.description || '',
    href: item.link_url ?? undefined,
    external: isExternal,
    expiresAt: item.expires_at ? new Date(item.expires_at) : undefined,
    promoCode: item.promo_code ?? undefined
  }
}

async function fetchCarouselItems(): Promise<NewsItem[]> {
  try {
    const supabase = await db()
    const now = new Date().toISOString()

    const { data: items } = await supabase
      .from('carousel_items')
      .select(
        'id, title, description, link_url, item_type, promo_code, expires_at'
      )
      .eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    if (items && items.length > 0) {
      return (items as CarouselDbItem[]).map(mapCarouselItemToNewsItem)
    }
  } catch {
    // Fall back to defaults.
  }
  return []
}

export default async function ActiveHomePage({
  user,
  searchParams
}: ActiveHomePageProps) {
  const params = await searchParams

  const seasonParam = params?.season?.trim()
  // The outlook runs for the current season only.
  const latestSeason = await getLatestSeason()
  const season =
    seasonParam && seasonParam.length > 0 ? seasonParam : latestSeason

  if (!season) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }

  const useRpcHome = process.env.NEXT_PUBLIC_ENABLE_HOME_RPC !== 'false'

  const officerBriefingAccessPromise = checkFeatureAccess(
    user.id,
    'officer_command_center'
  ).catch(() => ({ has_access: false, reason: 'error', stage: null }))

  const isAlpha = isAlphaDeploymentEnvironment()
  const seasonNumberForForecast = Number.parseInt(season, 10)

  const [landingData, carouselItems, forecast, outlook, officerBriefingAccess] =
    await Promise.all([
      (async (): Promise<LandingPageData | null> => {
        if (!user.profile) return null
        try {
          if (useRpcHome) {
            try {
              return await getLandingPageRpcData(user.profile, season)
            } catch (error: unknown) {
              if (
                error instanceof Error &&
                error.name === 'HomeRpcAuthorizationDenied'
              ) {
                // An empty caller-bound result is a membership denial; never rehydrate it via the service-role loader.
                return null
              }
              logger.warn(
                { error: error },
                'Home RPC failed, falling back to legacy home data'
              )
              return await getLandingPageData(user.profile, season)
            }
          } else {
            return await getLandingPageData(user.profile, season)
          }
        } catch (error: unknown) {
          const err = error as {
            message?: string
            code?: string
            hint?: string
          }
          logger.error(
            {
              message: err?.message,
              code: err?.code,
              hint: err?.hint,
              userId: user.id
            },
            'Failed to load landing page data'
          )
          return null
        }
      })(),
      fetchCarouselItems(),
      // Alpha-only, member-safe; null hides the widget.
      (async (): Promise<SeasonForecastEnvelope | null> => {
        const guildCode = user.profile?.guild_code
        if (
          !isAlpha ||
          !guildCode ||
          !Number.isFinite(seasonNumberForForecast)
        ) {
          return null
        }
        return fetchForecastWithTimeout(
          guildCode,
          seasonNumberForForecast,
          user.id
        )
      })(),
      // Current season only; the member-safe variant loads no per-player roster.
      (async (): Promise<SeasonOutlookProjection | null> => {
        const guildCode = user.profile?.guild_code
        if (
          !isAlpha ||
          !guildCode ||
          !Number.isFinite(seasonNumberForForecast) ||
          season !== latestSeason
        ) {
          return null
        }
        return computeSeasonOutlookWithTimeout({ guildCode, season })
      })(),
      officerBriefingAccessPromise
    ])

  const profileForLanding = user.profile
    ? {
        role: user.profile.role,
        guild_code: user.profile.guild_code ?? '',
        cluster_code: user.profile.cluster_code ?? undefined,
        display_name: user.profile.display_name ?? undefined,
        player_id: user.profile.player_id ?? undefined
      }
    : {
        role: user.role,
        guild_code: user.guildCode ?? '',
        cluster_code: undefined,
        display_name: user.displayName ?? undefined,
        player_id: undefined
      }

  // Profile role, distinct from app-admin.
  const profileRole = String(user.profile?.role ?? '').toLowerCase()
  const isOfficerRole =
    profileRole === 'officer' ||
    profileRole === 'leader' ||
    profileRole === 'admin'

  const canSeeOfficerView =
    officerBriefingAccess?.has_access === true && isOfficerRole

  const briefingGuild = user.profile?.guild_code ?? undefined
  const [
    nextMoveSignals,
    sinceLastVisit,
    briefingForecast,
    bossPerformance,
    tokenEconomy,
    seasonOutlook,
    primeTargets
  ] = await Promise.all([
    loadNextMoveSignalsWithTimeout({ guildCode: briefingGuild, season }),
    loadSinceLastVisit({
      userId: user.id,
      guildCode: briefingGuild,
      season
    }),
    forecast ??
      (briefingGuild && Number.isFinite(seasonNumberForForecast)
        ? fetchForecastWithTimeout(
            briefingGuild,
            seasonNumberForForecast,
            user.id
          )
        : Promise.resolve(null)),
    loadMemberBossPerformance({
      guildCode: briefingGuild,
      season,
      displayName: user.profile?.display_name ?? undefined,
      currentBossName: landingData?.currentBoss?.name
    }),
    loadTokenEconomyWithTimeout({ guildCode: briefingGuild, season }),
    // Briefing users may hold the alpha flag while the global gate is off.
    outlook ??
      (briefingGuild
        ? computeSeasonOutlookWithTimeout({
            guildCode: briefingGuild,
            season
          })
        : Promise.resolve(null)),
    loadPrimeTargetsWithTimeout({
      guildCode: briefingGuild,
      season,
      currentBoss: landingData?.currentBoss,
      primeBosses: landingData?.primeBosses
    })
  ])

  const economy = buildNextMoveEconomyInputs({
    currentBossName: landingData?.currentBoss?.name,
    valueRows: bossPerformance.rows,
    upcomingMains: tokenEconomy.upcomingMains
  })
  return (
    <BriefingPage
      profile={profileForLanding}
      seasonNumber={season}
      guildName={landingData?.guildName}
      currentBoss={landingData?.currentBoss}
      tokenData={landingData?.tokenData}
      newsItems={carouselItems.length > 0 ? carouselItems : undefined}
      forecast={briefingForecast}
      nextMoveSignals={nextMoveSignals}
      nextMoveEconomy={economy}
      primeTargets={primeTargets}
      sinceLastVisit={sinceLastVisit}
      canSeeOfficerView={canSeeOfficerView}
      bossPerformance={bossPerformance}
      seasonOutlook={seasonOutlook}
      hasPlayerApiKey={
        landingData?.credentialHealth?.playerApiKey === 'healthy'
      }
    />
  )
}
