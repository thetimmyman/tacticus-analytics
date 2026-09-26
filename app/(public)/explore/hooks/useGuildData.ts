import { useState, useEffect, useCallback, useRef } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('explore.hooks.useGuildData')
import { filterGuildsByPrivacy } from '@tacticus/app-core/explore-privacy'
import type { GuildSnapshot } from '@tacticus/app-core/database-extensions'
import { transformGuildSnapshot } from '../utils'
import type { GuildData } from '../types'

export function useGuildData() {
  const [guilds, setGuilds] = useState<GuildData[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const supabaseRef = useRef<ReturnType<typeof dbClient> | null>(null)
  const isMountedRef = useRef(true)

  if (!supabaseRef.current) {
    supabaseRef.current = dbClient()
  }

  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const fetchGuildData = useCallback(async () => {
    const supabaseClient = supabaseRef.current
    if (!supabaseClient) return

    try {
      setLoading(true)
      logger.debug('Fetching guild data from public_guild_snapshots_explore...')

      // Privacy-enforcing view, never the base table: redaction happens server-side.
      const [snapshotResult, tagResult] = await Promise.all([
        supabaseClient
          .from('public_guild_snapshots_explore')
          .select('*')
          .order('rank', { ascending: true, nullsFirst: false })
          .limit(500),
        supabaseClient.from('guild_config').select('guild_code, guild_tag')
      ])
      const { data: snapshotData, error: snapshotError } = snapshotResult
      const tagByCode = new Map<string, string | null>(
        (tagResult.data ?? []).map(
          (row: { guild_code: string; guild_tag: string | null }) => [
            row.guild_code,
            row.guild_tag
          ]
        )
      )

      const scrapedData: Array<Record<string, unknown>> = []

      const isTestGuild = (snapshot: GuildSnapshot) => {
        const name = snapshot.guild_name?.toLowerCase() ?? ''
        return snapshot.guild_code === 'TEST' || name.includes('test')
      }

      const normalizeGuildSnapshot = (
        snapshot: GuildSnapshot | Record<string, unknown>
      ): GuildSnapshot => {
        const rawMode = (snapshot as { explore_privacy_mode?: unknown })
          .explore_privacy_mode
        const explorePrivacyMode =
          typeof rawMode === 'string'
            ? rawMode
            : Array.isArray(rawMode) &&
                rawMode.every(
                  (entry): entry is string => typeof entry === 'string'
                )
              ? rawMode
              : null

        return {
          ...snapshot,
          explore_privacy_mode: explorePrivacyMode
        } as GuildSnapshot
      }

      if (
        (!snapshotError && snapshotData && snapshotData.length > 0) ||
        scrapedData.length > 0
      ) {
        const publicGuilds = (snapshotData || [])
          .map(normalizeGuildSnapshot)
          .filter((snapshot) => !isTestGuild(snapshot))
          .map((snapshot) => ({
            ...transformGuildSnapshot(snapshot),
            guild_tag: tagByCode.get(snapshot.guild_code) ?? null
          }))

        const scrapedGuilds = scrapedData
          .map(normalizeGuildSnapshot)
          .filter((snapshot) => !isTestGuild(snapshot))
          .map((snapshot) => ({
            ...transformGuildSnapshot(snapshot),
            guild_tag: tagByCode.get(snapshot.guild_code) ?? null
          }))

        // Public data overwrites scraped data for the same guild_code.
        const guildMap = new Map<string, GuildData>()

        scrapedGuilds.forEach((g) => guildMap.set(g.guild_code, g))

        publicGuilds.forEach((g) => guildMap.set(g.guild_code, g))

        const mergedData = Array.from(guildMap.values())

        const filteredData = filterGuildsByPrivacy(mergedData)
        if (!isMountedRef.current) return
        setGuilds(filteredData as GuildData[])
        setLastRefreshed(new Date())
        logger.debug(
          `Loaded ${mergedData.length} guilds (${publicGuilds.length} public, ${scrapedGuilds.length} scraped)`
        )
        return
      }

      // Cron owns the matview refresh, so zero snapshots means a cold start or broken cron.
      if (snapshotError || !snapshotData || snapshotData.length === 0) {
        logger.error(
          { err: snapshotError ?? null },
          'No public guild snapshots available (cron owns refresh)'
        )
      }

      logger.error('Could not load guild data')
      if (!isMountedRef.current) return
      setGuilds([])
    } catch (error) {
      logger.error({ err: error }, 'Error in fetchGuildData:')
      if (isMountedRef.current) {
        setGuilds([])
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchGuildData()
  }, [fetchGuildData])

  // Polling, not Realtime: the WebSocket handshake cookies can exceed Kong's header limit.
  useEffect(() => {
    const intervalId = setInterval(
      () => {
        fetchGuildData()
      },
      5 * 60 * 1000
    )

    return () => {
      clearInterval(intervalId)
    }
  }, [fetchGuildData])

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetchGuildData()
    } catch (error) {
      logger.error({ err: error }, 'Error during manual refresh:')
    } finally {
      setRefreshing(false)
    }
  }, [fetchGuildData])

  return { guilds, loading, refreshing, lastRefreshed, handleManualRefresh }
}
