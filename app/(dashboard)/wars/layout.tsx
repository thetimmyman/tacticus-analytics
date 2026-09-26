import { WarSubnavWrapper } from './_components/WarSubnavWrapper'
import { WarsFAQ } from './_components/WarsFAQ'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Guild War Tracking',
  description:
    'Track active wars, maps, lineups, cores, offense hero results, and defense hero performance for guild war planning.'
})

export default function WarsLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="space-y-6">
      <WarSubnavWrapper />
      {children}
      <WarsFAQ />
    </div>
  )
}
