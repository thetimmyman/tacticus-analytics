'use client'

import { useState } from 'react'
import { Crown, Upload } from 'lucide-react'
import { PageTabsSubnav } from '@/app/components/navigation/PageTabsSubnav'
import WarStrategy from '@/app/(dashboard)/wars/_components/WarStrategy'
import WarDataImport from '@/app/(dashboard)/wars/_components/WarDataImport'

export default function ConfigClient({
  guildCode,
  userRole
}: {
  guildCode: string
  userRole: string
}) {
  const [tab, setTab] = useState<'strategy' | 'import'>('strategy')

  return (
    <div className="px-4 py-6 space-y-4 md:space-y-6">
      <PageTabsSubnav
        ariaLabel="War Config sections"
        value={tab}
        onValueChange={(value) => setTab(value as 'strategy' | 'import')}
        tabs={[
          {
            value: 'strategy',
            label: 'Strategy',
            icon: <Crown className="h-3.5 w-3.5" />
          },
          {
            value: 'import',
            label: 'Manual Import',
            icon: <Upload className="h-3.5 w-3.5" />
          }
        ]}
      />

      {tab === 'strategy' && (
        <WarStrategy guildCode={guildCode} userRole={userRole} />
      )}
      {tab === 'import' && (
        <WarDataImport guildCode={guildCode} userRole={userRole} />
      )}
    </div>
  )
}
