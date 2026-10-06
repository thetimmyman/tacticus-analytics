'use client'

import { useEffect, useState } from 'react'

export function DesktopGameStatus() {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let mounted = true,
      busy = false
    const controller = new AbortController()
    const refresh = async () => {
      if (busy) return
      busy = true
      try {
        const response = await fetch('/desktop/onboarding-status', {
          cache: 'no-store',
          signal: controller.signal
        })
        if (!response.ok) return
        const value: unknown = await response.json()
        if (mounted)
          setConnected(
            Boolean(
              value &&
              typeof value === 'object' &&
              'playerReady' in value &&
              value.playerReady === true
            )
          )
      } catch {
        /* Local status is optional; offline analytics remains usable. */
      } finally {
        busy = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, 10000)
    const focused = () => {
      void refresh()
    }
    window.addEventListener('focus', focused)
    return () => {
      mounted = false
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', focused)
    }
  }, [])
  return (
    <span className="ml-2" role="status">
      {connected ? 'Player access configured.' : 'Connect your Player API key.'}{' '}
      <a href="/desktop/connect" className="underline">
        Manage API access and sync
      </a>
    </span>
  )
}
