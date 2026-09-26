import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.admin.users.search')
import { Errors } from '@/app/lib/errors/AppError'
import { extractDiscordIdentityClaims } from '@/app/lib/discord/identity-claims'
import { buildDiscordAvatarUrl } from '@/app/lib/discord/avatar'

export const GET = withAdminGuards(
  { guard: 'app-admin' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams
    const query = searchParams.get('q')?.trim() || ''
    const guildCode = searchParams.get('guild_code')?.trim()
    const clusterCode = searchParams.get('cluster_code')?.trim()
    const role = searchParams.get('role')?.trim()
    const hasAccount = searchParams.get('has_account')
    const isAdmin = searchParams.get('is_admin')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')

    const supabase = serviceDb()

    let queryBuilder = supabase
      .from('player_mapping')
      .select(
        `
        id,
        user_id,
        player_id,
        username,
        display_name,
        guild_code,
        cluster_code,
        role,
        is_app_admin,
        is_current,
        discord_user_id,
        discord_username,
        avatar_url,
        created_at
      `,
        { count: 'exact' }
      )
      .eq('is_current', true)

    if (query && query.length >= 2) {
      // Interpolated into `.or()`: a comma, paren or period could inject filters, so allow-list chars.
      const safeQuery = query
        .toLowerCase()
        .replace(/[^a-z0-9_\- @.]/g, '')
        .slice(0, 64)
      if (safeQuery.length >= 2) {
        const searchPattern = `%${safeQuery}%`
        queryBuilder = queryBuilder.or(
          `username.ilike.${searchPattern},display_name.ilike.${searchPattern},player_id.ilike.${searchPattern},guild_code.ilike.${searchPattern},discord_username.ilike.${searchPattern}`
        )
      }
    }

    if (guildCode) {
      queryBuilder = queryBuilder.eq('guild_code', guildCode)
    }

    if (clusterCode) {
      queryBuilder = queryBuilder.eq('cluster_code', clusterCode)
    }

    if (role) {
      queryBuilder = queryBuilder.eq(
        'role',
        role as
          | 'leader'
          | 'officer'
          | 'member'
          | 'Leader'
          | 'Member'
          | 'Officer'
          | 'demo'
      )
    }

    if (hasAccount === 'true') {
      queryBuilder = queryBuilder.not('user_id', 'is', null)
    } else if (hasAccount === 'false') {
      queryBuilder = queryBuilder.is('user_id', null)
    }

    if (isAdmin === 'true') {
      queryBuilder = queryBuilder.eq('is_app_admin', true)
    }

    const {
      data: users,
      error,
      count
    } = await queryBuilder
      .order('display_name', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      logger.error({ error }, 'Admin user search error')
      throw Errors.internal(error.message)
    }

    if (!users || users.length === 0) {
      if (query && query.length >= 2) {
        const { data: authUsers } = await supabase
          .from('auth_user_emails')
          .select('user_id, email')
          .ilike('email', `%${query}%`)
          .limit(limit)

        if (authUsers && authUsers.length > 0) {
          const resolvedAuthUsers = authUsers.filter(
            (u): u is { user_id: string; email: string } =>
              !!u.user_id && !!u.email
          )
          const results = await Promise.all(
            resolvedAuthUsers.map(async (u) => {
              const { data, error: identityError } =
                await supabase.auth.admin.getUserById(u.user_id)
              if (identityError) {
                logger.error(
                  { error: identityError, userId: u.user_id },
                  'Admin auth-only identity lookup failed'
                )
                throw Errors.internal(identityError.message)
              }
              const discordClaims = data.user
                ? extractDiscordIdentityClaims(data.user)
                : null

              return {
                id: null,
                user_id: u.user_id,
                email: u.email,
                username: null,
                display_name: u.email.split('@')[0],
                player_id: null,
                guild_code: null,
                cluster_code: null,
                role: null,
                is_app_admin: false,
                is_alpha_tester: false,
                is_beta_tester: false,
                discord_user_id: discordClaims?.discordUserId ?? null,
                discord_username: discordClaims?.discordUsername ?? null,
                avatar_url: null,
                source: 'auth_only'
              }
            })
          )
          return NextResponse.json({
            users: results,
            total: results.length,
            hasMore: false
          })
        }
      }

      return NextResponse.json({ users: [], total: 0, hasMore: false })
    }

    const userIds = users.filter((u) => u.user_id).map((u) => u.user_id)
    let emailMap = new Map<string, string>()

    if (userIds.length > 0) {
      const { data: emails } = await supabase
        .from('auth_user_emails')
        .select('user_id, email')
        .in('user_id', userIds)

      emailMap = new Map(
        (emails || [])
          .filter(
            (e): e is { user_id: string; email: string } =>
              !!e.user_id && !!e.email
          )
          .map((e) => [e.user_id, e.email])
      )
    }

    const [alphaRes, betaRes] = await Promise.all([
      supabase
        .from('feature_access_grants')
        .select('user_id')
        .eq('access_level', 'alpha_tester'),
      supabase
        .from('feature_access_grants')
        .select('user_id')
        .eq('access_level', 'beta_tester')
    ])

    const alphaUserIds = new Set((alphaRes.data || []).map((g) => g.user_id))
    const betaUserIds = new Set((betaRes.data || []).map((g) => g.user_id))

    const results = users.map((u) => ({
      ...u,
      // avatar_url holds only the Discord avatar hash.
      avatar_url: buildDiscordAvatarUrl(u.discord_user_id, u.avatar_url),
      email: u.user_id ? emailMap.get(u.user_id) || null : null,
      is_alpha_tester: u.user_id ? alphaUserIds.has(u.user_id) : false,
      is_beta_tester: u.user_id ? betaUserIds.has(u.user_id) : false,
      source: 'player_mapping'
    }))

    return NextResponse.json({
      users: results,
      total: count || results.length,
      hasMore: offset + limit < (count || 0)
    })
  }
)
