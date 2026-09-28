'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@tacticus/ui-kit'
import { Button } from '@tacticus/ui-kit'
import { Shield, Users, User, ArrowRight, KeyRound } from 'lucide-react'
import DeleteAccountButton from '@/app/(dashboard)/profile/DeleteAccountButton'

const choiceLinkClass =
  'group block h-full rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg-primary)'

function ChoiceCta({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-[44px] w-full items-center justify-between rounded-md bg-accent-wh40k px-4 py-2 font-medium text-(--bg-primary) transition-colors group-hover:bg-[color-mix(in_srgb,var(--accent)_90%,transparent)]">
      {label}
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </span>
  )
}

export default function OnboardingChoice({ userId }: { userId?: string }) {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-(--bg-primary)">
      <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8">
        {/* Navigation buttons above header */}
        <div className="mb-8 flex justify-between items-center">
          <Button variant="outline" onClick={() => router.push('/')}>
            Go Back
          </Button>
          <Button onClick={() => router.push('/creators')}>
            Open Community
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>

        <div className="mb-12 space-y-6">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-(--card-border) bg-(--card-bg) px-4 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-(--accent)">
              <span className="h-2 w-2 rounded-full bg-accent-wh40k" />
              Getting started
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-bold text-primary-wh40k sm:text-5xl">
                Set up your analytics command center
              </h1>
              <p className="max-w-3xl text-base text-secondary-wh40k">
                Choose the path that matches your situation. Already in a guild
                that uses Tacticus Analytics? Linking your account takes two
                minutes. Leading a guild that&apos;s new here? Start with guild
                setup.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Listed first as a wide hero card: members of registered guilds are the largest cohort. */}
          <Link
            href="/onboarding/claim"
            className={`${choiceLinkClass} md:col-span-2`}
          >
            <Card className="flex h-full flex-col border-2 border-emerald-400/40 bg-(--card-bg) shadow-xl transition-all group-hover:border-emerald-400/70 group-hover:shadow-[0_20px_60px_rgba(0,60,30,0.35)]">
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/10 transition-colors group-hover:border-emerald-400 group-hover:bg-emerald-500/20">
                      <KeyRound className="h-6 w-6 text-emerald-300" />
                    </div>
                    <div>
                      <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">
                        I&apos;m in a guild already
                      </span>
                      <CardTitle className="text-2xl text-primary-wh40k">
                        Join Your Existing Guild
                      </CardTitle>
                      <CardDescription className="mt-2 text-secondary-wh40k">
                        Already in a guild that uses Tacticus Analytics? Use the
                        single-use invite issued for your exact roster entry.
                      </CardDescription>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-500/15 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Most common
                  </span>
                </div>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-4 text-sm text-secondary-wh40k md:flex-row md:items-center md:justify-between md:gap-8">
                <ul className="space-y-2">
                  <li>• Validate with your Player API key from the game</li>
                  <li>• Verify your Player ID to match your roster</li>
                  <li>• Unlock member dashboards immediately</li>
                </ul>
                <div className="md:w-64 md:shrink-0">
                  <ChoiceCta label="Link My Account" />
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* The leader flow lives on the onboarding dashboard, which redirects to login with a returnTo. */}
          <Link href="/onboarding/dashboard" className={choiceLinkClass}>
            <Card className="flex h-full flex-col border border-(--card-border) bg-(--card-bg) shadow-xl transition-all group-hover:border-[color-mix(in_srgb,var(--accent)_60%,transparent)] group-hover:shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
              <CardHeader className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-colors group-hover:border-accent-wh40k group-hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]">
                    <Shield className="h-6 w-6 text-(--accent)" />
                  </div>
                  <div>
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-(--accent)">
                      I lead a guild
                    </span>
                    <CardTitle className="text-2xl text-primary-wh40k">
                      Create Guild or Cluster
                    </CardTitle>
                    <CardDescription className="mt-2 text-secondary-wh40k">
                      Register your guild or cluster, validate API keys, and
                      launch your onboarding dashboard.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-4 text-sm text-secondary-wh40k">
                <ul className="space-y-2">
                  <li>
                    • Toggle between single guild and multi-guild cluster
                    onboarding
                  </li>
                  <li>
                    • Enter raid and guild API keys for each leadership team
                  </li>
                  <li>• Queue background sync jobs and monitor progress</li>
                </ul>
                <div>
                  <ChoiceCta label="Launch Leader Setup" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/onboarding/claim" className={choiceLinkClass}>
            <Card className="flex h-full flex-col border border-(--card-border) bg-(--card-bg) shadow-xl transition-all group-hover:border-blue-400/60 group-hover:shadow-[0_20px_60px_rgba(0,0,40,0.35)]">
              <CardHeader className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-blue-400/40 bg-blue-500/10 transition-colors group-hover:border-blue-400 group-hover:bg-blue-500/20">
                    <Users className="h-6 w-6 text-blue-300" />
                  </div>
                  <div>
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-blue-300/80">
                      I have an invite code
                    </span>
                    <CardTitle className="text-2xl text-primary-wh40k">
                      Claim Your Profile
                    </CardTitle>
                    <CardDescription className="mt-2 text-secondary-wh40k">
                      Use an invite code from your guild officer to securely
                      claim your player profile.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-4 text-sm text-secondary-wh40k">
                <ul className="space-y-2">
                  <li>Get an invite code from your guild leader or officer</li>
                  <li>Verify your identity with your Player API key</li>
                  <li>Unlock member dashboards and personal analytics</li>
                </ul>
                <div>
                  <ChoiceCta label="Claim My Profile" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/community/roadmap" className={choiceLinkClass}>
            <Card className="flex h-full flex-col border border-(--card-border) bg-(--card-bg) shadow-xl transition-all group-hover:border-amber-400/60 group-hover:shadow-[0_20px_60px_rgba(60,40,0,0.35)]">
              <CardHeader className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-500/10 transition-colors group-hover:border-amber-400 group-hover:bg-amber-500/20">
                    <User className="h-6 w-6 text-amber-300" />
                  </div>
                  <div>
                    <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-amber-300/80">
                      Just looking
                    </span>
                    <CardTitle className="text-2xl text-primary-wh40k">
                      Product Roadmap
                    </CardTitle>
                    <CardDescription className="mt-2 text-secondary-wh40k">
                      See every initiative in flight, from onboarding repairs to
                      Discord analytics upgrades.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="mt-auto flex flex-col gap-4 text-sm text-secondary-wh40k">
                <ul className="space-y-2">
                  <li>- Review critical, high, and quick-win projects</li>
                  <li>- Follow community updates for beta announcements</li>
                </ul>
                <div>
                  <ChoiceCta label="View Roadmap" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Guildless accounts are bounced here from /profile, so deletion must be reachable here too. */}
        {userId && (
          <div className="mt-12 flex justify-center border-t border-(--card-border) pt-6">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-xs text-secondary-wh40k">
                Decided this isn&apos;t for you?
              </p>
              <DeleteAccountButton userId={userId} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
