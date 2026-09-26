'use client'

import { useEffect, useState, useCallback } from 'react'

interface VersionInfo {
  buildId: string
  buildTime: string
  version: string
  refreshRequiredToken: string | null
}

const CHECK_INTERVAL = 5 * 60 * 1000 // Check every 5 minutes

// Not credentials: opaque deploy markers, kept so the banner does not re-prompt.
const BUILD_STORAGE_KEY = 'app-build-id'
const REFRESH_TOKEN_STORAGE_KEY = 'app-refresh-required-token'
const DISMISSED_REFRESH_TOKEN_STORAGE_KEY =
  'app-dismissed-refresh-required-token'

function normalizeRefreshRequiredToken(
  value: string | null | undefined
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedToken = value.trim()
  return normalizedToken.length > 0 ? normalizedToken : null
}

function syncStoredRefreshRequiredToken(refreshRequiredToken: string | null) {
  if (refreshRequiredToken) {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshRequiredToken)
    return
  }

  localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
}

function storeActiveVersion(versionInfo: VersionInfo) {
  localStorage.setItem(BUILD_STORAGE_KEY, versionInfo.buildId)
  syncStoredRefreshRequiredToken(
    normalizeRefreshRequiredToken(versionInfo.refreshRequiredToken)
  )
}

/** Polls /api/version every 5 minutes; prompts only when refreshRequiredToken advances. */
export function VersionChecker() {
  const [newVersionAvailable, setNewVersionAvailable] = useState(false)
  const [isVisible, setIsVisible] = useState(true)
  const [pendingRefreshRequiredToken, setPendingRefreshRequiredToken] =
    useState<string | null>(null)

  const checkVersion = useCallback(async () => {
    try {
      const response = await fetch('/api/version', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      })

      if (!response.ok) return

      const data: VersionInfo = await response.json()
      const latestRefreshRequiredToken = normalizeRefreshRequiredToken(
        data.refreshRequiredToken
      )
      const storedBuildId = localStorage.getItem(BUILD_STORAGE_KEY)
      const storedRefreshRequiredToken = normalizeRefreshRequiredToken(
        localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)
      )
      const dismissedRefreshRequiredToken = normalizeRefreshRequiredToken(
        localStorage.getItem(DISMISSED_REFRESH_TOKEN_STORAGE_KEY)
      )

      if (!storedBuildId) {
        storeActiveVersion({
          ...data,
          refreshRequiredToken: latestRefreshRequiredToken
        })
        return
      }

      if (storedBuildId === data.buildId) {
        syncStoredRefreshRequiredToken(latestRefreshRequiredToken)

        if (
          dismissedRefreshRequiredToken &&
          dismissedRefreshRequiredToken === latestRefreshRequiredToken
        ) {
          localStorage.removeItem(DISMISSED_REFRESH_TOKEN_STORAGE_KEY)
        }

        return
      }

      const shouldPromptForRefresh = Boolean(
        latestRefreshRequiredToken &&
        latestRefreshRequiredToken !== storedRefreshRequiredToken &&
        latestRefreshRequiredToken !== dismissedRefreshRequiredToken
      )

      if (shouldPromptForRefresh) {
        setPendingRefreshRequiredToken(latestRefreshRequiredToken)
        setNewVersionAvailable(true)
        setIsVisible(true)
        return
      }

      storeActiveVersion({
        ...data,
        refreshRequiredToken: latestRefreshRequiredToken
      })
      setPendingRefreshRequiredToken(null)
      setNewVersionAvailable(false)

      if (
        dismissedRefreshRequiredToken &&
        dismissedRefreshRequiredToken === latestRefreshRequiredToken
      ) {
        localStorage.removeItem(DISMISSED_REFRESH_TOKEN_STORAGE_KEY)
      }
    } catch {
      // Fail silently.
    }
  }, [])

  useEffect(() => {
    // Asynchronous, not a direct setState in the effect.
    const handleMount = async () => {
      await checkVersion()
    }
    handleMount()

    const interval = setInterval(checkVersion, CHECK_INTERVAL)

    return () => clearInterval(interval)
  }, [checkVersion])

  const handleRefresh = () => {
    localStorage.removeItem(BUILD_STORAGE_KEY)
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    localStorage.removeItem(DISMISSED_REFRESH_TOKEN_STORAGE_KEY)
    window.location.reload()
  }

  const handleDismiss = () => {
    if (pendingRefreshRequiredToken) {
      localStorage.setItem(
        DISMISSED_REFRESH_TOKEN_STORAGE_KEY,
        pendingRefreshRequiredToken
      )
    }

    setIsVisible(false)
    setNewVersionAvailable(false)
  }

  if (!newVersionAvailable || !isVisible) {
    return null
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-blue-600 text-white px-4 py-2 flex items-center justify-center gap-4 shadow-lg">
      <span className="text-sm font-medium">
        A refresh is required to apply the latest update.
      </span>
      <button
        onClick={handleRefresh}
        className="px-3 py-1 bg-white text-blue-600 rounded text-sm font-semibold hover:bg-blue-50 transition-colors"
      >
        Refresh Now
      </button>
      <button
        onClick={handleDismiss}
        className="text-white/80 hover:text-white text-sm underline"
      >
        Later
      </button>
    </div>
  )
}
