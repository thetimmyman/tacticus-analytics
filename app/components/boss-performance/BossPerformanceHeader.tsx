'use client'

import { RefObject } from 'react'
import { Card, CardContent } from '@tacticus/ui-kit'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { formatDamage } from '@tacticus/app-core/formatters'
import { useBossHeaderStats } from '@/app/components/boss-performance/hooks/useBossPerformanceData'

interface BossPerformanceHeaderProps {
  desktopTitleRef: RefObject<HTMLHeadingElement | null>
  mobileTitleRef: RefObject<HTMLHeadingElement | null>
}

export function BossPerformanceHeader({
  desktopTitleRef,
  mobileTitleRef
}: BossPerformanceHeaderProps) {
  const { bossName, bossSlug, level, averageDamage } = useBossHeaderStats()
  return (
    <div className="sticky top-24 lg:top-[88px] z-10 bg-[color-mix(in_srgb,var(--bg-primary)_95%,transparent)] backdrop-blur-xs border-b border-(--card-border)">
      <Card className="bg-transparent border-0 shadow-none">
        <CardContent className="p-4 space-y-4">
          <div className="hidden md:flex items-center justify-between">
            <h1
              ref={desktopTitleRef}
              className="heading-wh40k text-2xl flex items-center gap-4"
            >
              {bossName && bossName !== 'TempBoss' && (
                <BossPortrait
                  bossName={bossName}
                  lookupName={bossSlug}
                  size="header"
                  variant="portrait"
                  className="shrink-0"
                />
              )}
              <span>
                {level} - {bossName}
              </span>
            </h1>
            <div className="text-right">
              <div className="stat-label-wh40k">Average Damage</div>
              <div className="stat-value-wh40k">
                {formatDamage(averageDamage)}
              </div>
            </div>
          </div>

          <div className="md:hidden flex items-center justify-center">
            <h1
              ref={mobileTitleRef}
              className="heading-wh40k text-xl flex items-center gap-3"
            >
              {bossName && bossName !== 'TempBoss' && (
                <BossPortrait
                  bossName={bossName}
                  lookupName={bossSlug}
                  size="header"
                  variant="portrait"
                  className="shrink-0"
                />
              )}
              <span>
                {level} - {bossName}
              </span>
            </h1>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
