import Link from 'next/link'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { Metadata } from 'next'
import { CONTACT_EMAIL } from '@tacticus/app-core/app-config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title:
    'Do Not Sell My Personal Information - Tacticus Analytics | CCPA Rights',
  description:
    'Exercise your California Consumer Privacy Act (CCPA) rights to opt out of the sale of your personal information.',
  keywords:
    'ccpa, do not sell, personal information, privacy rights, california consumer privacy act'
}

export default async function DoNotSellPage() {
  const authData = await getAuthUser()

  return (
    <div className="min-h-screen bg-(--bg-primary) text-primary-wh40k">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-(--primary) mb-8">
            Do Not Sell My Personal Information
          </h1>

          <div className="prose prose-invert max-w-none space-y-6">
            <div className="bg-(--card) border border-(--card-border) rounded-lg p-6">
              <p className="text-sm text-secondary-wh40k mb-6">
                Last updated: October 12, 2025
              </p>

              <section className="space-y-4">
                <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
                  <h2 className="text-xl font-semibold text-(--accent) mb-3">
                    Your California Privacy Rights
                  </h2>
                  <p className="text-primary-wh40k">
                    Under the California Consumer Privacy Act (CCPA) and other
                    privacy laws, you have the right to opt out of the sale or
                    sharing of your personal information. This page allows you
                    to exercise that right.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  What This Means
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>When you opt out, we will:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>
                      Stop sharing your personal information with third parties
                      for advertising purposes
                    </li>
                    <li>Disable personalized advertising features</li>
                    <li>
                      Limit data collection to what is necessary for the
                      functioning of our website
                    </li>
                  </ul>

                  <div className="bg-amber-900/20 border border-amber-500/50 rounded-lg p-3 mt-4">
                    <p className="text-sm">
                      <strong>Please note:</strong> Opting out does not stop all
                      data collection. We still collect basic analytics data to
                      understand how our website is used and to improve our
                      services. Essential functionality will continue to work
                      normally.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Current Status
                </h2>
                <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-4">
                  <p className="text-primary-wh40k font-semibold">
                    We don&apos;t sell your data
                  </p>
                  <p className="text-sm text-secondary-wh40k mt-2">
                    Tacticus Analytics does not sell your personal information.
                    Public Explore and leaderboard pages may show obscured guild
                    values. Members of guilds in the same cluster can view this
                    guild&apos;s per-battle data.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Data Sharing We Do
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>
                    We only share your information in these limited
                    circumstances:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>
                      <strong>Within Your Guild:</strong> Performance data and
                      statistics with guild members
                    </li>
                    <li>
                      <strong>Within Your Cluster:</strong> Members of guilds in
                      your cluster can view per-battle data
                    </li>
                    <li>
                      <strong>Public Surfaces:</strong> Obscured values on
                      Explore and leaderboard pages
                    </li>
                    <li>
                      <strong>Service Providers:</strong> Technical service
                      providers (hosting, analytics) necessary for operation
                    </li>
                    <li>
                      <strong>Legal Requirements:</strong> When required by law
                      or legal process
                    </li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Third-Party Analytics
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>We use Google Analytics to understand website usage:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Data is anonymized and aggregated</li>
                    <li>
                      Used only for improving website performance and user
                      experience
                    </li>
                    <li>
                      You can opt out of Google Analytics tracking through your
                      browser settings
                    </li>
                    <li>
                      Visit{' '}
                      <a
                        href="https://tools.google.com/dlpage/gaoptout"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-(--accent) hover:underline"
                      >
                        Google Analytics Opt-out
                      </a>{' '}
                      for more information
                    </li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Making Privacy Requests
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>
                    For privacy-related requests, contact us through Discord or
                    GitHub as listed in our Privacy Policy. We&apos;ll respond
                    promptly to help with your data privacy needs.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Additional Information
                </h2>
                <div className="text-primary-wh40k space-y-2">
                  <p>
                    For more information about how we handle your personal
                    information, please see our:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>
                      <a
                        href="/privacy"
                        className="text-(--accent) hover:underline"
                      >
                        Privacy Policy
                      </a>
                    </li>
                    <li>
                      <a
                        href="/terms"
                        className="text-(--accent) hover:underline"
                      >
                        Terms of Use
                      </a>
                    </li>
                    <li>
                      <a
                        href="/privacy-rights"
                        className="text-(--accent) hover:underline"
                      >
                        Your Privacy Rights (GDPR)
                      </a>
                    </li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Contact Us
                </h2>
                <div className="text-primary-wh40k">
                  <p>
                    If you have any questions or concerns about your privacy
                    rights, please contact us:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    {CONTACT_EMAIL ? (
                      <li>
                        <strong>Email:</strong> {CONTACT_EMAIL}
                      </li>
                    ) : null}
                    <li>
                      <strong>Subject:</strong> CCPA Privacy Request
                    </li>
                  </ul>
                </div>
              </section>
            </div>
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/"
              className="text-(--accent) hover:text-(--primary) underline"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
