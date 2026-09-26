import { useCallback } from 'react'
import type { PlayerRole, PlayerMapping } from '@tacticus/app-core/types'

export function useCanEditMember(userRole: PlayerRole) {
  return useCallback(
    (member: PlayerMapping): boolean => {
      if (userRole === 'leader') return true
      if (userRole === 'officer' && member.role === 'member') return true
      return false
    },
    [userRole]
  )
}
