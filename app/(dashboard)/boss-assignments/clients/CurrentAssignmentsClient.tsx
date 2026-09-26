'use client'

import UpcomingAssignmentsClient, {
  type UpcomingAssignmentsClientProps
} from '@/app/(dashboard)/guild-management/upcoming-assignments/UpcomingAssignmentsClient'

export default function CurrentAssignmentsClient(
  props: UpcomingAssignmentsClientProps
) {
  return <UpcomingAssignmentsClient {...props} mode="current" />
}
