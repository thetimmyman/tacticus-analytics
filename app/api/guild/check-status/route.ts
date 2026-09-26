import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { requireAuthForApi } from '@/app/lib/auth'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.check-status')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'

// serviceDb() sees guilds outside the caller's cluster, so the auth gate is the boundary against
// enumeration.
export const GET = withErrorHandler(async (request: NextRequest) => {
  // Outside the try: its catch would turn the gate's 401/403 into a 500.
  await requireAuthForApi()

  try {
    const { searchParams } = new URL(request.url)
    const guild_code = searchParams.get('guild_code')

    if (!guild_code) {
      throw Errors.fromResponse(400, { error: 'Missing guild_code' })
    }

    const supabase = serviceDb()
    const upperGuildCode = guild_code.toUpperCase()

    const configData = await GuildConfigService.getFull(
      supabase,
      upperGuildCode
    )

    if (!configData) {
      return NextResponse.json({
        exists: false,
        hasData: false,
        dataCount: 0
      })
    }

    const { count: dataCount, error: countError } = await supabase
      .from('EOT_GR_data')
      .select('*', { count: 'exact', head: true })
      .eq('Guild', upperGuildCode)

    if (countError) {
      logger.error({ err: countError }, 'Failed to count guild data')
    }

    return NextResponse.json({
      exists: true,
      hasData: (dataCount || 0) > 0,
      dataCount: dataCount || 0,
      config: {
        guild_code: configData.guild_code,
        display_name: configData.display_name,
        enabled: configData.enabled,
        cluster_code: configData.cluster_code
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Check status error:')
    throw Errors.fromResponse(500, {
      exists: false,
      hasData: false,
      dataCount: 0,
      error: 'Failed to check status'
    })
  }
})
