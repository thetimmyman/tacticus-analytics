'use client'

import { useState } from 'react'
import BossLeaderboards from './components/BossLeaderboards'
import OverallLeaderboard from './components/OverallLeaderboard'
import MetaAnalysisClient from './meta-analysis/MetaAnalysisClient'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'
import type { UserProfile } from '@/app/lib/auth'

interface ClusterStatsClientProps {
  profile: UserProfile
  latestSeason: string
}

// Public leaderboard surface; cluster analytics/management live under /guild-ops.
export default function ClusterStatsClient({
  profile,
  latestSeason
}: ClusterStatsClientProps) {
  const tabs = [
    { value: 'overall', label: 'Overall' },
    { value: 'leaderboards', label: 'Boss Leaderboards' },
    { value: 'meta-analysis', label: 'Meta Analysis' }
  ]

  const [activeTab, setActiveTab] = useState('overall')
  const [mountedTabs, setMountedTabs] = useState<Set<string>>(
    () => new Set(['overall'])
  )

  const handleTabChange = (nextTab: string) => {
    setActiveTab(nextTab)
    setMountedTabs((prev) => {
      if (prev.has(nextTab)) {
        return prev
      }
      const updated = new Set(prev)
      updated.add(nextTab)
      return updated
    })
  }

  const isTabMounted = (tabId: string) => mountedTabs.has(tabId)

  return (
    <div className="space-y-6">
      <PageTabsSubnav
        ariaLabel="Cluster Stats sections"
        value={activeTab}
        onValueChange={handleTabChange}
        tabs={tabs}
      />

      {activeTab === 'overall' && isTabMounted('overall') && (
        <div className="mt-6">
          <OverallLeaderboard
            season={latestSeason}
            userGuild={profile.guild_code ?? ''}
          />
        </div>
      )}

      {activeTab === 'leaderboards' && isTabMounted('leaderboards') && (
        <div className="mt-6">
          <BossLeaderboards
            initialSeason={latestSeason}
            userGuild={profile.guild_code ?? ''}
          />
        </div>
      )}

      {activeTab === 'meta-analysis' && isTabMounted('meta-analysis') && (
        <div className="mt-6">
          <MetaAnalysisClient initialSeason={latestSeason} />
        </div>
      )}
    </div>
  )
}
