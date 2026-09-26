import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors-headers.ts'
import { jsonResponse } from '../_shared/response-helpers.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { requireServiceRole } from '../_shared/auth-guard.ts'
import { normalizeGuildCode } from '../_shared/guild-code.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  const authError = requireServiceRole(req)
  if (authError) return authError

  try {
    const body = await req.json().catch(() => ({}))
    const clusterCode =
      typeof body.cluster_code === 'string'
        ? body.cluster_code.trim().toUpperCase()
        : null
    const guildCode = normalizeGuildCode(body.guild_code) || null
    const enable = body.enable !== false

    if (!clusterCode && !guildCode) {
      return jsonResponse(
        {
          success: false,
          error: 'cluster_code or guild_code required'
        },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    let query = supabase.from('guild_config').update({
      use_modular_sync: enable,
      updated_at: new Date().toISOString()
    })

    if (clusterCode) {
      query = query.eq('cluster_code', clusterCode).eq('enabled', true)
    } else if (guildCode) {
      query = query.eq('guild_code', guildCode)
    }

    const { data, error, count } = await query.select(
      'guild_code, display_name, use_modular_sync'
    )

    if (error) {
      return jsonResponse(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      )
    }

    return jsonResponse(
      {
        success: true,
        action: enable ? 'enabled' : 'disabled',
        target: clusterCode ? `cluster ${clusterCode}` : `guild ${guildCode}`,
        updatedGuilds: data?.length || 0,
        guilds: data
      },
      { status: 200 }
    )
  } catch (error) {
    return jsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
})
