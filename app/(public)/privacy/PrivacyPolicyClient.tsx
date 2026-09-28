'use client'

import { useState } from 'react'
import { CONTACT_EMAIL } from '@tacticus/app-core/app-config'

function EmailReveal() {
  const [revealed, setRevealed] = useState(false)

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="text-(--accent) hover:text-(--primary) underline text-sm"
      >
        [Click to reveal email address]
      </button>
    )
  }

  return (
    <span className="text-(--accent) font-mono text-sm">{CONTACT_EMAIL}</span>
  )
}

export default function PrivacyPolicyClient() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-(--primary) mb-8">
          Privacy Policy
        </h1>

        <div className="prose prose-invert max-w-none space-y-6">
          <div className="bg-(--card) border border-(--card-border) rounded-lg p-6">
            <p className="text-sm text-secondary-wh40k mb-4">
              Last updated: September 9, 2026
            </p>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold text-(--accent)">
                1. Information We Collect
              </h2>
              <div className="text-primary-wh40k space-y-2">
                <p>
                  We collect information you provide directly to us, including:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Account information (email, username, display name)</li>
                  <li>Guild information (guild code, guild name, rankings)</li>
                  <li>
                    Game data (API keys, battle performance, player statistics)
                  </li>
                  <li>
                    Guild member data (in-game player names and performance
                    metrics, derived automatically from guild API keys)
                  </li>
                  <li>Discord integration data (webhook URLs, role IDs)</li>
                  <li>Communication preferences and settings</li>
                </ul>
                <p className="mt-4 text-sm text-secondary-wh40k">
                  <strong>Note on player names:</strong> Player names displayed
                  in the Service are in-game pseudonyms chosen by users within
                  Warhammer 40,000: Tacticus. We do not collect real names,
                  email addresses, or other personal identifiers of guild
                  members who have not registered accounts with our Service.
                </p>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                2. How We Use Your Information
              </h2>
              <div className="text-primary-wh40k space-y-2">
                <p>We use the information we collect to:</p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Provide and maintain our services</li>
                  <li>Process and display guild raid analytics</li>
                  <li>Send Discord notifications (if enabled)</li>
                  <li>Communicate with you about your account</li>
                  <li>Improve and optimize our services</li>
                  <li>Comply with legal obligations</li>
                </ul>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                3. Legal Basis for Processing
              </h2>
              <div className="text-primary-wh40k space-y-2">
                <p>
                  Processing your account and game data (Section 1) is necessary
                  to provide the Service you signed up for &mdash; you supply
                  your own Tacticus API key and we return analytics of your own
                  data. This relies on{' '}
                  <strong>
                    Article 6(1)(b) GDPR, performance of a contract
                  </strong>
                  : the Service cannot function without it, so it is not
                  something we ask you to consent to.
                </p>
                <p>
                  Delivering coaching tasks to Discord is a separate, optional
                  feature. The Service works fully without it, so this relies on{' '}
                  <strong>Article 6(1)(a) GDPR, your consent</strong>. You can
                  decline or withdraw this consent at any time without losing
                  access to anything else.
                </p>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                4. Data Security
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  We implement appropriate technical and organizational measures
                  to protect your personal information, including:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                  <li>Encryption of sensitive data (API keys)</li>
                  <li>Secure HTTPS connections</li>
                  <li>Row Level Security (RLS) policies in our database</li>
                  <li>Regular security audits and updates</li>
                </ul>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                5. Data Sharing
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  We do not sell, trade, or rent your personal information to
                  third parties. We may share your information only:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                  <li>
                    With your guild members (performance data, statistics)
                  </li>
                  <li>With cluster administrators (if you join a cluster)</li>
                  <li>
                    With members of guilds in your cluster, who can view
                    per-battle data
                  </li>
                  <li>
                    On public Explore and leaderboard pages, where selected
                    values may be obscured
                  </li>
                  <li>When required by law or legal process</li>
                  <li>To protect our rights or safety</li>
                </ul>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                6. Data Retention
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  We retain your information for as long as your account is
                  active or as needed to provide services. You may request
                  deletion of your data by contacting us.
                </p>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                7. Your Rights
              </h2>
              <div className="text-primary-wh40k">
                <p>You have the right to:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                  <li>Access your personal information</li>
                  <li>Correct inaccurate data</li>
                  <li>Request deletion of your data</li>
                  <li>Object to processing of your data</li>
                  <li>Export your data</li>
                  {/* Named separately: the one thing we hold that cannot be revoked at source. */}
                  <li>
                    Withdraw an uploaded game credential at any time, from the
                    Guild War or Replays settings page
                  </li>
                </ul>
                <div className="mt-4 p-4 bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] rounded-lg">
                  <p className="text-sm">
                    <strong>To exercise these rights:</strong> See our{' '}
                    <a
                      href="/privacy-rights"
                      className="text-(--accent) hover:underline"
                    >
                      Privacy Rights
                    </a>{' '}
                    page or contact us directly.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                8. Cookies
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  We use essential cookies to maintain your session and
                  preferences. We do not use tracking or advertising cookies.
                </p>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                9. Children&apos;s Privacy
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  Our services are not directed to children under 13. We do not
                  knowingly collect information from children under 13.
                </p>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                10. Changes to This Policy
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  We may update this privacy policy from time to time. We will
                  notify you of any changes by posting the new policy on this
                  page.
                </p>
              </div>
            </section>

            <section className="space-y-4 mt-8">
              <h2 className="text-2xl font-semibold text-(--accent)">
                11. Contact Us
              </h2>
              <div className="text-primary-wh40k">
                <p>
                  If you have any questions about this Privacy Policy, please
                  contact us through:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                  {CONTACT_EMAIL ? (
                    <li>
                      Email: <EmailReveal />
                    </li>
                  ) : null}
                  <li>Discord: Join our server via the cluster</li>
                  <li>GitHub: Report issues on our repository</li>
                </ul>
              </div>
            </section>
          </div>
        </div>

        {/* Temporarily hidden - uncomment when ready to launch */}
      </div>
    </div>
  )
}
