import Link from 'next/link'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { Metadata } from 'next'
import { CONTACT_EMAIL } from '@tacticus/app-core/app-config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your Privacy Rights - Tacticus Analytics | GDPR & Privacy Rights',
  description:
    'Learn about your privacy rights under GDPR, CCPA, and other data protection regulations.',
  keywords:
    'gdpr, privacy rights, data protection, ccpa, personal data, privacy laws'
}

export default async function PrivacyRightsPage() {
  const authData = await getAuthUser()

  return (
    <div className="min-h-screen bg-(--bg-primary) text-primary-wh40k">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-(--primary) mb-8">
            Your Privacy Rights
          </h1>

          <div className="prose prose-invert max-w-none space-y-6">
            <div className="bg-(--card) border border-(--card-border) rounded-lg p-6">
              <p className="text-sm text-secondary-wh40k mb-6">
                Last updated: October 12, 2025
              </p>

              <section className="space-y-4">
                <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
                  <h2 className="text-xl font-semibold text-(--accent) mb-3">
                    Know Your Rights
                  </h2>
                  <p className="text-primary-wh40k">
                    You have important rights regarding your personal data. This
                    page explains your rights under various privacy laws
                    including GDPR, CCPA, and other applicable data protection
                    regulations.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Your Rights Under GDPR
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>
                    If you are located in the European Union, you have the
                    following rights:
                  </p>
                  <div className="grid gap-4 mt-4">
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        1. Right to Information
                      </h3>
                      <p className="text-sm">
                        You have the right to know what personal data we collect
                        and how we use it.
                      </p>
                    </div>
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        2. Right of Access
                      </h3>
                      <p className="text-sm">
                        You can request a copy of all personal data we hold
                        about you.
                      </p>
                    </div>
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        3. Right to Rectification
                      </h3>
                      <p className="text-sm">
                        You can request corrections to any inaccurate personal
                        data.
                      </p>
                    </div>
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        4. Right to Erasure (&quot;Right to be Forgotten&quot;)
                      </h3>
                      <p className="text-sm">
                        You can request deletion of your personal data in
                        certain circumstances.
                      </p>
                    </div>
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        5. Right to Restrict Processing
                      </h3>
                      <p className="text-sm">
                        You can limit how we process your personal data in
                        certain situations.
                      </p>
                    </div>
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        6. Right to Data Portability
                      </h3>
                      <p className="text-sm">
                        You can receive your personal data in a structured,
                        machine-readable format.
                      </p>
                    </div>
                    <div className="bg-card/30 border border-card-border/30 rounded-lg p-4">
                      <h3 className="font-semibold text-(--accent) mb-2">
                        7. Right to Object
                      </h3>
                      <p className="text-sm">
                        You can object to processing of your personal data for
                        direct marketing or other purposes.
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  California Privacy Rights (CCPA)
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>
                    If you are a California resident, you have these additional
                    rights:
                  </p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>
                      <strong>Right to Know:</strong> What personal information
                      we collect and how it&#39;s used
                    </li>
                    <li>
                      <strong>Right to Delete:</strong> Request deletion of your
                      personal information
                    </li>
                    <li>
                      <strong>Right to Opt-Out:</strong> Opt out of the sale of
                      personal information (we don&#39;t sell data)
                    </li>
                    <li>
                      <strong>Right to Non-Discrimination:</strong> Equal
                      service regardless of exercising privacy rights
                    </li>
                  </ul>
                  <div className="mt-4">
                    <a
                      href="/do-not-sell"
                      className="text-(--accent) hover:underline"
                    >
                      → Visit our CCPA &quot;Do Not Sell&quot; page
                    </a>
                  </div>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  How We Handle Your Data
                </h2>
                <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-4">
                  <h3 className="font-semibold text-(--accent) mb-2">
                    Our Commitment
                  </h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li>
                      We collect only data necessary for guild analytics and
                      gameplay
                    </li>
                    <li>We don&#39;t sell or rent your personal information</li>
                    <li>We use encryption to protect sensitive data</li>
                    <li>
                      We limit private data access to guild members and
                      necessary staff; public Explore and leaderboard pages may
                      show obscured values
                    </li>
                    <li>
                      We regularly review and update our privacy practices
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
                    To exercise any of your privacy rights, contact us with the
                    following information:
                  </p>
                  <div className="bg-amber-900/20 border border-amber-500/50 rounded-lg p-4">
                    <h3 className="font-semibold mb-2">
                      Required Information:
                    </h3>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                      <li>Your full name and player name</li>
                      <li>Email address associated with your account</li>
                      <li>Guild name and cluster (if applicable)</li>
                      <li>
                        Specific request type (access, deletion, correction,
                        etc.)
                      </li>
                      <li>Proof of identity (for security purposes)</li>
                    </ul>
                  </div>

                  <div className="mt-4">
                    <h3 className="font-semibold text-(--accent) mb-2">
                      Response Time:
                    </h3>
                    <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
                      <li>
                        <strong>GDPR requests:</strong> Within 30 days (may
                        extend to 60 days for complex requests)
                      </li>
                      <li>
                        <strong>CCPA requests:</strong> Within 45 days (may
                        extend to 90 days for complex requests)
                      </li>
                      <li>
                        <strong>General inquiries:</strong> Within 7 business
                        days
                      </li>
                    </ul>
                  </div>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Data Retention
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>We retain your personal data only as long as necessary:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>
                      <strong>Active accounts:</strong> While your account
                      remains active
                    </li>
                    <li>
                      <strong>Inactive accounts:</strong> Up to 2 years after
                      last activity
                    </li>
                    <li>
                      <strong>Guild analytics:</strong> For historical
                      comparison and guild management
                    </li>
                    <li>
                      <strong>Legal compliance:</strong> As required by
                      applicable laws
                    </li>
                  </ul>
                  <p className="text-sm text-secondary-wh40k mt-3">
                    You can request deletion of your data at any time, subject
                    to legal retention requirements.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Supervisory Authority
                </h2>
                <div className="text-primary-wh40k space-y-3">
                  <p>
                    If you believe we have not handled your privacy rights
                    appropriately, you have the right to lodge a complaint with:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>
                      <strong>EU residents:</strong> Your local data protection
                      authority
                    </li>
                    <li>
                      <strong>California residents:</strong> California Attorney
                      General&#39;s Office
                    </li>
                    <li>
                      <strong>Others:</strong> Your local privacy or consumer
                      protection agency
                    </li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Contact Information
                </h2>
                <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4">
                  <h3 className="font-semibold text-(--accent) mb-2">
                    Privacy Officer
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {CONTACT_EMAIL ? (
                      <li>
                        <strong>Email:</strong> {CONTACT_EMAIL}
                      </li>
                    ) : null}
                    <li>
                      <strong>Subject Line:</strong> Privacy Rights Request
                    </li>
                    <li>
                      <strong>Response Time:</strong> Within 7 business days
                    </li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-(--accent)">
                  Related Information
                </h2>
                <div className="text-primary-wh40k space-y-2">
                  <p>For additional privacy information, please see:</p>
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
                        href="/do-not-sell"
                        className="text-(--accent) hover:underline"
                      >
                        Do Not Sell My Personal Information (CCPA)
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
