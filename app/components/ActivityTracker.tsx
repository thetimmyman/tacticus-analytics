'use client'

import { useEffect, useRef } from 'react'

const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000

export function ActivityTracker() {
  const lastUpdate = useRef<number>(0)

  useEffect(() => {
    const now = Date.now()
    if (now - lastUpdate.current < ACTIVITY_THROTTLE_MS) {
      return
    }

    lastUpdate.current = now
    fetch('/api/user/activity', { method: 'POST' }).catch((err) => {
      // Tracking errors are swallowed (logged in dev).
      if (process.env.NODE_ENV === 'development') {
        console.warn('Activity tracking failed:', err)
      }
    })
  }, [])

  return null
}
