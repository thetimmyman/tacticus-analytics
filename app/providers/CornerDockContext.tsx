'use client'

/**
 * While a Tech Priest dock is mounted, the globally rendered SyncStatusPanel
 * hides its floating chip. Ref-counted to stay balanced under StrictMode.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react'

interface CornerDockContextValue {
  dockActive: boolean
  registerDock: () => () => void
}

const CornerDockContext = createContext<CornerDockContextValue>({
  dockActive: false,
  registerDock: () => () => {}
})

export function CornerDockProvider({
  children
}: {
  children: React.ReactNode
}) {
  const [count, setCount] = useState(0)

  const registerDock = useCallback(() => {
    setCount((c) => c + 1)
    return () => setCount((c) => Math.max(0, c - 1))
  }, [])

  const value = useMemo(
    () => ({ dockActive: count > 0, registerDock }),
    [count, registerDock]
  )

  return (
    <CornerDockContext.Provider value={value}>
      {children}
    </CornerDockContext.Provider>
  )
}

export function useCornerDock(): CornerDockContextValue {
  return useContext(CornerDockContext)
}
