/** `valid` cases are real code shapes from this repo; `invalid` cases are real leak shapes. */
import { afterAll, describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'

import rule from '../no-internal-identifier-in-ui.mjs'
// Imported, not re-declared, so a carve-out cannot pass here while missing from the real config.
import { wi825AllowedFiles } from '../wi825-allowed-files.mjs'

RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only
RuleTester.afterAll = afterAll

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } }
  }
})

const WITH_ALLOWLIST = [{ allowedFiles: wi825AllowedFiles }]

/** Synthetic whole-file carve-out; must still refuse to exempt a tier-2 secret. */
const SYNTHETIC_WHOLE_FILE_ENTRY = {
  path: 'app/(dashboard)/admin/ops-console/Panel.tsx',
  reason: 'synthetic fixture — exercises the whole-file allowlist branch'
}

const tsx = (body) =>
  `export function Surface(props: any) {\n  return (\n${body}\n  )\n}\n`

ruleTester.run('no-internal-identifier-in-ui', rule, {
  valid: [
    {
      name: 'React key= is never user-visible (GlobalLeaderboard.tsx)',
      filename: 'app/components/homepage/GlobalLeaderboard.tsx',
      code: tsx(
        '    <tr key={`${entry.display_name}-${entry.guild_code}`}>{entry.rank}</tr>'
      )
    },
    {
      name: 'key={guild.guild_code}',
      filename: 'app/x.tsx',
      code: tsx('    <li key={guild.guild_code}>ok</li>')
    },
    {
      name: 'key= built from a playerId template literal',
      filename: 'app/components/performance/PerformanceChart.tsx',
      code: tsx(
        '    <Cell key={player.playerId ? `player-${player.playerId}` : `player-${player.displayName}-${index}`} />'
      )
    },
    {
      name: 'href={`/guilds/${code}`}',
      filename: 'app/(public)/guilds/GuildsDirectoryClient.tsx',
      code: tsx('    <a href={`/guilds/${guild.guild_code}`}>Open</a>')
    },
    {
      name: 'id / htmlFor / src / action / name are not text-bearing',
      filename: 'app/x.tsx',
      code: tsx(
        '    <label htmlFor={row.user_id} id={row.guild_code} data-x={row.player_id}>ok</label>'
      )
    },
    {
      name: 'data-* attribute (Avatar.tsx)',
      filename: 'packages/ui-kit/src/Avatar.tsx',
      code: tsx(
        '    <span data-guild-code={guildCode || undefined}>{initials}</span>'
      )
    },
    {
      name: 'on* handler prop building a toast-free string',
      filename: 'app/x.tsx',
      code: tsx(
        '    <button onClick={() => copy(row.guild_code)}>Copy</button>'
      )
    },

    // Form inputs: value/defaultValue is an editing affordance.
    {
      name: 'value={draft.guild_code} on an input',
      filename: 'app/(dashboard)/members/MemberDirectory.tsx',
      code: tsx(
        '    <input value={draft.guild_code} onChange={(e) => patch({ guild_code: e.target.value })} placeholder="EOT" />'
      )
    },
    {
      name: 'value={apiKey} on the field that exists to set the key',
      filename: 'app/(dashboard)/profile/edit/EditProfileApiKeySection.tsx',
      code: tsx(
        '    <input type="password" value={apiKey} onChange={onChange} />'
      )
    },
    {
      name: 'value={formData.user_id} / defaultValue on credential inputs',
      filename: 'app/(dashboard)/war-tracking/components/WarSyncConfig.tsx',
      code: tsx(
        '    <input value={formData.user_id} defaultValue={formData.client_secret} onChange={onChange} />'
      )
    },
    {
      name: 'value={guildData.guildCode} on the cluster-join wizard',
      filename: 'app/components/clusters/GuildJoinFlow.tsx',
      code: tsx('    <input value={guildData.guildCode} onChange={onChange} />')
    },
    {
      name: 'value={formData.player_id} / value={formData.api_key} on an application form',
      filename: 'app/(public)/onboarding/eot-application/ClientPage.tsx',
      code: tsx(
        '    <form><input value={formData.player_id} /><input value={formData.api_key} /></form>'
      ),
      options: WITH_ALLOWLIST
    },

    {
      name: 'secret used only as a truthiness test; both branches are literals',
      filename: 'app/(dashboard)/clusters/create/_components/StepReview.tsx',
      code: tsx("    <span>{guild.apiKey ? '(Ready)' : '(Invitation)'}</span>")
    },
    {
      name: 'user_id used as a presence test',
      filename:
        'app/(dashboard)/guild-management/members/components/MemberListTable.tsx',
      code: tsx("    <span>{member.user_id ? 'Claimed' : 'Unclaimed'}</span>")
    },
    {
      name: 'guild_code in an equality comparison driving expand state',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/components/GuildTableRow.tsx',
      code: tsx(
        "    <button>{expandedWebhooks === guild.guild_code ? 'Hide' : 'Manage'}</button>"
      )
    },
    {
      name: 'own-guild highlight comparison outside any render position',
      filename: 'app/(public)/guilds/GuildsDirectoryClient.tsx',
      code: `export function isOwn(currentGuildCode: string, guild: any) {
  return currentGuildCode?.toUpperCase() === guild.guild_code.toUpperCase()
}
`
    },
    {
      name: 'secret name inside a filter predicate; .length is what renders',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/components/ClusterHeader.tsx',
      code: tsx(
        '    <span>{guilds.filter((g: any) => g.has_api_key).length}</span>'
      )
    },
    {
      name: 'label-map lookup with no re-leaking fallback',
      filename: 'app/x.tsx',
      code: tsx('    <span>{guildLabels[row.guildCode]}</span>')
    },

    {
      name: 'errors.guildCode / fieldErrors.guildCode hold the validation message',
      filename: 'app/components/clusters/GuildJoinFlow.tsx',
      code: tsx(
        '    <p>{errors.guildCode}{fieldErrors.guildCode}{touched.player_id}</p>'
      )
    },
    {
      name: 'enum label maps may fall back to the raw key (BOSS_DISPLAY_NAMES / JOB_STATUS_LABELS)',
      filename:
        'app/(dashboard)/guild-management/members/components/MemberListTable.tsx',
      code: tsx(
        '    <span>{BOSS_DISPLAY_NAMES[member.primary_boss] ?? member.primary_boss}{JOB_STATUS_LABELS[job.status] ?? job.status}</span>'
      )
    },
    // The zone domain is opaque: `ZONE_DISPLAY_NAMES[zoneId] || zoneId` is invalid below.
    {
      name: 'discordUsernames[name] ?? name is a username map, not an opaque key map',
      filename: 'app/components/GRAvailability.tsx',
      code: `export function label(discordUsernames: Record<string, string>, name: string) {
  return discordUsernames[name] ?? name
}
`
    },

    {
      name: 'zone_type as a React key and a <option value=>, label via zoneDisplayName',
      filename: 'app/(dashboard)/wars/_components/ActivityFilterBar.tsx',
      code: tsx(
        '    <option key={zoneType} value={zoneType}>{zoneDisplayName(zoneType)}</option>'
      )
    },
    {
      name: 'a correct zoneDisplayName()/zoneShortName() call is not a leak',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: tsx(
        '    <div><h3>{zoneDisplayName(zone.zoneType)}</h3><span>{zoneShortName(zone.zoneType)}</span></div>'
      )
    },
    {
      name: 'icon/image lookup keyed by zone type (getZoneImageUrl / ZONE_IMAGES)',
      filename: 'app/(dashboard)/wars/_components/ZoneImageTooltip.tsx',
      code: `export function ZoneImageTooltip({ zoneType }: any) {
  const imageUrl = getZoneImageUrl(zoneType)
  const icon = ZONE_ICONS[zoneType] ?? FALLBACK_ZONE_ICON
  return <Image src={imageUrl} alt={zoneDisplayName(zoneType)} data-icon={icon} />
}
`
    },
    {
      name: 'zone_type used as a filter predicate and a grouping identity',
      filename: 'app/(dashboard)/wars/_components/ActivityFilterBar.tsx',
      code: `export function useZoneOptions(attempts: any[], filters: any) {
  const result = attempts.filter((a: any) => a.zoneType === filters.selectedZone)
  const zoneOptions = [...new Set(attempts.map((a: any) => a.zoneType).filter(Boolean))]
    .map((zoneType: string) => ({ zoneType, label: zoneDisplayName(zoneType) }))
  return { result, zoneOptions }
}
`
    },
    {
      name: 'war-naming.ts own lookups (miss branch is humanize/short, not the key)',
      filename: 'app/lib/war/war-naming.ts',
      code: `export function zoneDisplayName(zoneType: string): string {
  const entry = zoneNames[zoneType]
  if (entry) return entry.name
  return humanizeUnknownZoneType(zoneType)
}
export function zoneShortName(zoneType: string): string {
  return zoneNames[zoneType]?.short ?? zoneDisplayName(zoneType)
}
`
    },
    {
      name: 'boardDisplayName falls back to the raw board id ON PURPOSE',
      filename: 'app/lib/war/war-naming.ts',
      code: `export function boardDisplayName(boardId: string): string {
  return boardNames[boardId]?.name ?? boardId
}
export function rawBoardFallback(boardNamesById: Record<string, string>, boardId: string) {
  return boardNamesById[boardId] ?? boardId
}
`
    },
    {
      name: 'status/boss enum maps are untouched by the zone domain',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: tsx(
        '    <span>{statusLabels[job.statusType] ?? job.statusType}{bossLabels[b.bossType] ?? b.bossType}</span>'
      )
    },
    {
      name: 'opaque-domain maps keyed by a readable *Type enum stay silent',
      filename: 'app/(dashboard)/x.tsx',
      code: `export function badges(u: any, m: any, p: any, acct: any, cl: any) {
  return [
    userLabels[u.userType] ?? u.userType,
    memberNames[m.memberType] ?? m.memberType,
    playerLabels[p.playerType] ?? p.playerType,
    accountNames[acct.accountType] ?? acct.accountType,
    clusterLabels[cl.clusterType] ?? cl.clusterType,
  ]
}
`
    },

    // Name-shaped but not the identifier (exact match, not substring).
    {
      name: 'members_with_api_key is an integer count, not a key',
      filename:
        'app/(dashboard)/roster-development/RosterDevelopmentClient.tsx',
      code: tsx('    <span>API keys: {summary.members_with_api_key}</span>')
    },
    {
      name: 'api_owner is a human display name; only the api_ prefix matches',
      filename:
        'app/(dashboard)/guild-api-keys/GuildSpecificApiKeyManagement.tsx',
      code: tsx('    <span>{apiKeyData.api_owner}</span>')
    },
    {
      name: 'priorUserId is not user_id (app-admin audit receipt)',
      filename:
        'app/(dashboard)/guild-management/members/components/modals/AdminUnlinkModal.tsx',
      code: tsx('    <p>Prior user_id: {success.priorUserId}</p>')
    },
    {
      name: 'discordGuildId is a Discord snowflake, not guild_id',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/components/DiscordBotSection.tsx',
      code: tsx('    <span>{link.discordLink.discordGuildId}</span>')
    },
    {
      name: 'cluster_code is a short human code, not a UUID',
      filename: 'app/(dashboard)/profile/[id]/page.tsx',
      code: tsx('    <dd>Cluster: {profile.cluster_code}</dd>')
    },
    {
      name: 'cluster_code / guild.code / invite_code render fine',
      filename:
        'app/(public)/onboarding/dashboard/OnboardingDashboardClient.tsx',
      code: tsx(
        '    <ul><li>{cluster.cluster_code}</li><li>{guild.code} - {guild.name}</li><li>{invite.invite_code}</li></ul>'
      ),
      options: WITH_ALLOWLIST
    },
    {
      name: 'support-correlation tokens (requestId / errorId) are self-owned handles',
      filename: 'app/(dashboard)/profile/RequestMyDataButton.tsx',
      code: tsx(
        '    <p>Request ID: <span className="font-mono">{requestId}</span> / {errorId}</p>'
      )
    },
    {
      name: 'job_id is the operator handle for their own run, not a person key',
      filename: 'app/(dashboard)/admin/jobs/JobQueue.tsx',
      code: tsx(
        '    <div title={`Run ${job.job_id.slice(0, 8)}`}>{job.job_id.slice(0, 8)}</div>'
      ),
      options: WITH_ALLOWLIST
    },
    {
      name: 'unitId / sourceId are game content ids shown on catalog miss',
      filename: 'app/catalog/UnitDetail.tsx',
      code: tsx(
        '    <th scope="row">{resolveName(row.unitId) || row.unitId}</th>'
      ),
      options: WITH_ALLOWLIST
    },
    {
      name: 'actor_id / unit_id are game unit ids',
      filename: 'app/(dashboard)/admin/decisions/DecisionCard.tsx',
      code: tsx('    <span>{decision.actor_id} {u.unit_id}</span>')
    },
    {
      // meta_team_id is not tier 1; see the additionalOpaqueIdentifiers invalid case.
      name: 'meta_team_id is not flagged unless opted in',
      filename:
        'app/(dashboard)/roster-development/components/ImportTargetsModal.tsx',
      code: tsx('    <span>{candidate.meta_team_id.slice(0, 8)}</span>')
    },

    // Escape hatch 1a: approved canonical resolvers.
    {
      name: 'formatGuildDisplayLabel(guild)',
      filename: 'app/x.tsx',
      code: tsx('    <span>{formatGuildDisplayLabel(guild)}</span>')
    },
    {
      name: 'formatGuildCodeFallback(error.guild_code)',
      filename: 'app/(dashboard)/error-monitoring/ErrorMonitoringDashboard.tsx',
      code: tsx(
        '    <span>Guild: {formatGuildCodeFallback(error.guild_code)}</span>'
      )
    },
    {
      name: 'formatGuildDisplayLabel(null, user.guild_code)',
      filename: 'app/(dashboard)/admin/feature-releases/UserManagerRoleTab.tsx',
      code: tsx(
        '    <span>{formatGuildDisplayLabel(null, user.guild_code)}</span>'
      ),
      options: WITH_ALLOWLIST
    },
    {
      name: 'formatGuildDisplayLabel with an inline guild-like object',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/components/DiscordBotSection.tsx',
      code: tsx(
        '    <span>{formatGuildDisplayLabel({ display_name: link.displayName, guild_code: link.guildCode }, link.guildCode)}</span>'
      )
    },
    {
      name: 'formatGuildTag(guild)',
      filename: 'app/(public)/explore/components/GuildCard.tsx',
      code: tsx(
        '    <span className="font-mono">{formatGuildTag(guild)}</span>'
      )
    },
    {
      name: 'maskApiKey()/maskSecret() clear a tier-2 secret',
      filename: 'app/x.tsx',
      code: tsx('    <code>{maskApiKey(row.api_key)}</code>')
    },
    {
      name: 'resolve at the top of the component, render only the resolved local',
      filename: 'app/(public)/guilds/[guildCode]/GuildStatus.tsx',
      code: `export function GuildStatus({ guildName, guildCode }: any) {
  const displayName = formatGuildDisplayLabel({ display_name: guildName, guild_code: guildCode }, guildCode)
  return <h1>{displayName}</h1>
}
`
    },

    // Escape hatch 1b: local wrappers that terminate in a resolver.
    {
      name: 'local wrapper formatWarGuildLabel forwards to formatGuildDisplayLabel',
      filename: 'app/(dashboard)/war-explorer/GuildWarExplorerClient.tsx',
      code: `const formatWarGuildLabel = (guildCode: string | null, guildName?: string | null) =>
  formatGuildDisplayLabel({ display_name: guildName, guild_code: guildCode }, guildCode)

export function Explorer({ match }: any) {
  return <td>{formatWarGuildLabel(match.guild_code)}</td>
}
`
    },
    {
      name: 'renderGuild = guildLabels[g] ?? formatGuildDisplayLabel(null, g)',
      filename: 'app/(dashboard)/leaderboards/components/BossLeaderboards.tsx',
      code: `export function BossLeaderboards({ guildLabels, entry }: any) {
  const renderGuild = (guild: string) => guildLabels[guild] ?? formatGuildDisplayLabel(null, guild)
  return <td>{renderGuild(entry.Guild)}</td>
}
`
    },
    {
      name: 'renderGuildTag with an OPTIONAL guildLabels prop but a safe ?? fallback',
      filename: 'app/components/PlayerBattleLog.tsx',
      code: `export function PlayerBattleLog({ guildLabels, entry }: any) {
  const renderGuildTag = (code: string): string =>
    guildLabels?.[code] ?? formatGuildDisplayLabel(null, code)
  return <span>[{renderGuildTag(entry.Guild)}]</span>
}
`
    },
    {
      name: 'labelForCode() in a notice/prompt/heading (7 call sites)',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/components/GuildCaptureCredentialSection.tsx',
      code: `export function Section({ guilds, confirming }: any) {
  const labelForCode = (guildCode: string) =>
    formatGuildDisplayLabel(guilds.find((guild: any) => guild.guild_code === guildCode) ?? null, guildCode)
  return <p>capture for {labelForCode(confirming.guildCode)}?</p>
}
`
    },
    {
      name: 'setNotice() through the canonical helper',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/hooks/useGuildActions.ts',
      code: `export function useGuildActions(setNotice: (s: string) => void, guildCode: string) {
  setNotice(\`\${formatGuildDisplayLabel(null, guildCode)} has been disabled from the cluster.\`)
}
`
    },
    {
      name: 'toast.success() through a useCallback-wrapped local resolver',
      filename:
        'app/(public)/onboarding/dashboard/OnboardingDashboardClient.tsx',
      code: `export function Dashboard({ clusterGuilds, guildCode }: any) {
  const getClusterGuildLabel = useCallback(
    (code: string) => formatGuildDisplayLabel(clusterGuilds.find((g: any) => g.guild_code === code) ?? null, code),
    [clusterGuilds]
  )
  toast.success(\`\${getClusterGuildLabel(guildCode)} is queued for a fresh sync.\`)
  return null
}
`,
      options: WITH_ALLOWLIST
    },

    // Structs that pair an internal key with a pre-resolved label.
    {
      name: 'presence entry carries both userId and a pre-resolved label',
      filename: 'app/(dashboard)/guild-ops/herald/useHeraldBossPresence.ts',
      code: `export function usePresence(first: any) {
  return {
    userId: first.userId,
    label: typeof first.label === 'string' && first.label.trim().length > 0 ? first.label : 'Officer',
  }
}
`
    },
    {
      name: 'player_name assigned the raw playerId at a property (never renders)',
      filename: 'app/(dashboard)/war-tracking/hooks/useWarZoneData.ts',
      code: `export function build(entry: any, playerId: string) {
  return { player_name: entry.label ?? playerId, avg_score: entry.avg }
}
`
    },
    {
      name: 'displayName ?? playerId as an argument to a non-sink function',
      filename: 'app/components/token-usage/hooks/useTokenUsageData.ts',
      code: `export function collect(rpc: any, playerId: string, availabilityByPlayerId: Map<string, any>) {
  appendRpcOnlyPlayer(playerId, rpc.displayName ?? playerId, rpc, availabilityByPlayerId.get(playerId))
}
`
    },
    {
      name: 'pre-resolved guild_name prop (explore GuildCard)',
      filename: 'app/(public)/explore/components/GuildCard.tsx',
      code: tsx('    <h3>{guild.guild_name}</h3>')
    },
    {
      name: 'Discord `<@id>` mention syntax is the wire format, not copy',
      filename: 'app/components/GRAvailability.tsx',
      code: `export function mention(userId: string) {
  return \`<@\${userId}>\`
}
`
    },

    {
      // Check (d) only runs in files with JSX: setError/setStatus/setMessage are common server-side.
      name: 'a JSX-free server module is not a sink surface',
      filename: 'app/lib/sync/report.ts',
      code: `export function fail(row: any, setError: any) {
  setError('sync failed for ' + row.guild_code)
}
`
    },
    {
      name: 'sessionId (a client-generated run handle) is not auth material',
      filename: 'app/(dashboard)/admin/DebugExerciseRunner.tsx',
      code: tsx('    <p>run {sessionId}</p>')
    },

    // Escape hatch 2: file allowlist.
    {
      name: 'a whole-file allowlist entry exempts non-secret identifiers',
      filename: 'app/(dashboard)/admin/ops-console/Panel.tsx',
      code: tsx('    <td>{entry.guildCode} {entry.player_id}</td>'),
      options: [{ allowedFiles: [SYNTHETIC_WHOLE_FILE_ENTRY] }]
    },
    {
      name: 'app-admin feature-releases surface renders the key as copyable ops data',
      filename: 'app/(dashboard)/admin/feature-releases/ActivityAnalytics.tsx',
      code: tsx(
        '    <div>{guild.guildName}<span className="font-mono">{guild.guildCode}</span></div>'
      ),
      options: WITH_ALLOWLIST
    },
    {
      name: 'profile editor echoes the operator-supplied player_id',
      filename: 'app/(dashboard)/profile/edit/EditProfilePlayerIdSection.tsx',
      code: tsx('    <p>Player ID {pending.player_id} ready</p>'),
      options: WITH_ALLOWLIST
    },
    {
      name: "self-owned player_id under an explicit 'Player ID' label",
      filename: 'app/(dashboard)/profile/page.tsx',
      code: tsx("    <dd>{profile.player_id || 'Not set'}</dd>"),
      options: WITH_ALLOWLIST
    },
    {
      name: 'onboarding echoes the player_id the user just typed',
      filename:
        'app/(public)/onboarding/dashboard/OnboardingDashboardClient.tsx',
      code: tsx('    <p>Player linked: {progress.player_name || playerId}</p>'),
      options: WITH_ALLOWLIST
    },
    {
      name: 'admin job sessionId (tier 2 name, admin-gated sim handle)',
      filename: 'app/(dashboard)/admin/jobs/JobRunner.tsx',
      code: tsx('    <span>{sessionId.slice(-8)}</span>'),
      options: WITH_ALLOWLIST
    },

    // Escape hatch 3: inline disable.
    {
      // RuleTester registers the rule as `rule-to-test/<name>`. The `-- reason` is mandatory.
      name: 'eslint-disable-next-line with a written reason (convention)',
      filename: 'app/x.tsx',
      code: `export function Surface(props: any) {
  return (
    <span>
      {/* eslint-disable-next-line rule-to-test/no-internal-identifier-in-ui -- support console: the raw key is what the operator pastes into psql */}
      {props.row.guild_code}
    </span>
  )
}
`
    },

    // Test, story and fixture files are skipped wholesale.
    {
      name: 'a *.test.tsx file is skipped',
      filename: 'app/(dashboard)/leaderboards/Leaderboards.test.tsx',
      code: tsx('    <p>{row.guild_code} {row.api_key}</p>')
    },
    {
      name: 'tests/ and __mocks__/ and *.stories.tsx are skipped',
      filename: 'tests/unit/leaderboards/harness.tsx',
      code: tsx('    <p>{row.guild_code}</p>')
    }
  ],

  invalid: [
    // (a)/(b) JSX child, incl. template literals and concatenation.
    {
      // Same file as a valid <input value={draft.guild_code}>: the carve-out must be positional.
      name: 'guild_code interpolated into a JSX child template literal',
      filename: 'app/(dashboard)/members/MemberDirectory.tsx',
      code: tsx(
        "    <span>{vis === 'guild' && row.guild_code ? ` · ${row.guild_code}` : ''}</span>"
      ),
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } }
      ]
    },
    {
      name: 'label || rawCode in a JSX child (flag-worthy but currently dead)',
      filename: 'app/(dashboard)/profile/page.tsx',
      code: tsx('    <span>{guildDisplayLabel || guildCode}</span>'),
      options: WITH_ALLOWLIST,
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guildCode' } }
      ]
    },
    {
      name: 'cond && guild_code renders the right operand',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <span>{isGuildScoped && row.guild_code}</span>'),
      errors: [{ messageId: 'opaqueGuildIdentifier' }]
    },
    {
      name: 'string concatenation in a JSX child',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx("    <span>{'Guild ' + row.guild_code}</span>"),
      errors: [{ messageId: 'opaqueGuildIdentifier' }]
    },
    {
      name: '.slice(0, 8) does not launder an opaque key',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <span>{row.guild_code.slice(0, 8)}</span>'),
      errors: [{ messageId: 'opaqueGuildIdentifier' }]
    },
    {
      name: 'player_id / user_id / cluster_id in a JSX child',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <p>{row.player_id} / {row.userId} / {row.cluster_id}</p>'),
      errors: [
        { messageId: 'opaqueIdentifier', data: { name: 'player_id' } },
        { messageId: 'opaqueIdentifier', data: { name: 'userId' } },
        { messageId: 'opaqueIdentifier', data: { name: 'cluster_id' } }
      ]
    },
    {
      name: 'anything ending in _uuid / Uuid',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <p>{row.record_uuid} {row.sessionUuid}</p>'),
      errors: [
        { messageId: 'opaqueIdentifier', data: { name: 'record_uuid' } },
        { messageId: 'opaqueIdentifier', data: { name: 'sessionUuid' } }
      ]
    },
    {
      name: 'computed string-literal key (row["guild_code"])',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx("    <p>{row['guild_code']}</p>"),
      errors: [{ messageId: 'opaqueGuildIdentifier' }]
    },

    // Tier 2: secrets. A formatter is not an escape hatch.
    {
      name: '<p>{row.api_key}</p> is a tier-2 secret',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <p>{row.api_key}</p>'),
      errors: [{ messageId: 'secretIdentifier', data: { name: 'api_key' } }]
    },
    {
      name: 'access_token / client_secret in a JSX child',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <p>{creds.access_token} {creds.clientSecret}</p>'),
      errors: [
        { messageId: 'secretIdentifier', data: { name: 'access_token' } },
        { messageId: 'secretIdentifier', data: { name: 'clientSecret' } }
      ]
    },
    {
      name: 'session_token (real auth material) is a secret',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <p>{auth.session_token}</p>'),
      errors: [
        { messageId: 'secretIdentifier', data: { name: 'session_token' } }
      ]
    },
    {
      name: 'a whole-file allowlist entry never exempts a secret',
      filename: 'app/(dashboard)/admin/ops-console/Panel.tsx',
      code: tsx('    <td>{entry.guildCode} {entry.api_key}</td>'),
      options: [{ allowedFiles: [SYNTHETIC_WHOLE_FILE_ENTRY] }],
      errors: [{ messageId: 'secretIdentifier', data: { name: 'api_key' } }]
    },
    {
      // Reported with the shipped allowlist so the removed admin carve-out cannot return.
      name: 'admin diagnostics is not carved out by the shipped allowlist',
      filename: 'app/(dashboard)/admin/diagnostics/TokenTotalsPanel.tsx',
      code: tsx(
        '    <td title={entry.guildCode}>{entry.guildCode} {homeGuild}</td>'
      ),
      options: WITH_ALLOWLIST,
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guildCode' } },
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guildCode' } }
      ]
    },
    {
      name: 'a display formatter does not clear a secret',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <p>{`key ${creds.apiKey.slice(0, 4)}`}</p>'),
      errors: [{ messageId: 'secretIdentifier', data: { name: 'apiKey' } }]
    },

    // (c) text-bearing JSX attributes.
    {
      name: 'title= / aria-label= / placeholder= carry copy',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx(
        '    <div title={`Guild ${row.guild_code}`} aria-label={row.guild_code} placeholder={row.player_id} />'
      ),
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } },
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } },
        { messageId: 'opaqueIdentifier', data: { name: 'player_id' } }
      ]
    },
    {
      name: 'alt= / emptyMessage= / helperText= / errorMessage= carry copy',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx(
        '    <Img alt={guild.guild_code} emptyMessage={row.user_id} helperText={row.accountId} errorMessage={row.profile_id} />'
      ),
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } },
        { messageId: 'opaqueIdentifier', data: { name: 'user_id' } },
        { messageId: 'opaqueIdentifier', data: { name: 'accountId' } },
        { messageId: 'opaqueIdentifier', data: { name: 'profile_id' } }
      ]
    },

    // (d) user-visible string sinks.
    {
      // Sink fixtures are component files because check (d) needs JSX.
      name: 'setNotice(`saved for ${guildCode}`) in a component file',
      filename: 'app/(dashboard)/x.tsx',
      code: `export function Save(props: any) {
  const save = (guildCode: string, setNotice: any) => {
    setNotice(\`saved for \${guildCode}\`)
  }
  return <button onClick={() => save(props.guildCode, props.setNotice)} />
}
`,
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guildCode' } }
      ]
    },
    {
      name: 'toast.error / setError / window.alert sinks',
      filename: 'app/(dashboard)/x.tsx',
      code: `export function Fail(props: any) {
  const fail = (row: any, setError: any) => {
    toast.error(\`Sync failed for \${row.guild_code}\`)
    setError('player ' + row.player_id)
    window.alert(row.api_key)
  }
  return <button onClick={() => fail(props.row, props.setError)} />
}
`,
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } },
        { messageId: 'opaqueIdentifier', data: { name: 'player_id' } },
        { messageId: 'secretIdentifier', data: { name: 'api_key' } }
      ]
    },

    // (e) label map whose fallback re-leaks the key.
    {
      name: 'guildLabels[code] ?? code',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <span>{guildLabels[code] ?? code}</span>'),
      errors: [
        {
          messageId: 'labelMapFallbackLeaksKey',
          data: { map: 'guildLabels', key: 'code' }
        }
      ]
    },
    {
      name: 'guildLabels[code] || code (|| variant)',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <span>{guildLabels[code] || code}</span>'),
      errors: [{ messageId: 'labelMapFallbackLeaksKey' }]
    },
    {
      name: 'guildNames[app.guild_code] || app.guild_code at a declarator',
      filename: 'app/(dashboard)/profile/edit/EditProfileClient.tsx',
      code: `export function build(guildNames: Record<string, string>, app: any) {
  const guildName = guildNames[app.guild_code] || app.guild_code
  return guildName
}
`,
      errors: [
        {
          messageId: 'labelMapFallbackLeaksKey',
          data: { map: 'guildNames', key: 'app.guild_code' }
        }
      ]
    },
    {
      name: 'optional-chained label map still re-leaks (guildLabels?.[code] ?? code)',
      filename: 'app/(dashboard)/x.tsx',
      code: tsx('    <span>{guildLabels?.[code] ?? code}</span>'),
      errors: [{ messageId: 'labelMapFallbackLeaksKey' }]
    },

    // (e) zone domain: regression guard for zone-id fallbacks.
    {
      name: 'ZONE_DISPLAY_NAMES[zoneId] || zoneId — the shape that shipped ComsStation',
      filename: 'app/api/war/zone-config/route.ts',
      code: `export function zone(zoneId: string, zoneType: string) {
  return { zoneName: ZONE_DISPLAY_NAMES[zoneId] || zoneId, alt: ZONE_DISPLAY_NAMES[zoneType] ?? zoneType }
}
`,
      errors: [
        {
          messageId: 'labelMapFallbackLeaksZoneKey',
          data: { map: 'ZONE_DISPLAY_NAMES', key: 'zoneId' }
        },
        {
          messageId: 'labelMapFallbackLeaksZoneKey',
          data: { map: 'ZONE_DISPLAY_NAMES', key: 'zoneType' }
        }
      ]
    },
    {
      // Fires only because `type` is opaque inside the zone domain (DOMAIN_EXTRA_OPAQUE_KEY_WORDS).
      name: 'ZONE_DISPLAY_NAMES[zoneType] ?? zoneType (domain-scoped `type`)',
      filename: 'app/lib/war/guild-war-parser.ts',
      code: `export function zoneDisplayNameLegacy(zoneType: string): string {
  return ZONE_DISPLAY_NAMES[zoneType] ?? zoneType
}
`,
      errors: [
        {
          messageId: 'labelMapFallbackLeaksZoneKey',
          data: { map: 'ZONE_DISPLAY_NAMES', key: 'zoneType' }
        }
      ]
    },
    {
      // `zoneId` ends in the globally opaque `id`, so it fires without the `type` extension.
      name: 'zoneNames[zoneId] ?? zoneId (domain alone is enough)',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: tsx('    <span>{zoneNames[zoneId] ?? zoneId}</span>'),
      errors: [
        {
          messageId: 'labelMapFallbackLeaksZoneKey',
          data: { map: 'zoneNames', key: 'zoneId' }
        }
      ]
    },
    {
      // snake_case member key; also exercises sameExpression() on a MemberExpression fallback.
      name: 'zoneLabels[zone.zone_type] ?? zone.zone_type',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: tsx(
        '    <span>{zoneLabels[zone.zone_type] ?? zone.zone_type}</span>'
      ),
      errors: [
        {
          messageId: 'labelMapFallbackLeaksZoneKey',
          data: { map: 'zoneLabels', key: 'zone.zone_type' }
        }
      ]
    },
    {
      // Matches both `player` and `zone`: domain matching must collect all domains.
      name: 'playerZoneLabels[zoneType] ?? zoneType — compound name keeps the zone extension',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: tsx('    <span>{playerZoneLabels[zoneType] ?? zoneType}</span>'),
      errors: [
        {
          messageId: 'labelMapFallbackLeaksZoneKey',
          data: { map: 'playerZoneLabels', key: 'zoneType' }
        }
      ]
    },
    {
      // A tier-1 guild key in a zone map keeps the guild message; (a) also reports row.guild_id.
      name: 'zoneLabels[row.guild_id] ?? row.guild_id keeps the GUILD message',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: tsx('    <span>{zoneLabels[row.guild_id] ?? row.guild_id}</span>'),
      errors: [
        {
          messageId: 'labelMapFallbackLeaksKey',
          data: { map: 'zoneLabels', key: 'row.guild_id' }
        },
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_id' } }
      ]
    },
    {
      name: 'hoisted zone lookup still re-leaks (const n = ZONE_NAMES[zoneType])',
      filename: 'app/(dashboard)/wars/_components/ZoneStatsGrid.tsx',
      code: `export function Cell({ zoneType }: any) {
  const zoneNameLabel = ZONE_NAMES[zoneType]
  return <span>{zoneNameLabel ?? zoneType}</span>
}
`,
      errors: [{ messageId: 'labelMapFallbackLeaksZoneKey' }]
    },

    {
      name: 'additionalOpaqueIdentifiers catches meta_team_id',
      filename:
        'app/(dashboard)/roster-development/components/ImportTargetsModal.tsx',
      code: tsx('    <span>{candidate.meta_team_id.slice(0, 8)}</span>'),
      options: [{ additionalOpaqueIdentifiers: ['meta_team_id'] }],
      errors: [
        { messageId: 'opaqueIdentifier', data: { name: 'meta_team_id' } }
      ]
    },
    {
      name: 'additionalTextAttributes catches guildName={display_name || guild_code}',
      filename:
        'app/(dashboard)/leaderboards/components/cluster-management/components/GuildTable.tsx',
      code: tsx(
        '    <GuildCard guildName={guild.display_name || guild.guild_code} />'
      ),
      options: [{ additionalTextAttributes: ['guildName'] }],
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } }
      ]
    },
    {
      name: 'a narrowed allowlist entry does not exempt other identifiers',
      filename: 'app/(dashboard)/profile/page.tsx',
      code: tsx('    <dd>{profile.player_id} {profile.guild_code}</dd>'),
      options: WITH_ALLOWLIST,
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guild_code' } }
      ]
    },
    {
      name: 'admin surfaces are flagged when the allowlist is not supplied',
      filename: 'app/(dashboard)/admin/diagnostics/TokenTotalsPanel.tsx',
      code: tsx('    <td>{entry.guildCode}</td>'),
      errors: [
        { messageId: 'opaqueGuildIdentifier', data: { name: 'guildCode' } }
      ]
    }
  ]
})
