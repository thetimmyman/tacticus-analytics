import { permanentRedirect } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

// Legacy route: /current's season selector covers "upcoming".
export const metadata = createPageMetadata({
  title: 'Upcoming Season Assignments',
  description:
    'Legacy route for upcoming boss assignments that forwards officers to the season-aware boss assignments landing.'
})

export default function UpcomingAssignmentsPage() {
  permanentRedirect('/boss-assignments/current')
}
