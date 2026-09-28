import { Metadata } from 'next'
import { NavigationServer } from '@/app/components/NavigationServer'
import { getAuthUser } from '@/app/lib/auth'
import { ContentCreators } from '@/app/components/homepage/ContentCreators'
import { Button } from '@tacticus/ui-kit'
import {
  Mail,
  Users,
  Star,
  Heart,
  ArrowRight,
  MessageCircle
} from 'lucide-react'
import Link from 'next/link'
import { CONTACT_EMAIL } from '@tacticus/app-core/app-config'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Content Creators | Tacticus Analytics',
  description:
    'Find Tacticus strategy guides, planning tools, roster resources, and community creators.',
  openGraph: {
    title: 'Content Creators | Tacticus Analytics',
    description:
      'Find Tacticus strategy guides, planning tools, roster resources, and community creators.',
    type: 'website'
  }
}

export default async function CreatorsPage() {
  const authData = await getAuthUser()

  return (
    <div className="min-h-screen bg-linear-to-b from-(--bg-from) via-(--bg-via) to-(--bg-to)">
      {/* Navigation */}
      <NavigationServer user={authData?.user} profile={authData?.profile} />

      {/* Background Effects */}
      <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5 pointer-events-none"></div>
      <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-(--accent) to-transparent"></div>

      {/* Main Content */}
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-linear-to-r from-(--accent) to-(--primary) mb-6">
            Community Creators
          </h1>
          <p className="text-xl text-secondary-wh40k max-w-3xl mx-auto leading-relaxed">
            Browse Tacticus creators, planning tools, roster references, and
            guild raid resources used by the community.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/community/roadmap"
              className="inline-flex items-center gap-2 rounded-md bg-primary-wh40k px-5 py-3 text-lg font-semibold text-black shadow-[0_12px_35px_rgba(0,0,0,0.35)] hover:bg-[color-mix(in_srgb,var(--primary)_90%,transparent)]"
            >
              View Product Roadmap
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 rounded-md border border-(--card-border) px-5 py-3 text-lg font-semibold text-primary-wh40k hover:bg-(--bg-secondary)"
            >
              Start Onboarding
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Featured Creators Section */}
        <div className="mb-16">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-primary-wh40k mb-4 tracking-wide">
              <span className="bg-linear-to-r from-(--primary) to-(--accent) bg-clip-text text-transparent">
                TACTICUS
              </span>{' '}
              COMMUNITY CREATORS
            </h2>
            <p className="text-lg text-secondary-wh40k max-w-2xl mx-auto">
              Community resources for guild raid planning, roster work, and
              strategy
            </p>
          </div>

          {/* Content Creators Component */}
          <ContentCreators />
        </div>

        {/* Call to Action Section */}
        <div className="mb-16">
          <div className="bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] p-8">
            <div className="text-center">
              <h2 className="text-2xl md:text-3xl font-bold text-(--accent) mb-6">
                Join Our Creator Community
              </h2>
              <p className="text-lg text-secondary-wh40k mb-8 max-w-3xl mx-auto">
                Do you maintain Tacticus guides, tools, videos, or roster
                resources? Send the details and we&rsquo;ll review them for the
                creator directory.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-6 bg-linear-to-br from-(--card-bg) to-(--bg-primary) rounded-lg border border-(--card-border) hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] transition-all duration-300">
                  <Users className="h-8 w-8 text-(--accent) mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
                    Community Recognition
                  </h3>
                  <p className="text-sm text-secondary-wh40k">
                    Get listed alongside resources used by active guilds
                  </p>
                </div>

                <div className="text-center p-6 bg-linear-to-br from-(--card-bg) to-(--bg-primary) rounded-lg border border-(--card-border) hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] transition-all duration-300">
                  <Heart className="h-8 w-8 text-(--accent) mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
                    Support & Exposure
                  </h3>
                  <p className="text-sm text-secondary-wh40k">
                    We&rsquo;ll help promote your content and connect you with
                    other creators
                  </p>
                </div>

                <div className="text-center p-6 bg-linear-to-br from-(--card-bg) to-(--bg-primary) rounded-lg border border-(--card-border) hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] transition-all duration-300">
                  <Star className="h-8 w-8 text-(--accent) mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-primary-wh40k mb-2">
                    Creator Network
                  </h3>
                  <p className="text-sm text-secondary-wh40k">
                    Join a network of passionate creators and collaborate on
                    projects
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Contact Form Section */}
        <div className="mb-16">
          <div className="bg-linear-to-r from-[color-mix(in_srgb,var(--bg-primary)_50%,transparent)] to-(--card-bg) rounded-lg border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl md:text-3xl font-bold text-(--accent) mb-4">
                Get Featured
              </h2>
              <p className="text-lg text-secondary-wh40k max-w-2xl mx-auto">
                Want to be included on this page? Send us a message with
                information about your content and we&rsquo;ll review it for
                inclusion in our creator highlights.
              </p>
            </div>

            <ContactForm />
          </div>
        </div>

        {/* Footer Message */}
        <div className="text-center">
          <h3 className="text-xl font-semibold text-(--accent) mb-4">
            Connect with the Community
          </h3>
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-6 mb-8">
            <Link
              href="https://discord.gg/vd9Htx6Xs4"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-6 py-3 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg font-medium transition-colors"
            >
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
              Join our Discord
            </Link>
            <Link
              href="/acknowledgements"
              className="inline-flex items-center px-6 py-3 bg-linear-to-br from-(--card-bg) to-(--bg-primary) border border-(--card-border) hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] text-primary-wh40k rounded-lg font-medium transition-all duration-300"
            >
              <Heart className="mr-2 h-4 w-4" aria-hidden="true" />
              View Acknowledgements
            </Link>
          </div>
          <p className="text-secondary-wh40k text-sm">
            Thanks to the creators and maintainers who keep Tacticus resources
            useful for the community.
          </p>
        </div>
      </div>
    </div>
  )
}

