import { NextResponse } from 'next/server'

// Retired (player IDs are not ownership proof); a tombstone so stale clients fail closed.
export function POST() {
  return NextResponse.json(
    {
      error: 'This claim flow has been retired. Use a single-use invite code.',
      code: 'CLAIM_FLOW_RETIRED',
      claim_url: '/onboarding/claim'
    },
    { status: 410 }
  )
}
