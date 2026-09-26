import Link from 'next/link'
import { AlertTriangle, ArrowRight, Compass } from 'lucide-react'

/** Loads and shows no guild data; the caller returns before importing any guild-data loader. */

interface InactiveHomeProps {
  /** Never a guild identity. */
  displayName?: string
}

const ACTIONS = [
  {
    href: '/onboarding/claim',
    label: 'Link my account',
    description: 'Re-join with a fresh single-use invite from a guild officer.',
    icon: ArrowRight,
    primary: true
  },
  {
    href: '/explore',
    label: 'Explore guilds',
    description: 'Public raid and war standings across every tracked cluster.',
    icon: Compass,
    primary: false
  }
] as const

export default function InactiveHome({ displayName }: InactiveHomeProps) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 text-[var(--text-primary)] sm:px-6">
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <AlertTriangle
              className="h-5 w-5 text-amber-400"
              aria-hidden="true"
            />
          </div>
          <div className="space-y-3">
            <h1 className="text-xl font-bold sm:text-2xl">
              {displayName ? `${displayName}, your` : 'Your'} account is not on
              a current guild roster
            </h1>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              Analytics stay hidden until your account is linked to a guild that
              is actively syncing. This usually means the guild&apos;s API key
              expired or was invalidated, you left the guild, or your roster
              entry was removed.
            </p>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              Your account itself is intact — relinking restores your history.
              If your guild is still active, ask a leader to refresh its API key
              in guild settings, then link again below.
            </p>
          </div>
        </div>

        <ul className="mt-8 space-y-3">
          {ACTIONS.map((action) => {
            const Icon = action.icon
            return (
              <li key={action.href}>
                <Link
                  href={action.href}
                  className={
                    action.primary
                      ? 'flex items-center gap-4 rounded-lg border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]'
                      : 'flex items-center gap-4 rounded-lg border border-[var(--card-border)] px-4 py-3 transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-secondary)]'
                  }
                >
                  <Icon
                    className={
                      action.primary
                        ? 'h-5 w-5 shrink-0 text-[var(--accent)]'
                        : 'h-5 w-5 shrink-0 text-[var(--text-secondary)]'
                    }
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {action.label}
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {action.description}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>

        <p className="mt-6 text-xs text-[var(--text-secondary)]">
          Need a different route?{' '}
          <Link
            href="/onboarding"
            className="underline underline-offset-2 hover:text-[var(--text-primary)]"
          >
            See all onboarding options
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
