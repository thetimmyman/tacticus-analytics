import { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle2,
  Target,
  Rocket,
  TrendingUp,
  Heart,
  ExternalLink
} from 'lucide-react'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import type { ReleaseStage } from '@/app/components/release/ReleaseStageBadge'

// Duplicated from release-stage.ts to avoid a server/client boundary issue.
const STAGE_BG_COLOR: Record<ReleaseStage, string> = {
  alpha: 'bg-red-500/15',
  beta: 'bg-blue-500/15',
  coming_soon: 'bg-gray-500/15',
  public: 'bg-green-500/15'
}

const STAGE_BORDER_COLOR: Record<ReleaseStage, string> = {
  alpha: 'border-red-500/30',
  beta: 'border-blue-500/30',
  coming_soon: 'border-card-border/30',
  public: 'border-green-500/30'
}

const STAGE_TEXT_COLOR: Record<ReleaseStage, string> = {
  alpha: 'text-red-500',
  beta: 'text-blue-500',
  coming_soon: 'text-secondary-wh40k',
  public: 'text-green-500'
}

type FeatureRow = {
  feature_key: string
  display_name: string
  description: string | null
  release_stage: ReleaseStage
  route: string | null
  sort_order: number
}

type RoadmapSection = {
  id: string
  label: string
  timeframe: string
  summary: string
  stages: ReleaseStage[]
}

const ROADMAP_SECTIONS: RoadmapSection[] = [
  {
    id: 'live',
    label: 'Live Features',
    timeframe: 'Available Now',
    summary: 'Production-ready features available to all users.',
    stages: ['public']
  },
  {
    id: 'beta',
    label: 'Beta Testing',
    timeframe: 'In Testing',
    summary: 'Features being validated with beta testers before wider release.',
    stages: ['beta']
  },
  {
    id: 'alpha',
    label: 'Alpha Development',
    timeframe: 'Experimental',
    summary:
      'Early-stage features in active development. Available to alpha testers.',
    stages: ['alpha']
  },
  {
    id: 'upcoming',
    label: 'Planned Work',
    timeframe: 'Planned',
    summary:
      'Features accepted onto the roadmap but not yet in active testing.',
    stages: ['coming_soon']
  }
]

async function getFeatures(): Promise<FeatureRow[]> {
  const client = serviceDb()
  const { data, error } = await client
    .from('feature_releases')
    .select(
      'feature_key, display_name, description, release_stage, route, sort_order'
    )
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Failed to fetch features:', error)
    return []
  }

  return (data || []) as FeatureRow[]
}

export const metadata: Metadata = {
  title: 'Product Roadmap | Tacticus Analytics',
  description:
    'Live roadmap for Tacticus Analytics. Track public features, test releases, and planned guild raid workflows.'
}

export const revalidate = 300

