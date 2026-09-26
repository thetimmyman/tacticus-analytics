'use client'

import { useEffect, useMemo, useState } from 'react'
import { dbClient } from '@/app/lib/db/client'
import {
  formatGuildDisplayLabel,
  normalizeGuildIdentifier
} from '@/app/lib/format/guild'
import { GUILD_DISPLAY_COMPACT } from '@/app/lib/guild-config-selects'

type GuildDisplayRow = {
  guild_code: string | null
  guild_tag: string | null
  display_name: string | null
}

const guildLabelCache = new Map<string, string>()

export function useGuildDisplayLabel(
  guildCode: string | null | undefined
): string {
  const normalizedGuildCode = useMemo(
    () => normalizeGuildIdentifier(guildCode),
    [guildCode]
  )
  const fallbackLabel = useMemo(
    () => formatGuildDisplayLabel(null, normalizedGuildCode || guildCode),
    [guildCode, normalizedGuildCode]
  )
  const [resolvedLabel, setResolvedLabel] = useState<{
    guildCode: string
    label: string
  } | null>(null)

  useEffect(() => {
    if (!normalizedGuildCode) return

    const cached = guildLabelCache.get(normalizedGuildCode)
    if (cached) return

    let isMounted = true

    const loadLabel = async () => {
      try {
        const { data } = await dbClient()
          .from('guild_config')
          .select(GUILD_DISPLAY_COMPACT)
          .eq('guild_code', normalizedGuildCode)
          .maybeSingle()
        if (!isMounted) return
        const nextLabel = formatGuildDisplayLabel(
          data as GuildDisplayRow | null,
          normalizedGuildCode
        )
        guildLabelCache.set(normalizedGuildCode, nextLabel)
        setResolvedLabel({ guildCode: normalizedGuildCode, label: nextLabel })
      } catch {
        if (!isMounted) return
        guildLabelCache.set(normalizedGuildCode, fallbackLabel)
        setResolvedLabel({
          guildCode: normalizedGuildCode,
          label: fallbackLabel
        })
      }
    }
    void loadLabel()

    return () => {
      isMounted = false
    }
  }, [fallbackLabel, normalizedGuildCode])

  if (!normalizedGuildCode) return fallbackLabel
  return (
    guildLabelCache.get(normalizedGuildCode) ??
    (resolvedLabel?.guildCode === normalizedGuildCode
      ? resolvedLabel.label
      : fallbackLabel)
  )
}
