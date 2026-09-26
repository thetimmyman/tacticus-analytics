import { permanentRedirect } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

export const metadata = createPageMetadata({
  title: 'Boss Assignment Season Planner',
  description:
    'Legacy route for guild raid season planning that forwards officers to the active boss assignments season view.'
})

export default function BossSeasonPlannerPage() {
  permanentRedirect('/boss-assignments/season')
}
