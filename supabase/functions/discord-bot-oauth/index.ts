import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @deno-types="npm:@supabase/supabase-js@2.39.0"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireAuth } from '../_shared/auth-guard.ts'

interface OAuthExchangeRequest {
  guild_id: string
  user_id: string
  permissions?: string
  state?: string // This contains our invite code
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    })
  }

  const authError = requireAuth(req)
  if (authError) return authError

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body: OAuthExchangeRequest = await req.json()
    const {
      guild_id: discordGuildId,
      user_id: discordUserId,
      state: inviteCode
    } = body

    if (!discordGuildId || !inviteCode) {
      console.log('Missing required fields:', { discordGuildId, inviteCode })
      return new Response(
        JSON.stringify({
          error: 'Missing guild_id or invite code'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: invite, error: inviteError } = await supabase
      .from('discord_invite_codes')
      .select('*')
      .eq('invite_code', inviteCode)
      .eq('is_active', true)
      .single()

    if (inviteError || !invite) {
      console.log('Invalid invite code:', inviteCode, inviteError)
      return new Response(
        JSON.stringify({
          error: 'Invalid or expired invite code'
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    if (invite.current_uses >= invite.max_uses) {
      return new Response(
        JSON.stringify({
          error: 'Invite code has reached maximum uses'
        }),
        {
          status: 410,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    if (new Date() > new Date(invite.expires_at)) {
      return new Response(
        JSON.stringify({
          error: 'Invite code has expired'
        }),
        {
          status: 410,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const { data: guildConfig, error: guildError } = await supabase
      .from('guild_config')
      .select('guild_code, cluster_code')
      .eq('guild_code', invite.guild_code)
      .maybeSingle()

    if (guildError || !guildConfig) {
      return new Response(
        JSON.stringify({
          error: 'Guild configuration not found for invite'
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const { data: existingMapping } = await supabase
      .from('discord_server_guilds')
      .select('*')
      .eq('discord_guild_id', discordGuildId)
      .eq('game_guild_code', invite.guild_code)
      .eq('is_active', true)
      .maybeSingle()

    if (existingMapping) {
      await supabase
        .from('discord_invite_codes')
        .update({
          current_uses: invite.current_uses + 1,
          is_active: invite.current_uses + 1 >= invite.max_uses ? false : true
        })
        .eq('id', invite.id)

      return new Response(
        JSON.stringify({
          success: true,
          message: `Discord server already linked to guild ${invite.guild_code}`,
          guild_code: invite.guild_code
        }),
        {
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const { error: mappingError } = await supabase
      .from('discord_server_guilds')
      .upsert(
        {
          discord_guild_id: discordGuildId,
          game_guild_code: invite.guild_code,
          cluster_code: guildConfig.cluster_code,
          invited_with_code: inviteCode,
          linked_by_user_id: discordUserId,
          is_active: true
        },
        {
          onConflict: 'discord_guild_id,game_guild_code'
        }
      )

    if (mappingError) {
      console.error('Failed to create server mapping:', mappingError)
      return new Response(
        JSON.stringify({
          error: 'Failed to link Discord server'
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const { error: updateError } = await supabase
      .from('discord_invite_codes')
      .update({
        current_uses: invite.current_uses + 1,
        is_active: invite.current_uses + 1 >= invite.max_uses ? false : true
      })
      .eq('id', invite.id)

    if (updateError) {
      console.error('Failed to update invite usage:', updateError)
    }

    console.log(
      `Successfully linked Discord server ${discordGuildId} to guild ${invite.guild_code}`
    )

    return new Response(
      JSON.stringify({
        success: true,
        message: `Discord server successfully linked to guild ${invite.guild_code}! You can now use bot commands like /tokens in this server.`,
        guild_code: invite.guild_code
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Bot OAuth webhook error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal server error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
