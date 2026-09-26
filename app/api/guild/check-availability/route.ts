import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.check-availability')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url)
    const guildCode = searchParams.get('guild_code')

    if (!guildCode) {
      throw Errors.fromResponse(400, { error: 'Guild code is required' })
    }

    const normalizedGuildCode = guildCode.toUpperCase().trim()

    if (!/^[A-Z]{2,7}$/.test(normalizedGuildCode)) {
      throw Errors.fromResponse(400, { error: 'Invalid guild code format' })
    }

    const supabase = await db()

    const { data, error } = await supabase
      .rpc('check_guild_registration_status', {
        guild_code_param: normalizedGuildCode
      })
      .single()

    if (error) {
      logger.error({ err: error }, 'Failed to check guild registration status:')
      throw Errors.fromResponse(500, { error: 'Database error' })
    }

    const registrationData = data as unknown as {
      exists: boolean
      can_resume: boolean
      registration_status?: string
      registration_age_hours?: number
    }

    if (!registrationData.exists) {
      return NextResponse.json({
        available: true,
        can_resume: false,
        guild_code: normalizedGuildCode
      })
    }

    const canResume = registrationData.can_resume
    const available = !registrationData.exists || canResume

    return NextResponse.json({
      available,
      can_resume: canResume,
      registration_status: registrationData.registration_status,
      registration_age_hours: registrationData.registration_age_hours,
      guild_code: normalizedGuildCode
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Guild availability check error:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
