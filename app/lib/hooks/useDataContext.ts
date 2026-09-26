'use client'

import { useEffect, useState } from 'react'
import {
  getUserDataContextClient,
  type UserDataContext
} from '@/app/lib/utils/data-access'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.hooks.useDataContext')

export function useDataContext() {
  const [context, setContext] = useState<UserDataContext>({
    clusterCode: null,
    guildCode: null,
    guildDisplayName: null,
    guildTag: null,
    guildLabel: null,
    hasClusterAccess: false,
    hasGuildAccess: false,
    accessLevel: 'none'
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getUserDataContextClient()
      .then((ctx) => {
        setContext(ctx)
        setLoading(false)
      })
      .catch((error) => {
        logger.error({ err: error }, 'Error getting data context:')
        setLoading(false)
      })
  }, [])

  return { context, loading }
}

/** @deprecated Use useDataContext() instead for proper access control. */
export function useClusterContext(): string | null {
  const { context } = useDataContext()
  return context.clusterCode
}
