import { Resend } from 'resend'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'lib.services.api-key-incident-notifications'
)
import { APP_ORIGINS, EMAIL_ADDRESSES } from '@tacticus/app-core/app-config'
import { serviceDb } from '@/app/lib/db'
import type { Database } from '@tacticus/app-core/database.generated'
import {
  SERVICE_TIMEOUTS,
  TimeoutError,
  withTimeout
} from '@/app/lib/utils/async-timeout'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

type GuildConfigRow = Pick<
  Database['public']['Tables']['guild_config']['Row'],
  | 'guild_code'
  | 'enabled'
  | 'display_name'
  | 'api_key_is_valid'
  | 'consecutive_sync_failures'
  | 'last_successful_sync'
  | 'last_sync_attempt'
  | 'user_id'
>

type IncidentType = 'invalid_api_key' | 'sync_failures'

type IncidentStateRow = {
  guild_code: string
  incident_type: IncidentType | null
  incident_started_at: string | null
  incident_last_seen_at: string | null
  notified_at: string | null
  notified_recipients: string[] | null
  notified_recipient_count: number | null
  last_notification_error: string | null
  resolved_at: string | null
}

type IncidentStateUpsert = {
  guild_code: string
  incident_type: IncidentType | null
  incident_started_at: string | null
  incident_last_seen_at: string | null
  notified_at: string | null
  notified_recipients: string[]
  notified_recipient_count: number
  last_notification_error: string | null
  resolved_at: string | null
}

type IncidentStateTableClient = {
  upsert: (
    row: IncidentStateUpsert,
    options: { onConflict: string }
  ) => Promise<{ error: { message: string } | null }>
  select: (columns: string) => {
    in: (
      column: string,
      values: string[]
    ) => Promise<{
      data: IncidentStateRow[] | null
      error: { message: string } | null
    }>
  }
}

type Recipient = {
  email: string
  userId: string | null
  source: 'leader_or_officer' | 'guild_owner_fallback'
}

export type ApiKeyIncident = {
  type: IncidentType
  summary: string
  failureCount: number
}

export type ApiKeyIncidentNotificationResult = {
  lookbackDays: number
  noRecipientEscalationDays: number
  scannedGuilds: number
  incidentGuilds: number
  resolvedGuilds: number
  guildsNotified: number
  emailsSent: number
  skippedNoRecipients: number
  skippedAlreadyNotified: number
  staleInvalidKeyIncidentsWithoutRecipients: number
  oldestStaleInvalidKeyIncidentDays: number | null
  errors: string[]
}

const INCIDENT_STATE_TABLE = 'guild_api_incident_notification_state'
const LEADERSHIP_ROLES: Database['public']['Enums']['app_role'][] = [
  'leader',
  'officer',
  'Leader',
  'Officer'
]

const LOOKBACK_DAYS = Number.parseInt(
  process.env.API_KEY_ISSUE_NOTIFICATION_LOOKBACK_DAYS ?? '14',
  10
)
const MAX_GUILDS_TO_SCAN = Number.parseInt(
  process.env.API_KEY_ISSUE_NOTIFICATION_MAX_GUILDS ?? '150',
  10
)
const NO_RECIPIENT_ESCALATION_DAYS = Number.parseInt(
  process.env.API_KEY_ISSUE_NO_RECIPIENT_ESCALATION_DAYS ?? '7',
  10
)

let resendClient: Resend | null = null

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY)
  }

  return resendClient
}

function parseTimestamp(value: string | null): Date | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatTimestampForEmail(value: string | null): string {
  const parsed = parseTimestamp(value)
  return parsed ? parsed.toUTCString() : 'Never'
}

function getLookbackDays(): number {
  if (!Number.isFinite(LOOKBACK_DAYS) || LOOKBACK_DAYS <= 0) {
    return 14
  }
  return LOOKBACK_DAYS
}

function getMaxGuildsToScan(): number {
  if (!Number.isFinite(MAX_GUILDS_TO_SCAN) || MAX_GUILDS_TO_SCAN <= 0) {
    return 150
  }
  return Math.min(MAX_GUILDS_TO_SCAN, 1000)
}

function getNoRecipientEscalationDays(): number {
  if (
    !Number.isFinite(NO_RECIPIENT_ESCALATION_DAYS) ||
    NO_RECIPIENT_ESCALATION_DAYS <= 0
  ) {
    return 7
  }
  return NO_RECIPIENT_ESCALATION_DAYS
}