export default async function ProductRoadmapPage() {
  let authData = null
  try {
    authData = await getAuthUser()
  } catch {
    // Guest.
  }
  const features = await getFeatures()

  const groupedFeatures = ROADMAP_SECTIONS.map((section) => ({
    ...section,
    features: features.filter((f) => section.stages.includes(f.release_stage))
  })).filter((section) => section.features.length > 0)

  return (
    <div className="min-h-screen bg-linear-to-b from-(--bg-from) via-(--bg-via) to-(--bg-to)">
      <NavigationServer user={authData?.user} profile={authData?.profile} />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5 pointer-events-none" />

        <header className="relative text-center mb-16 space-y-6">
          <p className="inline-flex items-center gap-2 px-4 py-1 rounded-full text-xs font-semibold tracking-[0.3em] uppercase text-(--accent) bg-(--card-bg) border border-(--card-border)">
            <Rocket className="h-3.5 w-3.5" /> Roadmap
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl md:text-5xl font-bold text-primary-wh40k">
              Product Roadmap
            </h1>
            <p className="text-lg text-secondary-wh40k max-w-3xl mx-auto">
              Real-time view of feature development across all release stages.
              Statuses update automatically as features progress through alpha,
              beta, and public release.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 rounded-md bg-primary-wh40k px-5 py-3 text-lg font-semibold text-black shadow-[0_12px_35px_rgba(0,0,0,0.35)] hover:bg-[color-mix(in_srgb,var(--primary)_90%,transparent)]"
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </header>

        <section className="relative mb-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {[
            {
              icon: Target,
              label: 'Dynamic Statuses',
              desc: 'Feature stages update in real-time from our release system.'
            },
            {
              icon: TrendingUp,
              label: 'Transparent Progress',
              desc: 'Track features from alpha through public release.'
            },
            {
              icon: CheckCircle2,
              label: 'Direct Links',
              desc: 'Jump straight to live features from the roadmap.'
            }
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-(--card-border) bg-card/80 p-6 shadow-lg shadow-black/10"
            >
              <item.icon className="h-6 w-6 text-(--accent) mb-4" />
              <h3 className="text-lg font-semibold text-primary-wh40k">
                {item.label}
              </h3>
              <p className="text-sm text-secondary-wh40k mt-2">{item.desc}</p>
            </div>
          ))}
        </section>

        <section className="space-y-10">
          {groupedFeatures.map((section) => (
            <div
              key={section.id}
              className="rounded-3xl border border-(--card-border) bg-card/90 p-8 shadow-2xl shadow-black/20"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
                <div>
                  <p className="text-sm uppercase tracking-[0.4em] text-(--accent)">
                    {section.timeframe}
                  </p>
                  <h2 className="text-2xl md:text-3xl font-bold text-primary-wh40k mt-1">
                    {section.label}
                  </h2>
                  <p className="text-secondary-wh40k mt-2 max-w-3xl">
                    {section.summary}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {section.stages.map((stage) => (
                    <ReleaseStageBadge key={stage} stage={stage} size="md" />
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {section.features.map((feature) => (
                  <div
                    key={feature.feature_key}
                    className={`rounded-2xl border p-5 ${STAGE_BORDER_COLOR[feature.release_stage]} ${STAGE_BG_COLOR[feature.release_stage]}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <h3 className="text-xl font-semibold text-primary-wh40k">
                        {feature.display_name}
                      </h3>
                      <ReleaseStageBadge
                        stage={feature.release_stage}
                        size="sm"
                      />
                    </div>
                    <p className="text-secondary-wh40k text-sm mb-4">
                      {feature.description || 'No description available.'}
                    </p>
                    {feature.route &&
                      (feature.release_stage === 'public' ||
                        feature.release_stage === 'beta') && (
                        <Link
                          href={feature.route}
                          className={`inline-flex items-center gap-1 text-sm font-medium ${STAGE_TEXT_COLOR[feature.release_stage]} hover:underline`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open Feature
                        </Link>
                      )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="mt-16 rounded-3xl border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-linear-to-r from-[color-mix(in_srgb,var(--primary)_10%,transparent)] to-(--card-bg) p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Heart className="h-5 w-5 text-(--primary)" />
                <h3 className="text-2xl font-bold text-primary-wh40k">
                  Support Development
                </h3>
              </div>
              <p className="text-secondary-wh40k max-w-xl">
                Tacticus Analytics is 100% free. If you find it useful, you can
                leave a tip — purely optional.
              </p>
            </div>
            <Link
              href="/support-creator"
              className="inline-flex items-center gap-2 rounded-lg bg-primary-wh40k px-6 py-3 text-lg font-semibold text-black hover:bg-[color-mix(in_srgb,var(--primary)_90%,transparent)] whitespace-nowrap"
            >
              <Heart className="h-5 w-5" />
              Support Us
            </Link>
          </div>
        </section>

        <section className="mt-10 rounded-3xl border border-(--card-border) bg-card/60 p-8 text-center">
          <h3 className="text-xl font-bold text-primary-wh40k mb-3">
            Have Feature Requests?
          </h3>
          <p className="text-secondary-wh40k">
            Join our Discord community or reach out via the #app-support channel
            to share feedback and feature ideas.
          </p>
        </section>
      </div>
    </div>
  )
}
