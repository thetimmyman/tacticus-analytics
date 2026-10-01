/** Source of truth for slash-command gating, kept in sync with registration by a test. No handler imports (cycles). */

/** 'officer': checked before deferring; 'member': anyone; 'handler': the handler enforces its own contract. */
export type CommandGating = 'officer' | 'member' | 'handler'

/** Scopes the officer check to the guild the handler queries, so an officer of A cannot read linked B. */
export type CommandGuildScope = 'tokens' | 'notifications'

export interface CommandManifestEntry {
  name: string
  gating: CommandGating
  /** Link-management commands omit it and keep the officer-in-any-linked-guild rule. */
  guildScope?: CommandGuildScope
  /** Creates the first server-guild link, so the gate defers to the handler (invite-code auth). */
  runsWithoutLinks?: boolean
  /** Otherwise answer inline within Discord's 3s deadline. */
  deferred: boolean
  publicOption: boolean
  defaultPublic?: boolean
}

export const COMMAND_MANIFEST: readonly CommandManifestEntry[] = [
  { name: 'help', gating: 'member', deferred: false, publicOption: false },
  { name: 'status', gating: 'member', deferred: false, publicOption: false },
  {
    name: 'link',
    gating: 'officer',
    runsWithoutLinks: true,
    deferred: true,
    publicOption: false
  },
  {
    name: 'link-cluster',
    gating: 'officer',
    runsWithoutLinks: true,
    deferred: true,
    publicOption: false
  },
  { name: 'unlink', gating: 'officer', deferred: true, publicOption: false },
  {
    name: 'set-default-guild',
    gating: 'officer',
    deferred: false,
    publicOption: false
  },
  {
    name: 'set-user-guild',
    gating: 'member',
    deferred: false,
    publicOption: false
  },
  {
    name: 'tokens',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: true,
    defaultPublic: true
  },
  {
    name: 'bombs',
    gating: 'member',
    deferred: true,
    publicOption: true,
    defaultPublic: true
  },
  {
    name: 'token-usage',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: false
  },
  {
    name: 'token-overview',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: true,
    defaultPublic: true
  },
  {
    name: 'time-to-burn',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: false
  },
  {
    name: 'token-reminder',
    gating: 'officer',
    guildScope: 'notifications',
    deferred: true,
    publicOption: false
  },
  {
    name: 'player-tokens',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: false
  },
  {
    name: 'player-time',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: false
  },
  {
    name: 'player-stats',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: false
  },
  {
    name: 'stats',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: true,
    defaultPublic: false
  },
  {
    name: 'raid-status',
    gating: 'member',
    deferred: true,
    publicOption: true,
    defaultPublic: false
  },
  {
    name: 'raid',
    gating: 'member',
    deferred: true,
    publicOption: true,
    defaultPublic: false
  },
  {
    name: 'guild-stats',
    gating: 'member',
    deferred: true,
    publicOption: true,
    defaultPublic: false
  },
  {
    name: 'boss',
    gating: 'member',
    deferred: true,
    publicOption: true,
    defaultPublic: false
  },
  {
    name: 'player-performance',
    gating: 'officer',
    guildScope: 'tokens',
    deferred: true,
    publicOption: false
  },
  // In-memory KB retrieval, so it answers inline.
  { name: 'ask', gating: 'member', deferred: false, publicOption: false },
  {
    name: 'playbook',
    gating: 'member',
    deferred: true,
    publicOption: true,
    defaultPublic: false
  }
]

export const DEFERRED_COMMANDS: ReadonlySet<string> = new Set(
  COMMAND_MANIFEST.filter((entry) => entry.deferred).map((entry) => entry.name)
)

export const PUBLIC_OPTION_DEFAULTS: ReadonlyMap<string, boolean> = new Map(
  COMMAND_MANIFEST.filter((entry) => entry.publicOption).map((entry) => [
    entry.name,
    entry.defaultPublic === true
  ])
)

export const OFFICER_ONLY_COMMANDS: ReadonlySet<string> = new Set(
  COMMAND_MANIFEST.filter((entry) => entry.gating === 'officer').map(
    (entry) => entry.name
  )
)

export const UNLINKED_BOOTSTRAP_COMMANDS: ReadonlySet<string> = new Set(
  COMMAND_MANIFEST.filter((entry) => entry.runsWithoutLinks === true).map(
    (entry) => entry.name
  )
)

export const GUILD_SCOPED_COMMAND_SCOPES: Readonly<
  Record<string, CommandGuildScope>
> = COMMAND_MANIFEST.reduce<Record<string, CommandGuildScope>>(
  (scopes, entry) => {
    if (entry.guildScope) {
      scopes[entry.name] = entry.guildScope
    }
    return scopes
  },
  {}
)