function getIssueTitle(incidentType: IncidentType): string {
  if (incidentType === 'invalid_api_key') {
    return 'Invalid or Expired Guild API Key'
  }
  return 'Guild Sync Failures Detected'
}

function buildIncidentEmailHtml(args: {
  guild: GuildConfigRow
  incident: ApiKeyIncident
  settingsUrl: string
}): string {
  const guildName = escapeHtml(args.guild.display_name || args.guild.guild_code)
  const issueTitle = escapeHtml(getIssueTitle(args.incident.type))
  const issueSummary = escapeHtml(args.incident.summary)
  const lastSuccess = escapeHtml(
    formatTimestampForEmail(args.guild.last_successful_sync)
  )
  const lastAttempt = escapeHtml(
    formatTimestampForEmail(args.guild.last_sync_attempt)
  )
  const settingsUrl = escapeHtml(args.settingsUrl)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${issueTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6fb;">
    <tr>
      <td align="center" style="padding:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="620" style="max-width:620px;background:#ffffff;border-radius:10px;overflow:hidden;">
          <tr>
            <td style="padding:24px;background:#8b0000;color:#ffffff;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;">Action Required: ${guildName}</h1>
              <p style="margin:8px 0 0 0;font-size:14px;opacity:0.9;">Guild API health incident detected</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937;">
                You are receiving this because your account is mapped as a guild leader/officer (or fallback guild owner).
              </p>

              <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
                <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.03em;">
                  Issue
                </p>
                <p style="margin:0;font-size:15px;color:#111827;font-weight:700;">${issueTitle}</p>
                <p style="margin:8px 0 0 0;font-size:14px;color:#374151;">${issueSummary}</p>
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;"><strong>Last successful sync:</strong> ${lastSuccess}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;font-size:14px;color:#374151;"><strong>Last sync attempt:</strong> ${lastAttempt}</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
                <tr>
                  <td align="center" style="background:#8b0000;border-radius:6px;">
                    <a href="${settingsUrl}" style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">
                      Open Guild Settings
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#6b7280;">
                This email is sent once per active incident to avoid daily notification spam. A new email will only be sent after recovery and a new incident.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#6b7280;">Tacticus Analytics</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function isRecentlyActiveGuild(
  guild: Pick<GuildConfigRow, 'last_successful_sync' | 'last_sync_attempt'>,
  now: Date = new Date(),
  lookbackDays: number = getLookbackDays()
): boolean {
  const thresholdMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000
  const lastSuccessful = parseTimestamp(guild.last_successful_sync)?.getTime()
  const lastAttempt = parseTimestamp(guild.last_sync_attempt)?.getTime()

  return Boolean(
    (typeof lastSuccessful === 'number' && lastSuccessful >= thresholdMs) ||
    (typeof lastAttempt === 'number' && lastAttempt >= thresholdMs)
  )
}

export function classifyApiIncident(
  guild: Pick<GuildConfigRow, 'api_key_is_valid' | 'consecutive_sync_failures'>
): ApiKeyIncident | null {
  const failureCount = guild.consecutive_sync_failures ?? 0

  if (guild.api_key_is_valid === false) {
    return {
      type: 'invalid_api_key',
      summary: `Guild API key is marked invalid. Sync has failed ${failureCount} times.`,
      failureCount
    }
  }

  if (failureCount >= 3) {
    return {
      type: 'sync_failures',
      summary: `Guild sync has failed ${failureCount} consecutive times.`,
      failureCount
    }
  }

  return null
}

async function upsertIncidentState(
  supabase: TypedSupabaseClient,
  row: IncidentStateUpsert
): Promise<void> {
  const incidentStateTable = supabase.from(
    INCIDENT_STATE_TABLE
  ) as unknown as IncidentStateTableClient
  const { error } = await incidentStateTable.upsert(row, {
    onConflict: 'guild_code'
  })

  if (error) {
    throw new Error(
      `Failed to upsert incident state for ${row.guild_code}: ${error.message}`
    )
  }
}

async function resolveRecipientEmails(
  supabase: TypedSupabaseClient,
  guild: GuildConfigRow
): Promise<Recipient[]> {
  const recipients: Recipient[] = []

  const { data: leadershipRows, error: leadershipError } = await supabase
    .from('player_mapping')
    .select('user_id, role')
    .eq('guild_code', guild.guild_code)
    .not('user_id', 'is', null)
    .in('role', LEADERSHIP_ROLES)

  if (leadershipError) {
    logger.error(
      {
        guildCode: guild.guild_code,
        error: leadershipError.message
      },
      '[api-key-notifications] Failed querying leader/officer mappings'
    )
    throw new Error('API key incident recipient lookup failed')
  }

  const leadershipUserIds = Array.from(
    new Set(
      (leadershipRows ?? [])
        .map((row) => row.user_id)
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        )
    )
  )

  if (leadershipUserIds.length > 0) {
    const { data: emailRows, error: emailError } = await supabase
      .from('auth_user_emails')
      .select('user_id, email')
      .in('user_id', leadershipUserIds)
      .not('email', 'is', null)

    if (emailError) {
      logger.error(
        {
          guildCode: guild.guild_code,
          error: emailError.message
        },
        '[api-key-notifications] Failed querying leadership emails'
      )
      throw new Error('API key incident recipient lookup failed')
    } else {
      for (const row of emailRows ?? []) {
        if (!row.email) continue
        recipients.push({
          email: row.email,
          userId: row.user_id,
          source: 'leader_or_officer'
        })
      }
    }
  }

  if (recipients.length === 0 && guild.user_id) {
    const { data: fallbackRow, error: fallbackError } = await supabase
      .from('auth_user_emails')
      .select('user_id, email')
      .eq('user_id', guild.user_id)
      .maybeSingle()

    if (fallbackError) {
      logger.error(
        {
          guildCode: guild.guild_code,
          userId: guild.user_id,
          error: fallbackError.message
        },
        '[api-key-notifications] Failed querying fallback guild owner email'
      )
      throw new Error('API key incident recipient lookup failed')
    } else if (fallbackRow?.email) {
      recipients.push({
        email: fallbackRow.email,
        userId: fallbackRow.user_id,
        source: 'guild_owner_fallback'
      })
    }
  }

  const dedupedByEmail = new Map<string, Recipient>()
  for (const recipient of recipients) {
    const normalized = recipient.email.trim().toLowerCase()
    if (!normalized) continue
    if (!dedupedByEmail.has(normalized)) {
      dedupedByEmail.set(normalized, { ...recipient, email: normalized })
    }
  }

  return Array.from(dedupedByEmail.values())
}

