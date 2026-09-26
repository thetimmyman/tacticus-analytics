'use client'

import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type {
  ClusterData,
  FoundingGuild,
  FoundingGuildDraft
} from './cluster-types'

const createEmptyGuild = (): FoundingGuildDraft => ({
  guildCode: '',
  displayName: '',
  leaderEmail: '',
  apiKey: ''
})

export function useFoundingGuildDraft(
  data: ClusterData,
  setData: Dispatch<SetStateAction<ClusterData>>
) {
  const [newGuild, setNewGuild] = useState<FoundingGuildDraft>(() =>
    createEmptyGuild()
  )

  const add = () => {
    const sanitized: FoundingGuild = {
      guildCode: newGuild.guildCode.trim().toUpperCase(),
      displayName: newGuild.displayName.trim(),
      leaderEmail: newGuild.leaderEmail.trim(),
      ...(newGuild.apiKey.trim() ? { apiKey: newGuild.apiKey.trim() } : {})
    }
    if (sanitized.guildCode && sanitized.displayName) {
      setData({
        ...data,
        foundingGuilds: [...data.foundingGuilds, sanitized]
      })
      setNewGuild(createEmptyGuild())
    }
  }

  const removeAt = (index: number) => {
    setData({
      ...data,
      foundingGuilds: data.foundingGuilds.filter((_, i) => i !== index)
    })
  }

  return { newGuild, setNewGuild, add, removeAt }
}
