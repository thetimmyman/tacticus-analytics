import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'

interface UserRow {
  user_id: string | null
  display_name: string | null
  guild_code: string | null
  role: string | null
  last_active_at: string | null
}

interface GuildConfigRow {
  guild_code: string
  display_name: string | null
  cluster_code: string | null
}

const ADMIN_UNAUTHORIZED_METADATA = { error: 'Unauthorized' }
const ADMIN_DENIED_METADATA = { error: 'Forbidden' }

export const GET = withAdminGuards(
  {
    guard: 'app-admin-session',
    unauthorizedMessage: 'Unauthorized',
    unauthorizedMetadata: ADMIN_UNAUTHORIZED_METADATA,
    deniedMessage: 'Forbidden',
    deniedMetadata: ADMIN_DENIED_METADATA
  },
  async (request: NextRequest) => {
    // RLS-bound; withAdminGuards already established the caller is an app admin.
    const supabase = await db()
    const privilegedSupabase = serviceDb()

    const searchParams = request.nextUrl.searchParams
    const guildCode = searchParams.get('guild_code')
    const clusterCode = searchParams.get('cluster_code')
    const role = searchParams.get('role')
    const daysBack = parseInt(searchParams.get('days_back') || '30')

    try {
      const { data: guildConfigs } = await privilegedSupabase
        .from('guild_config')
        .select('guild_code, display_name, cluster_code')

      const guildConfigMap = new Map<string, GuildConfigRow>()
      ;(guildConfigs || []).forEach((gc) => {
        guildConfigMap.set(gc.guild_code, gc as GuildConfigRow)
      })

      let query = privilegedSupabase
        .from('player_mapping')
        .select(
          `
        user_id,
        display_name,
        guild_code,
        role,
        last_active_at
      `
        )
        .eq('is_current', true)
        .not('user_id', 'is', null)

      if (guildCode) {
        query = query.eq('guild_code', guildCode)
      }

      if (clusterCode) {
        const clusterGuilds = (guildConfigs || [])
          .filter((gc) => gc.cluster_code === clusterCode)
          .map((gc) => gc.guild_code)
        if (clusterGuilds.length > 0) {
          query = query.in('guild_code', clusterGuilds)
        }
      }

      if (role) {
        query = query.eq('role', role as 'leader' | 'officer' | 'member')
      }

      const { data, error } = await query

      if (error) {
        console.error('Activity analytics query error:', error)
        throw Errors.fromResponse(500, { error: error.message })
      }

      const users = (data || []) as unknown as UserRow[]

      const now = new Date()
      const cutoffDate = new Date(
        now.getTime() - daysBack * 24 * 60 * 60 * 1000
      )

      const activeUsers = users.filter((u) => {
        if (!u.last_active_at) return false
        return new Date(u.last_active_at) >= cutoffDate
      })

      const totalClaimedUsers = users.length
      const activeCount = activeUsers.length
      const inactiveCount = totalClaimedUsers - activeCount

      const activityByDay: Record<string, number> = {}
      const activityByGuild: Record<
        string,
        { active: number; total: number; name: string }
      > = {}
      const activityByRole: Record<string, { active: number; total: number }> =
        {}
      const activityByCluster: Record<
        string,
        { active: number; total: number }
      > = {}

      for (let i = 0; i < daysBack; i++) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
        const key = date.toISOString().split('T')[0]
        if (!key) {
          continue
        }
        activityByDay[key] = 0
      }

      users.forEach((u) => {
        const guildConfig = u.guild_code
          ? guildConfigMap.get(u.guild_code)
          : null
        const gCode = u.guild_code || 'Unknown'
        const gName = guildConfig?.display_name || gCode
        const cCode = guildConfig?.cluster_code || 'No Cluster'
        const uRole = u.role || 'member'

        if (!activityByGuild[gCode]) {
          activityByGuild[gCode] = { active: 0, total: 0, name: gName }
        }
        activityByGuild[gCode].total++

        if (!activityByRole[uRole]) {
          activityByRole[uRole] = { active: 0, total: 0 }
        }
        activityByRole[uRole].total++

        if (!activityByCluster[cCode]) {
          activityByCluster[cCode] = { active: 0, total: 0 }
        }
        activityByCluster[cCode].total++

        if (u.last_active_at) {
          const activeDate = new Date(u.last_active_at)
          if (activeDate >= cutoffDate) {
            activityByGuild[gCode].active++
            activityByRole[uRole].active++
            activityByCluster[cCode].active++

            const dayKey = activeDate.toISOString().split('T')[0]
            if (!dayKey) {
              return
            }
            if (activityByDay[dayKey] !== undefined) {
              activityByDay[dayKey]++
            }
          }
        }
      })

      const dailyActivity = Object.entries(activityByDay)
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date))

      const guildActivity = Object.entries(activityByGuild)
        .map(([code, data]) => ({
          guild_code: code,
          guild_name: data.name,
          active: data.active,
          total: data.total,
          rate:
            data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
        }))
        .sort((a, b) => b.active - a.active)

      const roleActivity = Object.entries(activityByRole)
        .map(([role, data]) => ({
          role,
          active: data.active,
          total: data.total,
          rate:
            data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
        }))
        .sort((a, b) => b.active - a.active)

      const clusterActivity = Object.entries(activityByCluster)
        .map(([cluster, data]) => ({
          cluster,
          active: data.active,
          total: data.total,
          rate:
            data.total > 0 ? Math.round((data.active / data.total) * 100) : 0
        }))
        .sort((a, b) => b.active - a.active)

      const { data: guilds } = await supabase
        .from('guild_config')
        .select('guild_code, display_name, cluster_code')
        .order('display_name')

      const { data: clusters } = await supabase
        .from('guild_config')
        .select('cluster_code')
        .not('cluster_code', 'is', null)

      const uniqueClusters = [
        ...new Set(clusters?.map((c) => c.cluster_code).filter(Boolean))
      ]

      return NextResponse.json({
        summary: {
          totalClaimedUsers,
          activeCount,
          inactiveCount,
          activityRate:
            totalClaimedUsers > 0
              ? Math.round((activeCount / totalClaimedUsers) * 100)
              : 0,
          daysBack
        },
        dailyActivity,
        guildActivity,
        roleActivity,
        clusterActivity,
        pageViews: [],
        filters: {
          guilds: guilds || [],
          clusters: uniqueClusters,
          roles: ['leader', 'officer', 'member']
        }
      })
    } catch (err) {
      rethrowIfAppError(err)
      console.error('Activity analytics error:', err)
      throw Errors.fromResponse(500, { error: 'Internal server error' })
    }
  }
)
