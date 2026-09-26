import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @deno-types="npm:@supabase/supabase-js@2.39.0"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  jsonResponse,
  corsOptionsResponse
} from '../_shared/response-helpers.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return corsOptionsResponse()
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: pendingExports, error: fetchError } = await supabase
      .from('log_export_requests')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .limit(5) // Process max 5 at a time

    if (fetchError) {
      throw fetchError
    }

    if (!pendingExports || pendingExports.length === 0) {
      return jsonResponse({ message: 'No pending exports to process' })
    }

    const processed = []

    for (const exportRequest of pendingExports) {
      try {
        await supabase
          .from('log_export_requests')
          .update({ status: 'processing' })
          .eq('id', exportRequest.id)

        const { data: userData, error: userError } = await supabase
          .from('player_with_cluster')
          .select('user_id')
          .eq('guild_code', exportRequest.guild_code)
          .eq('user_id', exportRequest.requested_by)
          .single()

        if (userError) {
          throw new Error('Failed to get user data')
        }

        const { data: authData } = await supabase.auth.admin.getUserById(
          exportRequest.requested_by
        )
        const userEmail = authData?.user?.email

        if (!userEmail) {
          throw new Error('No email address found for user')
        }

        const exportData = await gatherExportData(
          supabase,
          exportRequest.guild_code,
          exportRequest.export_options
        )

        // Friendly label so the email does not leak a raw guild_code UUID.
        const { data: guildInfo } = await supabase
          .from('guild_config')
          .select('display_name, guild_tag')
          .eq('guild_code', exportRequest.guild_code)
          .maybeSingle()
        const guildLabel =
          (guildInfo?.display_name?.trim() as string | undefined) ||
          (guildInfo?.guild_tag?.trim() as string | undefined) ||
          'Guild'

        const emailHtml = formatExportEmail(
          guildLabel,
          exportData,
          exportRequest.export_options
        )

        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendApiKey}`
          },
          body: JSON.stringify({
            from: 'Tacticus Analytics <logs@tacticusanalytics.com>',
            to: userEmail,
            subject: `Guild Data Export - ${guildLabel}`,
            html: emailHtml,
            attachments: [
              {
                filename: `${guildLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}_export_${Date.now()}.json`,
                content: Buffer.from(
                  JSON.stringify(exportData, null, 2)
                ).toString('base64')
              }
            ]
          })
        })

        if (!emailResponse.ok) {
          throw new Error('Failed to send email')
        }

        await supabase
          .from('log_export_requests')
          .update({
            status: 'completed',
            email_sent_at: new Date().toISOString()
          })
          .eq('id', exportRequest.id)

        processed.push(exportRequest.id)
      } catch (error) {
        console.error(`Failed to process export ${exportRequest.id}:`, error)

        await supabase
          .from('log_export_requests')
          .update({
            status: 'failed',
            error_message:
              error instanceof Error ? error.message : String(error)
          })
          .eq('id', exportRequest.id)
      }
    }

    return jsonResponse({
      message: `Processed ${processed.length} exports`,
      processed
    })
  } catch (error) {
    console.error('[process-log-exports] Unhandled error:', error)
    return jsonResponse({ error: 'Internal server error' }, { status: 500 })
  }
})

async function gatherExportData(
  supabase: any,
  guildCode: string,
  options: any
) {
  const exportData: any = {
    guild: guildCode,
    exportDate: new Date().toISOString(),
    dateRange: {
      from: options.dateFrom,
      to: options.dateTo
    },
    data: {}
  }

  // Edge-side counterpart of the export-logs route's data gathering.

  if (options.memberActivity) {
    const { data: memberActivity } = await supabase
      .from('player_mapping')
      .select('player_id, created_at, updated_at')
      .eq('guild_code', guildCode)
      .eq('is_current', true)
      .gte('created_at', options.dateFrom)
      .lte('created_at', options.dateTo)

    exportData.data.memberActivity = {
      totalMembers: memberActivity?.length || 0,
      members: memberActivity || []
    }
  }

  if (options.battleData) {
    const { data: battles } = await supabase
      .from('EOT_GR_data')
      .select('displayName, Season, Name, damageDealt, timestamp')
      .eq('Guild', guildCode)
      .gte('timestamp', options.dateFrom)
      .lte('timestamp', options.dateTo)
      .limit(500)

    exportData.data.battleData = {
      totalBattles: battles?.length || 0,
      battles: battles || []
    }
  }

  return exportData
}

function formatExportEmail(guildLabel: string, exportData: any, options: any) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background: #1a1a1a; color: #e0e0e0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2a2a2a; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .section { background: #2a2a2a; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .title { color: #4fc3f7; font-size: 24px; margin-bottom: 10px; }
        .subtitle { color: #90a4ae; font-size: 14px; }
        .data-summary { background: #333; padding: 10px; border-radius: 4px; margin: 10px 0; }
        .footer { text-align: center; color: #607d8b; font-size: 12px; margin-top: 30px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="title">Guild Data Export Complete</div>
          <div class="subtitle">Guild: ${guildLabel}</div>
        </div>
        
        <div class="section">
          <h3>Export Summary</h3>
          <div class="data-summary">
            <p>Export Date: ${new Date().toLocaleString()}</p>
            <p>Date Range: ${new Date(options.dateFrom).toLocaleDateString()} - ${new Date(options.dateTo).toLocaleDateString()}</p>
            <p>Requested By: ${options.requestedByName} (${options.requestedByRole})</p>
          </div>
        </div>
        
        <div class="section">
          <h3>Included Data</h3>
          <ul>
            ${options.memberActivity ? '<li>✓ Member Activity Logs</li>' : ''}
            ${options.battleData ? '<li>✓ Battle Data & Statistics</li>' : ''}
            ${options.tokenUsage ? '<li>✓ Token Usage History</li>' : ''}
            ${options.syncOperations ? '<li>✓ Sync Operation Logs</li>' : ''}
            ${options.settingsChanges ? '<li>✓ Guild Settings</li>' : ''}
          </ul>
        </div>
        
        <div class="section">
          <p>Your complete data export is attached to this email as a JSON file.</p>
          <p>You can open this file with any text editor or import it into a spreadsheet application.</p>
        </div>
        
        <div class="footer">
          <p>This export was automatically generated by Tacticus Analytics</p>
          <p>For the Emperor and the Omnissiah!</p>
        </div>
      </div>
    </body>
    </html>
  `
}
