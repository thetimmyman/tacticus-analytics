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
        const response = await fetch('/desktop/connection-status', {
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
              'connected' in value &&
              value.connected === true
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
      {connected
        ? 'Official API connected. Sync from File → Game connection.'
        : 'Connect your own official API key from File → Game connection.'}
    </span>
  )
}
