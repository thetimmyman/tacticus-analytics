'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { dbClient } from '@/app/lib/db/client'
import { Button } from '@tacticus/ui-kit'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import {
  Copy,
  RefreshCw,
  Trash,
  Plus,
  CheckCircle2,
  AlertCircle,
  MessageSquare
} from 'lucide-react'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('components.discord.DiscordIntegration')
import { cn } from '@/app/lib/utils/cn'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'

const DISCORD_APP_ID =
  process.env.NEXT_PUBLIC_DISCORD_APPLICATION_ID || '1362473802243637389'
const BOT_INVITE_BASE_URL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_APP_ID}&permissions=2048&scope=bot%20applications.commands`

const BOT_COMMANDS: { command: string; description: string; hint?: string }[] =
  [
    {
      command: '/help',
      description: 'List every slash command with output previews.'
    },
    {
      command: '/link <invite-code>',
      description:
        'Manually link this Discord server using a dashboard invite code.',
      hint: 'Use only if the OAuth flow fails or you need to relink without generating a fresh invite.'
    },
    {
      command: '/link-cluster <invite-code>',
      description:
        'Link every guild tied to a cluster invite to this server all at once.',
      hint: 'Only works with cluster-scope invites and will fail if the server already hosts another cluster.'
    },
    {
      command: '/set-default-guild guild:<tag-or-code>',
      description:
        'Bind the current channel (or the provided channel) to a default guild context.',
      hint: 'Set this once per channel so `/tokens`, `/bombs`, and reminders know which guild to target.'
    },
    {
      command: '/set-user-guild guild:<tag-or-code>',
      description:
        'Set or clear your personal default guild so commands auto-target it for you.',
      hint: 'Use `action:clear` to remove the personal default. Overrides channel defaults for your user.'
    },
    {
      command: '/unlink guild:<tag-or-code>',
      description:
        'Remove a guild link from this server if it leaves your cluster or needs a dedicated Discord.'
    },
    {
      command: '/status',
      description:
        'Display the guild linked to this server with quick action reminders.'
    },
    {
      command: '/tokens',
      description:
        'Guild token reserves plus bomb readiness for all active members.'
    },
    {
      command: '/bombs',
      description:
        'Bomb cooldown tracker with an option to show only ready players.'
    },
    {
      command: '/token-reminder',
      description:
        'Enable or disable automated token cap reminders for a chosen channel.'
    },
    {
      command: '/token-usage',
      description:
        'Highlight top token spenders, season totals, and distribution stats.'
    },
    {
      command: '/guild-stats',
      description:
        "Summarize the current season's boss progress by tier and loop."
    },
    {
      command: '/raid-status',
      description:
        'Raid damage overview with recent activity feed and top performers.'
    },
    {
      command: '/player-tokens <player>',
      description: 'Quick token and bomb snapshot for a specific roster member.'
    },
    {
      command: '/player-stats <player>',
      description: 'Drill into a single player’s battle and bomb performance.'
    }
  ]

interface DiscordInvite {
  id: number
  invite_code: string
  created_at: string
  expires_at: string
  is_active: boolean
  current_uses: number
  max_uses: number
}

interface DiscordMapping {
  discord_guild_id: string
  linked_at: string
  is_active: boolean
}

interface DiscordIntegrationProps {
  guildCode: string
  userRole: 'member' | 'officer' | 'leader'
  clusterCode?: string
  className?: string
}

type DiscordErrorKind = 'missing_tables' | 'permission' | 'generic'

interface DiscordErrorState {
  kind: DiscordErrorKind
  message: string
}

const DISCORD_TABLE_MISSING_CODE = '42P01'
const DISCORD_PERMISSION_CODE = '42501'

function resolveDiscordError(
  error: unknown,
  fallback: string
): DiscordErrorState {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: string }).code
      : undefined

  if (code === DISCORD_TABLE_MISSING_CODE) {
    return {
      kind: 'missing_tables',
      message:
        'Discord integration tables were not found. Run your latest database migrations (e.g. npm run db:migrate) to create the discord_invite_codes and discord_server_guilds tables.'
    }
  }

  if (code === DISCORD_PERMISSION_CODE) {
    return {
      kind: 'permission',
      message:
        'The current database role lacks access to the Discord integration tables. Verify Row Level Security policies and service-role permissions.'
    }
  }

  return {
    kind: 'generic',
    message: fallback
  }
}

export function DiscordIntegration({
  guildCode,
  userRole,
  clusterCode,
  className
}: DiscordIntegrationProps) {
  const [invites, setInvites] = useState<DiscordInvite[]>([])
  const [mappings, setMappings] = useState<DiscordMapping[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [error, setError] = useState<DiscordErrorState | null>(null)
  const hasMounted = useHasMounted()

  const supabase = useMemo(() => dbClient(), [])
  const isMember = userRole === 'member'
  const guildDisplayLabel = useGuildDisplayLabel(guildCode)

  const loadDiscordData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: inviteData, error: inviteError } = await supabase
        .from('discord_invite_codes')
        .select('*')
        .eq('guild_code', guildCode)
        .order('created_at', { ascending: false })

      if (inviteError) throw inviteError
      const filteredInvites =
        inviteData?.filter(
          (invite) =>
            invite.is_active &&
            (invite.current_uses ?? 0) < (invite.max_uses ?? 1)
        ) ?? []
      setInvites(filteredInvites as DiscordInvite[])

      const { data: mappingData, error: mappingError } = await supabase
        .from('discord_server_guilds')
        .select('*')
        .eq('game_guild_code', guildCode)
        .eq('is_active', true)

      if (mappingError) throw mappingError
      setMappings((mappingData || []) as DiscordMapping[])
    } catch (error) {
      logger.error({ err: error }, 'Failed to load Discord data:')
      setInvites([])
      setMappings([])
      setError(
        resolveDiscordError(
          error,
          'Failed to load Discord information. Please try again.'
        )
      )
    } finally {
      setLoading(false)
    }
  }, [guildCode, supabase])

  const createInviteCode = async () => {
    try {
      setCreating(true)

      const { data, error } = await supabase
        .from('discord_invite_codes')
        .insert({
          guild_code: guildCode,
          cluster_code: clusterCode ?? null,
          invite_scope: 'guild',
          max_uses: 1,
          expires_at: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString() // 30 days
        })
        .select()
        .single()

      if (error) throw error

      setInvites((prev) => [data as DiscordInvite, ...prev])
      logger.info('Discord invite code created')
    } catch (error) {
      logger.error({ err: error }, 'Failed to create invite code:')
      setError(
        resolveDiscordError(error, 'Unable to create a Discord invite code.')
      )
    } finally {
      setCreating(false)
    }
  }

  const deactivateInvite = async (inviteId: number) => {
    try {
      const { error } = await supabase
        .from('discord_invite_codes')
        .update({ is_active: false })
        .eq('id', inviteId)

      if (error) throw error

      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId))
    } catch (error) {
      logger.error({ err: error }, 'Failed to deactivate invite:')
      setError(
        resolveDiscordError(error, 'Unable to deactivate the invite code.')
      )
    }
  }

  const copyInviteLink = async (inviteCode: string) => {
    const botInviteUrl = `${BOT_INVITE_BASE_URL}&state=${encodeURIComponent(inviteCode)}`

    try {
      await navigator.clipboard.writeText(botInviteUrl)
      setCopiedCode(`link-${inviteCode}`)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (error) {
      logger.error({ err: error }, 'Failed to copy to clipboard:')
    }
  }

  const copyInviteCode = async (inviteCode: string) => {
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopiedCode(`code-${inviteCode}`)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (error) {
      logger.error({ err: error }, 'Failed to copy to clipboard:')
    }
  }

  useEffect(() => {
    if (isMember) {
      setLoading(false)
      return
    }

    loadDiscordData()
  }, [isMember, loadDiscordData])

  if (isMember) {
    return (
      <div className={cn(className)}>
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
            <p className="text-[var(--text-secondary)]">
              Discord integration is only available to guild officers and
              leaders.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const activeMappings = mappings.filter((m: any) => m.is_active)
  const botInviteTemplate = `${BOT_INVITE_BASE_URL}&state=<INVITE_CODE>`

  return (
    <div className={cn('space-y-6', className)}>
      {error && (
        <Card className="border-red-500/40 bg-red-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <p className="text-sm text-red-100">{error.message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-red-500/40 text-red-200 hover:bg-red-500/10"
                onClick={loadDiscordData}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-[#5865F2]" />
              Discord Bot Integration
            </div>
            {/* Status Badge */}
            {activeMappings.length > 0 ? (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-800 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-medium">Connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>Not Connected</span>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Status */}
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg">
            <div className="flex items-start gap-3">
              <div className="text-[#5865F2] mt-1">
                <MessageSquare className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <h4 className="font-medium text-[var(--text-primary)] mb-1">
                  Discord Bot Commands
                </h4>
                {activeMappings.length > 0 ? (
                  <p className="text-[var(--text-secondary)] text-sm mb-2">
                    Your guild is connected to {activeMappings.length} Discord
                    server{activeMappings.length !== 1 ? 's' : ''}. Members can
                    now use bot commands like{' '}
                    <code className="bg-[var(--bg-primary)] px-1 rounded">
                      /tokens
                    </code>{' '}
                    and{' '}
                    <code className="bg-[var(--bg-primary)] px-1 rounded">
                      /help
                    </code>
                    .
                  </p>
                ) : (
                  <p className="text-[var(--text-secondary)] text-sm mb-2">
                    Connect your Discord server to enable bot commands for guild
                    members. The bot provides real-time token tracking, raid
                    status, and more.
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-[var(--text-tertiary)]">
                  <span>&bull; Real-time token &amp; bomb status</span>
                  <span>&bull; Raid progress updates</span>
                  <span>&bull; Player performance stats</span>
                </div>
              </div>
            </div>
          </div>

          {!activeMappings.length && (
            <>
              {/* Setup Instructions */}
              <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-lg space-y-4">
                <div>
                  <h4 className="font-medium text-[var(--text-primary)] mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                    Quick Setup Guide
                  </h4>
                  <ol className="text-sm text-[var(--text-secondary)] space-y-3 pl-4">
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">
                        1
                      </span>
                      <span>
                        Click <strong>Create Invite</strong>. This mints a
                        single-use code and adds it to the invite list on the
                        right.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">
                        2
                      </span>
                      <span>
                        Next to that code, choose <strong>Copy Bot Link</strong>
                        . It copies the full Discord OAuth URL (template below)
                        with your invite code in the <code>state</code>{' '}
                        parameter. Paste the link into a new browser tab to open
                        the Discord authorization screen.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">
                        3
                      </span>
                      <span>
                        Select the Discord server where you have the{' '}
                        <strong>Manage Server</strong> permission, then click{' '}
                        <strong>Authorize</strong> to add the bot.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">
                        4
                      </span>
                      <span>
                        In your Discord server, type{' '}
                        <code className="bg-[var(--bg-primary)] px-1 rounded">
                          /link
                        </code>{' '}
                        and paste the invite code (use{' '}
                        <strong>Copy Code</strong> above, or paste the full bot
                        link — the bot will extract the code automatically).
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="flex-shrink-0 w-5 h-5 bg-green-100 text-green-600 rounded-full flex items-center justify-center mt-0.5">
                        <CheckCircle2 className="w-3 h-3" />
                      </span>
                      <span>
                        Once linked, try commands like{' '}
                        <code className="bg-[var(--bg-primary)] px-1 rounded">
                          /tokens
                        </code>{' '}
                        or{' '}
                        <code className="bg-[var(--bg-primary)] px-1 rounded">
                          /help
                        </code>
                        . Create another invite if you need to link an
                        additional server.
                      </span>
                    </li>
                  </ol>
                </div>
                <div className="rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] border border-card-border/50 p-3 text-xs text-[var(--text-secondary)]">
                  <p className="font-semibold text-[var(--text-primary)] mb-2">
                    Manual bot invite URL template
                  </p>
                  <div className="overflow-x-auto">
                    <code className="whitespace-nowrap bg-[color-mix(in_srgb,var(--bg-primary)_80%,transparent)] px-2 py-1 rounded">
                      {botInviteTemplate}
                    </code>
                  </div>
                  <p className="mt-2">
                    Replace <code>&lt;INVITE_CODE&gt;</code> with the code shown
                    in the list. The <code>state</code> value is how Tacticus
                    Analytics links your Discord server to{' '}
                    <strong>{guildDisplayLabel}</strong>.
                  </p>
                  <p className="mt-2">
                    Used or disabled invites disappear from this list
                    automatically, keeping only the links that are ready for
                    deployment.
                  </p>
                </div>
              </div>
            </>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)]">
                <MessageSquare className="w-4 h-4 text-[var(--accent)]" />
              </span>
              <h4 className="font-medium">Slash Command Reference</h4>
            </div>
            <div className="text-sm space-y-3">
              {BOT_COMMANDS.map((entry) => (
                <div key={entry.command} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <code className="bg-[color-mix(in_srgb,var(--bg-secondary)_70%,transparent)] px-2 py-1 rounded text-[var(--text-primary)] font-mono text-sm">
                      {entry.command}
                    </code>
                    <span className="text-[var(--text-secondary)]">
                      {entry.description}
                    </span>
                  </div>
                  {entry.hint && (
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {entry.hint}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
          {/* Permission Info */}
          <div className="p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                  Bot Access Permissions
                </div>
                <div className="text-[var(--text-secondary)] space-y-1">
                  <div>
                    <strong>Officers:</strong> Access to {guildDisplayLabel}{' '}
                    guild data only
                  </div>
                  {clusterCode && userRole === 'leader' && (
                    <div>
                      <strong>Leaders:</strong> Access to entire {clusterCode}{' '}
                      cluster data
                    </div>
                  )}
                  <div className="text-xs text-[var(--text-tertiary)] mt-2">
                    Bot commands are secure - users can only access data
                    they&#39;re authorized for
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Invites */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide leading-tight">
                Discord Invite Codes
              </h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                Generate a Discord invite code to link the Tacticus Analytics
                Discord Bot to your server.
              </p>
            </div>
            <Button
              onClick={createInviteCode}
              disabled={creating}
              size="sm"
              className="flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              {creating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Create Invite
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] py-8">
              <RefreshCw className="w-6 h-6 animate-spin mb-2 text-[var(--text-secondary)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                Loading invite codes...
              </p>
            </div>
          ) : invites.length === 0 ? (
            <div className="rounded-lg border border-dashed border-card-border/60 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-6 text-sm text-[var(--text-secondary)]">
              No active invite codes right now.
            </div>
          ) : (
            <div className="space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-col gap-3 rounded-lg border border-card-border/50 bg-[color-mix(in_srgb,var(--bg-secondary)_60%,transparent)] p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <code className="text-sm font-mono bg-[color-mix(in_srgb,var(--bg-primary)_80%,transparent)] px-2 py-1 rounded">
                        {invite.invite_code}
                      </code>
                      <span
                        className={cn(
                          'px-2 py-1 rounded text-xs font-medium',
                          invite.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        )}
                      >
                        {invite.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {invite.current_uses >= invite.max_uses && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-800">
                          Used
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      Created:{' '}
                      {hasMounted
                        ? new Date(invite.created_at).toLocaleDateString()
                        : '—'}
                      {' · '}
                      Expires:{' '}
                      {hasMounted
                        ? new Date(invite.expires_at).toLocaleDateString()
                        : '—'}
                      {' · '}
                      Uses: {invite.current_uses}/{invite.max_uses}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    {invite.is_active &&
                      invite.current_uses < invite.max_uses && (
                        <>
                          <Button
                            onClick={() => copyInviteLink(invite.invite_code)}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-2 justify-center w-full md:w-auto"
                          >
                            {copiedCode === `link-${invite.invite_code}` ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                            {copiedCode === `link-${invite.invite_code}`
                              ? 'Copied!'
                              : 'Copy Bot Link'}
                          </Button>
                          <Button
                            onClick={() => copyInviteCode(invite.invite_code)}
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-2 justify-center w-full md:w-auto"
                          >
                            {copiedCode === `code-${invite.invite_code}` ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                            {copiedCode === `code-${invite.invite_code}`
                              ? 'Copied!'
                              : 'Copy Code'}
                          </Button>
                        </>
                      )}

                    {invite.is_active && (
                      <Button
                        onClick={() => deactivateInvite(invite.id)}
                        size="sm"
                        variant="outline"
                        className="justify-center text-red-600 hover:text-red-700 hover:bg-red-50 w-full md:w-auto"
                      >
                        <Trash className="w-4 h-4" />
                        Disable
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {/* Connected Servers */}
      {activeMappings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Connected Discord Servers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activeMappings.map((mapping) => (
                <div
                  key={mapping.discord_guild_id}
                  className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg"
                >
                  <div>
                    <div className="font-medium">Discord Server</div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      Connected:{' '}
                      {hasMounted
                        ? new Date(mapping.linked_at).toLocaleDateString()
                        : '—'}
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                    Connected
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
