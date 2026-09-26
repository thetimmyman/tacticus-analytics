'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { dbClient } from '@/app/lib/db/client'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { Users, Star, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface HeroMapping {
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
}

interface RosterGap {
  hero_name: string
  appears_in_meta_teams: number
  damage_boost_potential: number
  boss_types: string[]
}

interface RosterGapsCardProps {
  rosterGaps: RosterGap[]
}

export function RosterGapsCard({ rosterGaps }: RosterGapsCardProps) {
  const [heroMappings, setHeroMappings] = useState<Map<string, HeroMapping>>(
    new Map()
  )

  useEffect(() => {
    const loadHeroMappings = async () => {
      try {
        const supabase = dbClient()
        const { data: mappings } = await supabase
          .from('hero_mappings')
          .select('unit_id, display_name, web_icon_url')
          .not('web_icon_url', 'is', null)

        if (mappings) {
          const mappingsMap = new Map<string, HeroMapping>()
          mappings.forEach((m) => {
            if (m.display_name) {
              mappingsMap.set(m.display_name, m)
              mappingsMap.set(m.display_name.toLowerCase(), m)
            }
          })
          setHeroMappings(mappingsMap)
        }
      } catch (err) {
        console.error('Failed to load hero mappings:', err)
      }
    }

    loadHeroMappings()
  }, [])

  const getHeroIcon = (displayName: string): string | null => {
    const mapping =
      heroMappings.get(displayName) ||
      heroMappings.get(displayName.toLowerCase())
    return mapping?.web_icon_url || null
  }

  if (rosterGaps.length === 0) {
    return null
  }

  return (
    <Card className="bg-[var(--card-bg)] border-[var(--card-border)]">
      <CardContent className="py-4">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-[var(--accent)]" />
          <h3 className="text-sm font-medium text-[var(--text-primary)]">
            Heroes You're Missing in Meta Teams
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rosterGaps.slice(0, 6).map((gap, idx) => {
            const iconUrl = getHeroIcon(gap.hero_name)

            return (
              <div
                key={gap.hero_name}
                className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] hover:bg-[color-mix(in_srgb,var(--bg-secondary)_80%,transparent)] transition-colors"
              >
                <div className="relative flex-shrink-0">
                  {iconUrl ? (
                    <img
                      src={iconUrl}
                      alt={gap.hero_name}
                      className="w-10 h-10 rounded"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-[var(--card-bg)] flex items-center justify-center text-[var(--text-secondary)] text-sm font-medium">
                      {gap.hero_name.slice(0, 2)}
                    </div>
                  )}
                  {idx < 3 && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center">
                      <Star
                        className="w-2.5 h-2.5 text-yellow-900"
                        fill="currentColor"
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {gap.hero_name}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Used in {gap.appears_in_meta_teams} top teams
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {gap.boss_types.slice(0, 3).map((boss) => (
                      <span
                        key={boss}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-bg)] text-[var(--text-secondary)]"
                      >
                        {getBossDisplayName(boss).slice(0, 8)}
                      </span>
                    ))}
                    {gap.boss_types.length > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--card-bg)] text-[var(--text-secondary)]">
                        +{gap.boss_types.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                <Link
                  href={`/meta-atlas?hero=${encodeURIComponent(gap.hero_name)}`}
                  className="flex-shrink-0 p-1 rounded hover:bg-[var(--card-bg)] transition-colors"
                  title="View in Meta Atlas"
                >
                  <ExternalLink className="w-4 h-4 text-[var(--text-secondary)]" />
                </Link>
              </div>
            )
          })}
        </div>

        {rosterGaps.length > 6 && (
          <div className="mt-3 text-center">
            <span className="text-xs text-[var(--text-secondary)]">
              +{rosterGaps.length - 6} more heroes appear in top meta teams
            </span>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-[var(--card-border)]">
          <p className="text-xs text-[var(--text-secondary)]">
            These heroes frequently appear in top-performing teams for bosses
            you've fought, but are not in your roster. If you have a Player API
            key configured, this list is cross-referenced with your actual
            roster.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