function ContactForm() {
  if (!CONTACT_EMAIL) return null
  return (
    <form
      action={`mailto:${CONTACT_EMAIL}`}
      method="post"
      encType="text/plain"
      className="max-w-2xl mx-auto"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-secondary-wh40k mb-2"
          >
            Your Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            required
            className="w-full px-4 py-3 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k placeholder:text-secondary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent"
            placeholder="Enter your name"
          />
        </div>

        <div>
          <label
            htmlFor="platform"
            className="block text-sm font-medium text-secondary-wh40k mb-2"
          >
            Primary Platform
          </label>
          <select
            id="platform"
            name="platform"
            required
            className="w-full px-4 py-3 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent"
          >
            <option value="">Select platform</option>
            <option value="YouTube">YouTube</option>
            <option value="TikTok">TikTok</option>
            <option value="Twitch">Twitch</option>
            <option value="Website/Blog">Website/Blog</option>
            <option value="Google Sheets">Google Sheets</option>
            <option value="GitHub">GitHub</option>
            <option value="Reddit">Reddit</option>
            <option value="Discord">Discord</option>
            <option value="Other">Other</option>
          </select>
        </div>
      </div>

      <div className="mb-6">
        <label
          htmlFor="content-url"
          className="block text-sm font-medium text-secondary-wh40k mb-2"
        >
          Content URL
        </label>
        <input
          type="url"
          id="content-url"
          name="content-url"
          required
          className="w-full px-4 py-3 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k placeholder:text-secondary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent"
          placeholder="https://..."
        />
      </div>

      <div className="mb-6">
        <label
          htmlFor="content-type"
          className="block text-sm font-medium text-secondary-wh40k mb-2"
        >
          Type of Content
        </label>
        <select
          id="content-type"
          name="content-type"
          required
          className="w-full px-4 py-3 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent"
        >
          <option value="">Select content type</option>
          <option value="Strategy Guides">Strategy Guides</option>
          <option value="Video Tutorials">Video Tutorials</option>
          <option value="Planning Tools">Planning Tools</option>
          <option value="Data Analytics">Data Analytics</option>
          <option value="Team Compositions">Team Compositions</option>
          <option value="Boss Strategies">Boss Strategies</option>
          <option value="Entertainment">Entertainment</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <div className="mb-8">
        <label
          htmlFor="description"
          className="block text-sm font-medium text-secondary-wh40k mb-2"
        >
          Content Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          required
          className="w-full px-4 py-3 bg-(--card-bg) border border-(--card-border) rounded-lg text-primary-wh40k placeholder:text-secondary-wh40k focus:outline-hidden focus:ring-2 focus:ring-(--accent) focus:border-transparent resize-vertical"
          placeholder="Tell us about your content, what makes it unique, and why the community would find it valuable..."
        />
      </div>

      <div className="text-center">
        <Button
          type="submit"
          className="inline-flex items-center px-8 py-3 bg-linear-to-r from-(--primary) to-(--accent) hover:brightness-110 text-(--bg-primary) font-semibold rounded-lg transition-all duration-200"
        >
          <Mail className="w-5 h-5 mr-2" />
          Send Request
        </Button>
        <p className="text-sm text-secondary-wh40k mt-4">
          This will open your email client with a pre-filled message for the
          Tacticus Analytics team.
        </p>
      </div>
    </form>
  )
}
