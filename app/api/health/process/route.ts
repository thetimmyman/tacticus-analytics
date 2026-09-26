import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Must await no dependency, or a degraded dependency fails liveness and crash-loops the pod.
export function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
