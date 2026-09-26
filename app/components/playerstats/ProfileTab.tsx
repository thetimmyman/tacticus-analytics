import type { ReactNode } from 'react'
import { StatusLabel } from '@tacticus/ui-kit'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type {
  BossAssignmentDetails,
  PlayerStats as PlayerStatsData,
  TokenAvailability
} from '@/app/components/playerstats/types'
import type { PlayerMapping, PlayerRole } from '@tacticus/app-core/types'

interface ProfileTabProps {
  playerMapping: PlayerMapping | null
  assignments: BossAssignmentDetails | null
  tokenAvailability: TokenAvailability | null
  playerStats: PlayerStatsData
  resolvedGuildCode: string
  resolvedGuildName: string
  userRole: PlayerRole | string
  hasValidCluster: boolean
}

export function ProfileTab(props: ProfileTabProps) {
  const {
    playerMapping,
    assignments,
    resolvedGuildCode,
    resolvedGuildName,
    userRole
  } = props
  const guildDisplayName =
    resolvedGuildName ||
    formatGuildDisplayLabel(
      { guild_code: playerMapping?.guild_code ?? resolvedGuildCode },
      resolvedGuildCode
    )

  const primaryAssignmentName =
    assignments?.primary?.name ?? playerMapping?.primary_boss ?? null
  const secondaryAssignmentName =
    assignments?.secondary?.name ?? playerMapping?.secondary_boss ?? null
  const bossPreferences = playerMapping?.boss_preferences ?? null
  // Keys are `main_<bossType>` or `side_<primeName>` (already a real name). Resolve
  // ONLY main keys: normalizeBossKey would collapse some primes onto their main.
  const prefBossLabel = (key: string) =>
    key.startsWith('side_')
      ? key.slice('side_'.length)
      : getBossDisplayName(key.replace(/^main_/, ''))
  const preferredBosses = bossPreferences
    ? Object.entries(bossPreferences)
        .filter(([, preference]) => preference === 'preferred')
        .map(([boss]) => boss)
        .sort((a, b) => a.localeCompare(b))
    : []
  const avoidBosses = bossPreferences
    ? Object.entries(bossPreferences)
        .filter(([, preference]) => preference === 'avoid')
        .map(([boss]) => boss)
        .sort((a, b) => a.localeCompare(b))
    : []
  const neutralBosses = bossPreferences
    ? Object.entries(bossPreferences)
        .filter(([, preference]) => preference === 'neutral')
        .map(([boss]) => boss)
        .sort((a, b) => a.localeCompare(b))
    : []

  return (
    <div className="space-y-6">
      <section className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Player Profile
        </h3>
        {playerMapping ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <InfoBlock label="Display Name">
              <span className="text-lg font-semibold text-[var(--text-primary)]">
                {playerMapping.display_name}
              </span>
              {playerMapping.discord_username && (
                <span className="text-sm text-[var(--text-secondary)] block">
                  @{playerMapping.discord_username}
                </span>
              )}
            </InfoBlock>
            <InfoBlock label="Guild">
              <div className="space-y-1">
                <div className="text-lg font-semibold text-[var(--text-primary)]">
                  {guildDisplayName}
                </div>
              </div>
            </InfoBlock>
            <InfoBlock label="Status">
              <div className="flex flex-wrap items-center gap-2">
                <StatusLabel
                  type={playerMapping.is_active ? 'success' : 'inactive'}
                  size="sm"
                >
                  {playerMapping.is_active ? 'Active' : 'Inactive'}
                </StatusLabel>
                {playerMapping.tacticus_api_key_encrypted && (
                  <StatusLabel type="success" size="sm">
                    API Linked
                  </StatusLabel>
                )}
              </div>
            </InfoBlock>
            <InfoBlock label="User Role">
              <span className="text-[var(--text-primary)]">
                {String(userRole)}
              </span>
            </InfoBlock>
            <InfoBlock label="Last Updated">
              <span className="text-[var(--text-primary)]">
                {playerMapping.updated_at
                  ? new Date(playerMapping.updated_at).toLocaleDateString()
                  : 'Unknown'}
              </span>
            </InfoBlock>
            <InfoBlock label="Joined">
              <span className="text-[var(--text-primary)]">
                {playerMapping.created_at
                  ? new Date(playerMapping.created_at).toLocaleDateString()
                  : 'Unknown'}
              </span>
            </InfoBlock>
          </div>
        ) : (
          <div className="text-sm text-[var(--text-secondary)]">
            No active player mapping found for this account.
          </div>
        )}
      </section>

      <section className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Assignments
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <InfoBlock label="Primary Assignment">
            {primaryAssignmentName ? (
              <div className="text-[var(--text-primary)] space-y-1">
                <div className="text-base font-semibold">
                  {primaryAssignmentName}
                </div>
                {assignments?.primary && (
                  <div className="text-xs text-[var(--text-secondary)]">
                    Set {assignments.primary.set}, {assignments.primary.rarity}
                  </div>
                )}
                {playerMapping?.assignment_notes && (
                  <div className="text-xs text-[var(--text-secondary)]">
                    Notes: {playerMapping.assignment_notes}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-[var(--text-secondary)]">Not assigned</span>
            )}
          </InfoBlock>
          <InfoBlock label="Secondary Assignment">
            {secondaryAssignmentName ? (
              <div className="text-[var(--text-primary)] space-y-1">
                <div className="text-base font-semibold">
                  {secondaryAssignmentName}
                </div>
                {assignments?.secondary && (
                  <div className="text-xs text-[var(--text-secondary)]">
                    Set {assignments.secondary.set},{' '}
                    {assignments.secondary.rarity}
                  </div>
                )}
              </div>
            ) : (
              <span className="text-[var(--text-secondary)]">Not assigned</span>
            )}
          </InfoBlock>
        </div>
      </section>

      <section className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Boss Preferences
        </h3>
        <InfoBlock label="Preference Map">
          {bossPreferences && Object.keys(bossPreferences).length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300 uppercase tracking-wide">
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                  Preferred
                </div>
                {preferredBosses.length > 0 ? (
                  <ul className="space-y-1 text-sm text-[var(--text-primary)]">
                    {preferredBosses.map((bossName) => (
                      <li
                        key={bossName}
                        className="flex items-center justify-between"
                      >
                        <span>{prefBossLabel(bossName)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-[var(--text-secondary)]">
                    No preferred bosses set.
                  </div>
                )}
                {neutralBosses.length > 0 && (
                  <div className="pt-2 border-t border-card-border/60">
                    <div className="text-xs uppercase tracking-wide text-[var(--text-secondary)] mb-1">
                      Neutral
                    </div>
                    <ul className="space-y-1 text-sm text-[var(--text-primary)]">
                      {neutralBosses.map((bossName) => (
                        <li key={bossName}>{prefBossLabel(bossName)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-rose-300 uppercase tracking-wide">
                  <span className="h-2 w-2 rounded-full bg-rose-300" />
                  Avoid
                </div>
                {avoidBosses.length > 0 ? (
                  <ul className="space-y-1 text-sm text-[var(--text-primary)]">
                    {avoidBosses.map((bossName) => (
                      <li key={bossName}>{prefBossLabel(bossName)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-[var(--text-secondary)]">
                    No avoid bosses set.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <span className="text-[var(--text-secondary)]">
              No boss preferences recorded for this player.
            </span>
          )}
        </InfoBlock>
      </section>
    </div>
  )
}

interface InfoBlockProps {
  label: string
  children: ReactNode
}

function InfoBlock({ label, children }: InfoBlockProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </div>
      <div className="text-sm leading-relaxed text-[var(--text-primary)]">
        {children}
      </div>
    </div>
  )
}
