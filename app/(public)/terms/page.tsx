import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Terms and Conditions - Tacticus Analytics | Service Agreement',
  description:
    'Read the terms and conditions for using Tacticus Analytics. Understand your rights and responsibilities when using our guild raid analytics platform.',
  keywords:
    'tacticus analytics terms, service agreement, terms of service, user agreement, legal terms, conditions of use'
}

export default async function TermsAndConditions() {
  const authData = await getAuthUser()

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-[var(--primary)] mb-8">
            Terms and Conditions
          </h1>

          <div className="prose prose-invert max-w-none space-y-6">
            <div className="bg-[var(--card)] border border-[var(--card-border)] rounded-lg p-6">
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Last updated: August 6, 2026
              </p>

              <section className="space-y-4">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  1. Acceptance of Terms
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    By accessing and using Tacticus Analytics (&quot;the
                    Service&quot;), you accept and agree to be bound by the
                    terms and provision of this agreement.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  2. Description of Service
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    Tacticus Analytics provides analytics and tracking services
                    for Warhammer 40,000: Tacticus guild raids. This includes:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>Performance tracking and analytics</li>
                    <li>Guild and cluster management tools</li>
                    <li>Discord integration services</li>
                    <li>Data synchronization with Tacticus API</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  3. User Accounts
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    To use certain features of the Service, you must register
                    for an account. You agree to:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>Provide accurate, current, and complete information</li>
                    <li>Maintain the security of your password and account</li>
                    <li>Promptly update your account information</li>
                    <li>
                      Accept responsibility for all activities under your
                      account
                    </li>
                    <li>Not share your API keys with unauthorized parties</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  4. API Key Usage
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>By providing your Tacticus API keys, you:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>Grant us permission to access your game data</li>
                    <li>Confirm you have the right to share guild API keys</li>
                    <li>
                      Authorize us to process performance data for all members
                      of your guild roster
                    </li>
                    <li>
                      Represent that you have the authority to make this
                      decision as guild leader or authorized officer
                    </li>
                    <li>
                      Understand that API keys are used solely for service
                      functionality
                    </li>
                    <li>
                      Accept that we store API keys securely but cannot
                      guarantee absolute security
                    </li>
                  </ul>
                  <p className="mt-4 text-sm text-[var(--text-secondary)]">
                    Guild member data (in-game names and performance statistics)
                    is derived automatically from your API key. This data
                    consists of in-game pseudonyms and gameplay metrics only—no
                    real-world identity information is collected for
                    non-registered guild members.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  5. Acceptable Use
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>You agree not to:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>Use the Service for any unlawful purpose</li>
                    <li>
                      Attempt to gain unauthorized access to any portion of the
                      Service
                    </li>
                    <li>Interfere with or disrupt the Service</li>
                    <li>Submit false or misleading information</li>
                    <li>Harass, abuse, or harm other users</li>
                    <li>Violate the Tacticus Terms of Service</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  6. Cluster Management
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>If you create or manage a cluster:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>
                      You confirm you have permission from all guild leaders
                    </li>
                    <li>You are responsible for cluster member management</li>
                    <li>You must respect the privacy of cluster members</li>
                    <li>You agree to manage the cluster in good faith</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  7. Intellectual Property
                </h2>
                <div className="text-[var(--text-primary)] space-y-3">
                  <p>
                    The Service and its original content are protected by
                    copyright and other laws. You agree to respect all
                    intellectual property rights.
                  </p>

                  <div className="bg-amber-900/20 border border-amber-500/50 rounded-lg p-4 space-y-2">
                    <p className="text-sm">
                      <strong>Games Workshop Limited:</strong> Warhammer 40,000:
                      Tacticus © Copyright Games Workshop Limited 2025.
                      Tacticus, the Tacticus logo, GW, Games Workshop, Space
                      Marine, 40K, Warhammer, Warhammer 40,000, 40,000, the
                      &apos;Aquila&apos; Double-headed Eagle logo, and all
                      associated logos, illustrations, images, names, creatures,
                      races, vehicles, locations, weapons, characters, and the
                      distinctive likeness thereof, are either ® or TM, and/or ©
                      Games Workshop Limited, variably registered around the
                      world, and used under licence. All rights reserved to
                      their respective owners.
                    </p>
                    <p className="text-sm">
                      <strong>Snowprint Studios:</strong> &apos;Snowprint&apos;,
                      &apos;Snowprint Studios&apos; and the Snowprint logo ©
                      Copyright Snowprint Studios AB 2025.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  8. Disclaimer of Warranties
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p className="font-semibold">
                    THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTY
                    OF ANY KIND, EXPRESS OR IMPLIED.
                  </p>
                  <p className="mt-2">We do not warrant that:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>The Service will be uninterrupted or error-free</li>
                    <li>Defects will be corrected</li>
                    <li>
                      The Service is free of viruses or harmful components
                    </li>
                    <li>The results obtained will be accurate or reliable</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  9. Limitation of Liability
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    IN NO EVENT SHALL WE BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
                    SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF
                    YOUR USE OF THE SERVICE.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  10. Indemnification
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    You agree to indemnify and hold harmless the Service
                    operators from any claims arising from your use of the
                    Service, violation of these Terms, or infringement of any
                    rights.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  11. Termination
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    We may terminate or suspend your account at any time for any
                    reason, including breach of these Terms. You may terminate
                    your account at any time by contacting us.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  12. Changes to Terms
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    We reserve the right to modify these terms at any time. We
                    will notify users of any material changes. Your continued
                    use of the Service constitutes acceptance of the new Terms.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  13. Governing Law
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    These Terms shall be governed by the laws of the
                    jurisdiction in which the Service operator resides, without
                    regard to conflict of law provisions.
                  </p>
                </div>
              </section>

              <section className="space-y-4 mt-8">
                <h2 className="text-2xl font-semibold text-[var(--accent)]">
                  14. Contact Information
                </h2>
                <div className="text-[var(--text-primary)]">
                  <p>
                    For questions about these Terms, please contact us through:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4 mt-2">
                    <li>Discord: Via the cluster server</li>
                    <li>GitHub: Through our repository</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-4 mt-8 border-t border-[var(--card-border)] pt-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  This is a fan-made project and is not affiliated with,
                  endorsed by, or associated with Snowprint Studios or Games
                  Workshop.
                </p>
              </section>
            </div>
          </div>

          <div className="mt-8 text-center">
            <a
              href="/auth/signup"
              className="text-[var(--accent)] hover:text-[var(--primary)] underline"
            >
               Back to Sign Up
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
