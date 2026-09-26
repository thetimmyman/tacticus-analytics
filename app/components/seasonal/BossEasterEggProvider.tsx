'use client'

import React, { createContext, useContext, useCallback } from 'react'
import { useLocalStorage } from '@/app/lib/hooks/useLocalStorage'

interface BossEasterEggContextType {
  isBossEasterEggEnabled: boolean
  toggleBossEasterEgg: () => void
  enableBossEasterEgg: () => void
  disableBossEasterEgg: () => void
}

const BossEasterEggContext = createContext<BossEasterEggContextType | null>(
  null
)

export function useBossEasterEgg() {
  const context = useContext(BossEasterEggContext)
  if (!context) {
    throw new Error(
      'useBossEasterEgg must be used within BossEasterEggProvider'
    )
  }
  return context
}

// Safe outside the provider: returns the default.
export function useBossEasterEggSafe(): BossEasterEggContextType {
  const context = useContext(BossEasterEggContext)
  if (!context) {
    return {
      isBossEasterEggEnabled: true,
      toggleBossEasterEgg: () => {},
      enableBossEasterEgg: () => {},
      disableBossEasterEgg: () => {}
    }
  }
  return context
}

const STORAGE_KEY = 'eot-boss-easter-egg'

interface BossEasterEggSettings {
  enabled: boolean
}

export function BossEasterEggProvider({
  children
}: {
  children: React.ReactNode
}) {
  const [settings, setSettings] = useLocalStorage<BossEasterEggSettings>(
    STORAGE_KEY,
    {
      enabled: true // Default to enabled
    }
  )

  const toggleBossEasterEgg = useCallback(() => {
    setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
  }, [setSettings])

  const enableBossEasterEgg = useCallback(() => {
    setSettings((prev) => ({ ...prev, enabled: true }))
  }, [setSettings])

  const disableBossEasterEgg = useCallback(() => {
    setSettings((prev) => ({ ...prev, enabled: false }))
  }, [setSettings])

  const contextValue: BossEasterEggContextType = {
    isBossEasterEggEnabled: settings.enabled,
    toggleBossEasterEgg,
    enableBossEasterEgg,
    disableBossEasterEgg
  }

  return (
    <BossEasterEggContext.Provider value={contextValue}>
      {children}
    </BossEasterEggContext.Provider>
  )
}
