import PlayerPerformanceClient from '@/app/components/performance/PlayerPerformanceClient'
import { PerformanceFAQ } from '@/app/components/performance'

interface PlayerPerformancePageProps {
  selectedGuild: string
  selectedSeason: string
  userGuild?: string
  userRole?: string
  canManageTargets?: boolean
}

export default function PlayerPerformanceContainer(
  props: PlayerPerformancePageProps
) {
  return (
    <div className="container-modern py-6 space-y-6">
      <PlayerPerformanceClient {...props} />
      <PerformanceFAQ />
    </div>
  )
}
