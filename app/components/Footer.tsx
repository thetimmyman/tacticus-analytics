'use client'

import Link from 'next/link'
import VersionFooter from '@/app/components/VersionFooter'

interface FooterProps {
  variant?: 'default' | 'minimal'
}

export default function Footer({ variant = 'default' }: FooterProps) {
  return (
    <footer className="border-t border-red-500/30 pt-6 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {variant === 'default' ? (
          <div className="text-center">
            <div className="flex items-center justify-center space-x-4 my-4">
              <div className="h-px bg-light flex-1 max-w-16"></div>
              <span
                className="h-1 w-1 rounded-full bg-secondary"
                aria-hidden="true"
              />
              <div className="h-px bg-light flex-1 max-w-16"></div>
            </div>

            {/* Creator Attribution */}
            <div className="mb-4 text-secondary">
              <p className="font-medium text-primary">Created by TimmyMan</p>
              <p className="text-sm">for the Tacticus community</p>
            </div>

            {/* Links */}
            <div className="flex flex-wrap justify-center gap-4 mb-4 text-sm">
              <Link
                href="/faq"
                className="text-secondary-wh40k hover:text-white"
              >
                FAQ
              </Link>
              <Link
                href="/acknowledgements"
                className="text-secondary-wh40k hover:text-white"
              >
                Acknowledgements
              </Link>
              <Link
                href="/privacy"
                className="text-secondary-wh40k hover:text-white"
              >
                Privacy
              </Link>
              <Link
                href="/terms"
                className="text-secondary-wh40k hover:text-white"
              >
                Terms
              </Link>
              <Link
                href="/do-not-sell"
                className="text-secondary-wh40k hover:text-white"
              >
                Do Not Sell My Personal Information
              </Link>
            </div>

            <div className="flex items-center justify-center space-x-4 my-4">
              <div className="h-px bg-light flex-1 max-w-16"></div>
              <span
                className="h-1 w-1 rounded-full bg-secondary"
                aria-hidden="true"
              />
              <div className="h-px bg-light flex-1 max-w-16"></div>
            </div>

            {/* Support options */}
            <div className="text-sm text-secondary mb-4">
              {/* Desktop - single line */}
              <p className="hidden sm:block">
                Support me with referral code{' '}
                <span className="font-mono bg-card px-2 py-1 rounded-sm text-accent-wh40k font-semibold">
                  TEN-05-BID
                </span>{' '}
                or{' '}
                <a
                  href="https://buymeacoffee.com/TimmyMan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-wh40k hover:text-white underline transition-colors"
                >
                  Buy me a Coffee
                </a>{' '}
                or{' '}
                <a
                  href="https://www.patreon.com/c/thetimmyman?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#FF424D] hover:text-white underline transition-colors"
                >
                  Patreon
                </a>
              </p>

              {/* Mobile - 4 lines */}
              <div className="sm:hidden text-center space-y-1">
                <p>Support me by</p>
                <p>
                  using my referral code{' '}
                  <span className="font-mono bg-card px-2 py-1 rounded-sm text-accent-wh40k font-semibold">
                    TEN-05-BID
                  </span>
                </p>
                <p>or</p>
                <p>
                  <a
                    href="https://buymeacoffee.com/TimmyMan"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-wh40k hover:text-white underline transition-colors"
                  >
                    Buy me a Coffee
                  </a>{' '}
                  or{' '}
                  <a
                    href="https://www.patreon.com/c/thetimmyman?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#FF424D] hover:text-white underline transition-colors"
                  >
                    Patreon
                  </a>
                </p>
              </div>
            </div>

            {/* Copyright */}
            <div className="pt-2 border-t border-light mt-4">
              <p className="text-xs text-secondary mb-3">
                © 2025 Tacticus Analytics. All rights reserved.
              </p>
              <p className="text-xs text-secondary leading-relaxed mb-3">
                Warhammer 40,000: Tacticus © Copyright Games Workshop Limited
                2025. Tacticus, the Tacticus logo, GW, Games Workshop, Space
                Marine, 40K, Warhammer, Warhammer 40,000, 40,000, the
                &apos;Aquila&apos; Double-headed Eagle logo, and all associated
                logos, illustrations, images, names, creatures, races, vehicles,
                locations, weapons, characters, and the distinctive likeness
                thereof, are either ® or TM, and/or © Games Workshop Limited,
                variably registered around the world, and used under licence.
                All rights reserved to their respective owners.
              </p>
              <p className="text-xs text-secondary">
                &apos;Snowprint&apos;, &apos;Snowprint Studios&apos; and the
                Snowprint logo © Copyright Snowprint Studios AB 2025.
              </p>
              <div className="mt-2">
                <VersionFooter />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-xs text-secondary">© 2025 Tacticus Analytics</p>
            <div className="mt-2">
              <VersionFooter />
            </div>
          </div>
        )}
      </div>
    </footer>
  )
}
