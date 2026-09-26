import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { logger } from '../_shared/logger.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { requireServiceRole } from '../_shared/auth-guard.ts'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  const authError = requireServiceRole(req)
  if (authError) return authError

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('refresh_public_guild_snapshots')
    if (error) {
      logger.error('Error refreshing snapshots:', error)
      return jsonResponse(
        {
          success: false,
          error: 'Internal server error'
        },
        { status: 500 }
      )
    }
    const { data: snapshots, error: countError } = await supabase
      .from('public_guild_snapshots')
      .select('guild_code', { count: 'exact', head: true })
    const count = snapshots?.length || 0
    const { data: stats } = await supabase
      .from('public_guild_snapshots')
      .select('season, last_updated')
      .limit(1)
      .single()
    return jsonResponse(
      {
        success: true,
        message: `Refreshed ${count} guild snapshots`,
        season: stats?.season,
        lastUpdated: stats?.last_updated,
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error('Unexpected error:', error)
    return jsonResponse(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    )
  }
})
