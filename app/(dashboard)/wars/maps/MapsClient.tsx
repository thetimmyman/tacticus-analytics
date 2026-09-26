'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Map as MapIcon, Target } from 'lucide-react'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'
import { dbClient } from '@/app/lib/db/client'
import { useActiveWar } from '@/app/(dashboard)/wars/_hooks/useWarZoneData'
import ZoneManagement from '@/app/(dashboard)/wars/_components/ZoneManagement'
import GuildWarBattlefields from '@/app/(dashboard)/wars/maps/_components/GuildWarBattlefields'

interface MapsClientProps {
  guildCode: string
  userRole: string
}

type MapsTab = 'map' | 'zones'

export default function MapsClient({ guildCode, userRole }: MapsClientProps) {
  const [tab, setTab] = useState<MapsTab>('map')

  // useActiveWar shares its query key, so no duplicate fetch.
  const { data: activeWar } = useActiveWar(guildCode)
  const { data: settings } = useQuery({
    queryKey: ['guildWarSettings', guildCode],
    queryFn: async () => {
      const supabase = dbClient()
      const { data } = await supabase
        .from('guild_war_settings')
        .select('preferred_battlefield_level')
        .eq('guild_code', guildCode)
        .single()
      return data
    },
    enabled: !!guildCode,
    staleTime: 5 * 60 * 1000
  })

  const activeWarId = activeWar?.war_id
  const preferredBattlefieldLevel = settings?.preferred_battlefield_level as
    (1 | 2 | 3 | 4 | 5) | undefined

  // Wars do not store the season, so the zone types this guild fought pick the layout.
  const { data: observedZoneTypes } = useQuery({
    queryKey: ['guildWarObservedZoneTypes', guildCode],
    queryFn: async () => {
      const supabase = dbClient()
      const { data } = await supabase
        .from('guild_war_zones')
        .select('zone_type')
        .eq('guild_code', guildCode)
        .limit(500)
      return Array.from(
        new Set((data ?? []).map((r) => r.zone_type).filter(Boolean))
      ) as string[]
    },
    enabled: !!guildCode,
    staleTime: 30 * 60 * 1000
  })

  return (
    <div className="space-y-6">
      <div className="px-4 pt-6">
        <PageTabsSubnav
          ariaLabel="War maps sections"
          value={tab}
          onValueChange={(value) => setTab(value as MapsTab)}
          tabs={[
            {
              value: 'map',
              label: 'War Map',
              icon: <MapIcon className="h-3.5 w-3.5" />
            },
            {
              value: 'zones',
              label: 'Zone Planner',
              icon: <Target className="h-3.5 w-3.5" />
            }
          ]}
        />
      </div>

      {tab === 'map' ? (
        <div className="px-4 pb-6">
          <GuildWarBattlefields observedZoneTypes={observedZoneTypes} />
        </div>
      ) : (
        <div className="px-4 pb-6">
          <ZoneManagement
            guildCode={guildCode}
            userRole={userRole}
            activeWarId={activeWarId}
            preferredBattlefieldLevel={preferredBattlefieldLevel}
          />
        </div>
      )}
    </div>
  )
}
