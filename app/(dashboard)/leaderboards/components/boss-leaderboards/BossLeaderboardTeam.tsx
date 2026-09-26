import {
  parseHeroDetails,
  parseMachineOfWarDetails,
  type HeroMapping
} from '@/app/lib/utils/battle-log-helpers'
import type { BossLeaderboardEntry } from './model'

interface BossLeaderboardTeamProps {
  entry: Pick<BossLeaderboardEntry, 'heroDetails' | 'machineOfWarDetails'>
  heroMappings: Map<string, HeroMapping>
  variant: 'mobile' | 'desktop'
}

export function BossLeaderboardTeam({
  entry,
  heroMappings,
  variant
}: BossLeaderboardTeamProps) {
  const heroes = parseHeroDetails(entry.heroDetails)
  const mow = parseMachineOfWarDetails(entry.machineOfWarDetails)
  const mowMapping = mow ? heroMappings.get(mow) : undefined

  if (variant === 'mobile' && heroes.length === 0 && !mow) return null

  const size = variant === 'mobile' ? 48 : 60
  const heroKeyPrefix = variant === 'mobile' ? 'hero' : 'table-hero'

  const team = (
    <div className="flex items-center gap-0.5">
      {heroes.map((heroId) => {
        const mapping = heroMappings.get(heroId)
        const heroKey = `${heroKeyPrefix}-${heroId}`
        return mapping?.web_icon_url ? (
          <img
            key={heroKey}
            src={mapping.web_icon_url}
            alt={mapping.display_name || heroId}
            title={mapping.display_name || heroId}
            width={size}
            height={size}
            className="rounded"
          />
        ) : (
          <span
            key={heroKey}
            className="text-xs text-[var(--text-secondary)]"
            title={heroId}
          >
            {heroId}
          </span>
        )
      })}
      {mow && (
        <>
          <span className="mx-1 text-[var(--text-secondary)]">|</span>
          {mowMapping?.web_icon_url ? (
            <img
              src={mowMapping.web_icon_url}
              alt={mowMapping.display_name || mow}
              title={mowMapping.display_name || mow}
              width={size}
              height={size}
              className="rounded border border-[var(--primary)]"
            />
          ) : variant === 'mobile' ? (
            <span className="text-xs text-[var(--text-secondary)]" title={mow}>
              {mow}
            </span>
          ) : (
            <span className="text-xs text-[var(--text-secondary)]">MoW</span>
          )}
        </>
      )}
    </div>
  )

  if (variant === 'desktop') return team

  return (
    <div className="pt-2 border-t border-[var(--card-border)]">
      <div className="text-xs text-[var(--text-secondary)] mb-1">
        Team Composition:
      </div>
      {team}
    </div>
  )
}
