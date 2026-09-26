'use client'

import { useEffect, useState } from 'react'
import {
  ROSTER_VIEW_MODE_STORAGE_KEY,
  type RosterViewMode
} from './roster-constants'

/** Grid/table preference (shared localStorage key across both roster pages) plus pagination. */
export function useRosterViewState() {
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(60)
  const [viewMode, setViewMode] = useState<RosterViewMode>('grid')

  useEffect(() => {
    const stored = window.localStorage.getItem(ROSTER_VIEW_MODE_STORAGE_KEY)
    if (stored === 'grid' || stored === 'table') {
      // Sync once at mount: a lazy initializer would mismatch on hydration.

      setViewMode(stored)
    }
  }, [])

  const changeViewMode = (mode: RosterViewMode) => {
    setViewMode(mode)
    window.localStorage.setItem(ROSTER_VIEW_MODE_STORAGE_KEY, mode)
  }

  return {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    viewMode,
    changeViewMode
  }
}
