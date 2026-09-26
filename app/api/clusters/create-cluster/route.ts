import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.clusters.create-cluster')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'

export const POST = withErrorHandler(async (request: NextRequest) => {
  // Onboarding users have no profile yet at this step.
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true,
    skipRateLimit: false
  })
  if (securityResult) return securityResult

  const supabaseAuth = await db()
  const user = await requireSessionUser(supabaseAuth, () =>
    Errors.authenticationRequired('Authentication required to create a cluster')
  )
  const userId = user.id

  try {
    const body = await request.json()
    const {
      cluster_code,
      display_name,
      description,
      primary_language,
      time_zone
    } = body

    logger.debug(
      {
        cluster_code,
        display_name,
        primary_language,
        time_zone,
        userId
      },
      '[create-cluster] Request received:'
    )

    if (!cluster_code || !display_name) {
      throw Errors.fromResponse(400, { error: 'Missing required fields' })
    }

    const supabase = serviceDb()

    const { data: existingCluster } = await supabase
      .from('clusters')
      .select('cluster_code')
      .eq('cluster_code', cluster_code.toUpperCase())
      .single()

    if (existingCluster) {
      throw Errors.fromResponse(409, { error: 'Cluster code already exists' })
    }

    const { data: newCluster, error: clusterError } = await supabase
      .from('clusters')
      .insert({
        cluster_code: cluster_code.toUpperCase(),
        display_name,
        description: description || null,
        primary_language: primary_language || 'en',
        time_zone: time_zone || 'UTC',
        is_active: true,
        is_public: false,
        max_guilds: 10,
        onboarding_completed: false,
        onboarding_started_at: new Date().toISOString(),
        created_by: userId
      })
      .select()
      .single()

    if (clusterError) {
      logger.error({ err: clusterError }, '[create-cluster] Database error:')
      throw Errors.fromResponse(500, {
        error: 'Failed to create cluster',
        details: clusterError.message
      })
    }

    logger.debug(
      { data: newCluster.cluster_code },
      '[create-cluster] Successfully created cluster:'
    )

    return NextResponse.json(
      {
        success: true,
        cluster: newCluster
      },
      { status: 201 }
    )
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, '[create-cluster] Unexpected error:')
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: errorMessage
    })
  }
})