async function sendIncidentEmail(params: {
  recipientEmail: string
  guild: GuildConfigRow
  incident: ApiKeyIncident
}): Promise<{ sent: boolean; providerId?: string; error?: string }> {
  const resend = getResendClient()
  if (!resend) {
    return {
      sent: false,
      error: 'RESEND_API_KEY is not configured'
    }
  }

  const settingsUrl = `${APP_ORIGINS.CURRENT}/guild-management/settings?tab=integrations`
  const guildName = params.guild.display_name || params.guild.guild_code
  const subject = `[Action Required] ${guildName}: ${getIssueTitle(params.incident.type)}`
  const html = buildIncidentEmailHtml({
    guild: params.guild,
    incident: params.incident,
    settingsUrl
  })

  try {
    const response = await withTimeout(
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || EMAIL_ADDRESSES.DEFAULT_FROM,
        to: params.recipientEmail,
        subject,
        html
      }),
      SERVICE_TIMEOUTS.RESEND_EMAIL,
      'send api incident notification email'
    )

    if (response.error) {
      return {
        sent: false,
        error: response.error.message || 'Resend returned an unknown error'
      }
    }

    return {
      sent: true,
      providerId: response.data?.id
    }
  } catch (error) {
    if (error instanceof TimeoutError) {
      return {
        sent: false,
        error: `Timed out after ${error.timeoutMs}ms`
      }
    }
    return {
      sent: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function sendApiKeyIncidentNotifications(
  args: {
    source?: string
  } = {}
): Promise<ApiKeyIncidentNotificationResult> {
  const source = args.source ?? 'api-key-incident-notifications'
  const now = new Date()
  const nowIso = now.toISOString()
  const lookbackDays = getLookbackDays()
  const noRecipientEscalationDays = getNoRecipientEscalationDays()
  const result: ApiKeyIncidentNotificationResult = {
    lookbackDays,
    noRecipientEscalationDays,
    scannedGuilds: 0,
    incidentGuilds: 0,
    resolvedGuilds: 0,
    guildsNotified: 0,
    emailsSent: 0,
    skippedNoRecipients: 0,
    skippedAlreadyNotified: 0,
    staleInvalidKeyIncidentsWithoutRecipients: 0,
    oldestStaleInvalidKeyIncidentDays: null,
    errors: []
  }

  if (!process.env.RESEND_API_KEY) {
    result.errors.push('RESEND_API_KEY is not configured')
    logger.warn(
      '[api-key-notifications] Email delivery is unavailable because RESEND_API_KEY is not configured'
    )
  }

  const supabase = serviceDb()

  const guilds: GuildConfigRow[] = []
  // The configured bound limits each query, not coverage of the daily sweep.
  const pageSize = getMaxGuildsToScan()
  for (let offset = 0; ; offset += pageSize) {
    const { data: guildRows, error: guildError } = await supabase
      .from('guild_config')
      .select(
        'guild_code, enabled, display_name, api_key_is_valid, consecutive_sync_failures, last_successful_sync, last_sync_attempt, user_id'
      )
      .order('guild_code')
      .range(offset, offset + pageSize - 1)

    if (guildError) {
      logger.error(
        { source, error: guildError.message },
        '[api-key-notifications] Guild query failed'
      )
      throw new Error('API key incident guild sweep failed')
    }
    const page = (guildRows ?? []) as GuildConfigRow[]
    guilds.push(...page)
    if (page.length < pageSize) break
  }
  result.scannedGuilds = guilds.length

  if (guilds.length === 0) {
    return result
  }

  const incidentStateTable = supabase.from(
    INCIDENT_STATE_TABLE
  ) as unknown as IncidentStateTableClient
  const states: IncidentStateRow[] = []
  for (let offset = 0; offset < guilds.length; offset += pageSize) {
    const { data: stateRows, error: stateError } = await incidentStateTable
      .select(
        'guild_code, incident_type, incident_started_at, incident_last_seen_at, notified_at, notified_recipients, notified_recipient_count, last_notification_error, resolved_at'
      )
      .in(
        'guild_code',
        guilds.slice(offset, offset + pageSize).map((g) => g.guild_code)
      )
    if (stateError) {
      logger.error(
        { source, error: stateError.message },
        '[api-key-notifications] State query failed'
      )
      throw new Error('API key incident state sweep failed')
    }
    states.push(...(stateRows ?? []))
  }

  const stateByGuildCode = new Map<string, IncidentStateRow>(
    states.map((row) => [row.guild_code, row])
  )

  const incidentGuildEntries = guilds
    .filter((guild) => guild.enabled === true)
    .map((guild) => ({ guild, incident: classifyApiIncident(guild) }))
    .filter(
      (entry): entry is { guild: GuildConfigRow; incident: ApiKeyIncident } => {
        if (!entry.incident) return false
        const existing = stateByGuildCode.get(entry.guild.guild_code)
        const continuingInvalidKey =
          entry.incident.type === 'invalid_api_key' &&
          existing?.incident_type === 'invalid_api_key' &&
          existing.resolved_at === null
        return (
          continuingInvalidKey ||
          isRecentlyActiveGuild(entry.guild, now, lookbackDays)
        )
      }
    )
  result.incidentGuilds = incidentGuildEntries.length
  const incidentByGuildCode = new Map(
    incidentGuildEntries.map((entry) => [entry.guild.guild_code, entry])
  )

  for (const row of stateByGuildCode.values()) {
    if (!row.incident_type) continue
    if (incidentByGuildCode.has(row.guild_code)) continue

    await upsertIncidentState(supabase, {
      guild_code: row.guild_code,
      incident_type: null,
      incident_started_at: null,
      incident_last_seen_at: null,
      notified_at: null,
      notified_recipients: [],
      notified_recipient_count: 0,
      last_notification_error: null,
      resolved_at: nowIso
    })
    result.resolvedGuilds++
  }

  for (const entry of incidentGuildEntries) {
    const guild = entry.guild
    const incident = entry.incident
    const existing = stateByGuildCode.get(guild.guild_code)
    const sameIncidentType = existing?.incident_type === incident.type
    const incidentStartedAt =
      sameIncidentType && existing?.incident_started_at
        ? existing.incident_started_at
        : nowIso
    const alreadyNotified = sameIncidentType && Boolean(existing?.notified_at)

    await upsertIncidentState(supabase, {
      guild_code: guild.guild_code,
      incident_type: incident.type,
      incident_started_at: incidentStartedAt,
      incident_last_seen_at: nowIso,
      notified_at: sameIncidentType ? (existing?.notified_at ?? null) : null,
      notified_recipients: sameIncidentType
        ? (existing?.notified_recipients ?? [])
        : [],
      notified_recipient_count: sameIncidentType
        ? (existing?.notified_recipient_count ?? 0)
        : 0,
      last_notification_error: null,
      resolved_at: null
    })

    if (alreadyNotified) {
      result.skippedAlreadyNotified++
      continue
    }

    const recipients = await resolveRecipientEmails(supabase, guild)
    if (recipients.length === 0) {
      result.skippedNoRecipients++

      const incidentStartedAtMs = parseTimestamp(incidentStartedAt)?.getTime()
      const incidentAgeMs =
        incidentStartedAtMs !== undefined &&
        incidentStartedAtMs <= now.getTime()
          ? now.getTime() - incidentStartedAtMs
          : null
      const escalationAgeMs = noRecipientEscalationDays * 24 * 60 * 60 * 1000
      if (
        incident.type === 'invalid_api_key' &&
        incidentAgeMs !== null &&
        incidentAgeMs > escalationAgeMs
      ) {
        const incidentAgeDays = Math.floor(
          incidentAgeMs / (24 * 60 * 60 * 1000)
        )
        result.staleInvalidKeyIncidentsWithoutRecipients++
        result.oldestStaleInvalidKeyIncidentDays = Math.max(
          result.oldestStaleInvalidKeyIncidentDays ?? 0,
          incidentAgeDays
        )
      }

      await upsertIncidentState(supabase, {
        guild_code: guild.guild_code,
        incident_type: incident.type,
        incident_started_at: incidentStartedAt,
        incident_last_seen_at: nowIso,
        notified_at: null,
        notified_recipients: [],
        notified_recipient_count: 0,
        last_notification_error:
          'No eligible leadership email recipients found',
        resolved_at: null
      })
      continue
    }

    const sentRecipients: string[] = []
    const sendErrors: string[] = []

    for (const recipient of recipients) {
      const sendResult = await sendIncidentEmail({
        recipientEmail: recipient.email,
        guild,
        incident
      })

      if (sendResult.sent) {
        sentRecipients.push(recipient.email)
        result.emailsSent++
        continue
      }

      const message =
        sendResult.error ??
        `Unknown send failure for ${guild.guild_code} -> ${recipient.email}`
      sendErrors.push(message)
      result.errors.push(`[${guild.guild_code}] ${recipient.email}: ${message}`)
    }

    if (sentRecipients.length > 0) {
      result.guildsNotified++
    }

    await upsertIncidentState(supabase, {
      guild_code: guild.guild_code,
      incident_type: incident.type,
      incident_started_at: incidentStartedAt,
      incident_last_seen_at: nowIso,
      notified_at: sentRecipients.length > 0 ? nowIso : null,
      notified_recipients: sentRecipients,
      notified_recipient_count: sentRecipients.length,
      last_notification_error:
        sendErrors.length > 0 ? sendErrors.join(' | ').slice(0, 1000) : null,
      resolved_at: null
    })
  }

  if (result.staleInvalidKeyIncidentsWithoutRecipients > 0) {
    logger.warn(
      {
        source,
        escalationDays: result.noRecipientEscalationDays,
        incidentCount: result.staleInvalidKeyIncidentsWithoutRecipients,
        oldestIncidentDays: result.oldestStaleInvalidKeyIncidentDays
      },
      '[api-key-notifications] Invalid API key incidents remain open without eligible recipients'
    )
  }

  logger.info(
    {
      source,
      scannedGuilds: result.scannedGuilds,
      incidentGuilds: result.incidentGuilds,
      resolvedGuilds: result.resolvedGuilds,
      guildsNotified: result.guildsNotified,
      emailsSent: result.emailsSent,
      skippedNoRecipients: result.skippedNoRecipients,
      skippedAlreadyNotified: result.skippedAlreadyNotified,
      errors: result.errors.length
    },
    '[api-key-notifications] Incident notification run complete'
  )

  return result
}
