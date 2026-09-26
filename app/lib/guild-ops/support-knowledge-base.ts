/**
 * `internal:` sources cite a generalized support pattern and must never include a
 * player's name, email, guild tag or account ID.
 */

export interface SupportKnowledgeEntry {
  id: string
  category: string
  question: string
  keywords: string[]
  answer: string
  sourceRef: string
}

export const SUPPORT_KNOWLEDGE_BASE: SupportKnowledgeEntry[] = [
  {
    id: 'general-what-is',
    category: 'General',
    question: 'What is Tacticus Analytics?',
    keywords: ['what', 'tacticus', 'analytics', 'guild', 'raid', 'dashboard'],
    answer:
      'Tacticus Analytics tracks Warhammer 40,000: Tacticus guild raid data for clusters and independent guilds. It provides damage metrics, leaderboards, token tracking, and management tools for guild leadership across the Tacticus community.',
    sourceRef: '/faq#general-questions'
  },
  {
    id: 'general-access',
    category: 'General',
    question: 'How do I get access?',
    keywords: ['access', 'join', 'invite', 'account', 'activate', 'link'],
    answer:
      'Access is managed through guild membership. Contact your guild officers or leaders to have your account activated. You will need to link your in-game display name to your dashboard account.',
    sourceRef: '/faq#general-questions'
  },
  {
    id: 'general-access-levels',
    category: 'General',
    question: 'What are the different access levels?',
    keywords: [
      'access',
      'level',
      'role',
      'member',
      'officer',
      'leader',
      'permission'
    ],
    answer:
      'Access is based on your role within the guild: Members have access to basic features and statistics, Officers can manage guild operations and view detailed analytics, and Leaders have full administrative control.',
    sourceRef: '/faq#general-questions'
  },
  {
    id: 'token-tracking',
    category: 'Token System',
    question: 'How does Token Tracking work?',
    keywords: [
      'token',
      'tracking',
      'regenerate',
      'season',
      'cap',
      'bomb',
      'cooldown'
    ],
    answer:
      'The token system tracks both real-time availability and season-wide usage. Players start each season with 2 tokens, tokens regenerate 1 every 12 hours (max 3), the season cap is 28 tokens total, bombs have an 18-hour cooldown, and warning status indicates capped tokens (wasting regeneration).',
    sourceRef: '/faq#token-system'
  },
  {
    id: 'token-boss-assignment',
    category: 'Token System',
    question: 'How do Boss Assignment Tokens work?',
    keywords: [
      'boss',
      'assignment',
      'token',
      'primary',
      'secondary',
      'planning'
    ],
    answer:
      'For upcoming season planning, players allocate their 3 available tokens across boss assignments: each player has 3 tokens to allocate for the season, a primary boss assignment consumes 2 tokens, and a secondary boss assignment consumes 1 token.',
    sourceRef: '/faq#token-system'
  },
  {
    id: 'api-key-what',
    category: 'API Keys & Data Sync',
    question: 'What are API Keys and why do I need one?',
    keywords: ['api', 'key', 'sync', 'data', 'why', 'need'],
    answer:
      'API keys enable real-time data synchronization from the official Tacticus API. They enable real-time token/bomb status tracking, provide accurate availability calculations, and are managed through your dashboard profile.',
    sourceRef: '/faq#api-keys-data-sync'
  },
  {
    id: 'api-key-how-to-add',
    category: 'API Keys & Data Sync',
    question: 'How do I add my Player API key?',
    keywords: ['api', 'key', 'add', 'upload', 'setup', 'create', 'sync'],
    answer:
      'Go to the official Tacticus site, click "Create New API Key" with read access to: Player, then copy and paste the key into the dashboard. The key indicator will turn golden when successfully synced.',
    sourceRef: '/faq#api-keys-data-sync'
  },
  {
    id: 'api-key-privacy-share',
    category: 'API Keys & Data Sync',
    question: 'Do you share my raid information?',
    keywords: ['share', 'privacy', 'data', 'third', 'party', 'private'],
    answer:
      "We do not sell your raid information. Public Explore and leaderboard pages may show obscured guild values. Members of guilds in the same cluster can view this guild's per-battle data.",
    sourceRef: '/faq#api-keys-data-sync'
  },
  {
    id: 'api-key-privacy-view',
    category: 'API Keys & Data Sync',
    question: 'Are you able to view our raid information?',
    keywords: ['view', 'see', 'access', 'raid', 'information', 'aggregate'],
    answer:
      'Yes, just like any service that you share your API credentials with we will be able to view your raid information. However, we promise to only use this data at the aggregate level in the meta analysis pages.',
    sourceRef: '/faq#api-keys-data-sync'
  },
  {
    id: 'troubleshoot-no-data',
    category: 'Troubleshooting',
    question: 'Why am I seeing "No data" for some metrics?',
    keywords: ['no data', 'missing', 'empty', 'sync', 'freshness', 'stale'],
    answer:
      'Performance percentages require at least 1 battle against that boss. Historical data may take time to sync after initial account creation. Add your Player API key for real-time accuracy.',
    sourceRef: '/faq#troubleshooting'
  },
  {
    id: 'troubleshoot-missing-pages',
    category: 'Troubleshooting',
    question: "I can't see certain pages or features",
    keywords: [
      'missing',
      'page',
      'feature',
      'permission',
      'role',
      'restricted'
    ],
    answer:
      'Check your role permissions. Some features are restricted to Officers/Leaders only. Contact your guild leadership if you need elevated permissions.',
    sourceRef: '/faq#troubleshooting'
  },
  {
    id: 'themes-customization',
    category: 'Themes & Customization',
    question: 'Can I change my dashboard theme?',
    keywords: ['theme', 'color', 'customize', 'faction', 'appearance'],
    answer:
      'Yes, the dashboard supports 35+ themed color schemes including all major Warhammer 40K factions. Access theme settings through your profile page; a theme preview is available to compare all options. Guild leaders can set a default theme for their guild through the guild settings page.',
    sourceRef: '/faq#themes-customization'
  },
  {
    id: 'meta-analysis-what',
    category: 'Meta Analysis',
    question: 'What is the Meta Analysis page?',
    keywords: ['meta', 'analysis', 'team', 'composition', 'strategy', 'sim'],
    answer:
      'The Meta Analysis page identifies the most consistent high-performing team compositions for each boss by analyzing damage patterns across the community.',
    sourceRef: '/faq#meta-analysis'
  },
  {
    id: 'votlw-standings',
    category: 'Veteran of the Long War',
    question: 'What are VOTLW standings?',
    keywords: [
      'votlw',
      'veteran',
      'long',
      'war',
      'medal',
      'standings',
      'points'
    ],
    answer:
      'Veteran of the Long War (VOTLW) is a point-based season competition that ranks players across multiple categories of achievement, including set medals per boss level.',
    sourceRef: '/faq#votlw'
  },
  {
    id: 'boss-playbooks-what',
    category: 'Boss Playbooks',
    question: 'What are Boss Playbooks?',
    keywords: ['playbook', 'strategy', 'map', 'team', 'herald', 'encounter'],
    answer:
      'Boss Playbooks cover guild raid strategy, seasonal encounter planning, maps, teams, and Herald operations.',
    sourceRef: '/boss-playbooks'
  },
  {
    id: 'is-it-free',
    category: 'Subscription & Support',
    question: 'Is there a subscription or is Tacticus Analytics free?',
    keywords: ['subscription', 'free', 'pay', 'cost', 'price', 'tip'],
    answer:
      'Tacticus Analytics is 100% free. If you find it useful, you can leave a tip via Buy Me a Coffee or Patreon, purely optional.',
    sourceRef: '/support-creator'
  },
  {
    id: 'found-a-bug',
    category: 'Support & Contact',
    question: 'I found a bug or have a feature request',
    keywords: ['bug', 'issue', 'feature', 'request', 'report', 'contact'],
    answer:
      "Bugs and feature requests can be reported through the project's support channels listed on the Support & Contact section of the FAQ page.",
    sourceRef: '/faq#support-contact'
  },

  {
    id: 'password-reset-lockout',
    category: 'Account & Login',
    question:
      "I tried to reset my password and now I'm locked out of my account",
    keywords: ['password', 'reset', 'locked', 'lockout', 'account', 'login'],
    answer:
      'This has happened before and is recoverable — it is not a permanent lockout. Do not ask the player to post passwords, API keys, or account emails in guild chat. Escalate through the normal support channel so the site owner can handle account recovery privately with the account owner; the player should avoid creating a duplicate account unless support asks them to.',
    sourceRef: '/faq#support-contact'
  },
  {
    id: 'login-works-one-device-not-another',
    category: 'Account & Login',
    question: "Login works on my phone but won't let me in on my computer",
    keywords: [
      'login',
      'device',
      'phone',
      'computer',
      'account',
      'stuck',
      "won't let me in"
    ],
    answer:
      'This is almost always a wrong-account issue rather than a bug: many players have two accounts/emails (e.g. a Discord alias vs. an in-game name) and are signed into a different, never-onboarded one on the failing device. Double-check you are using the same email on both devices. Server-side config problems fail on every device, not just one.',
    sourceRef: '/faq#support-contact'
  },
  {
    id: 'delete-account-data-start-over',
    category: 'Account & Login',
    question: 'Can I delete all my account data and start over?',
    keywords: ['delete', 'account', 'data', 'reset', 'start over', 'wipe'],
    answer:
      'Yes, there is a self-service option in your profile settings. If you have two accounts/emails and are confused about which one has your stats, check both logins first — data is often present but attached to the other account rather than missing.',
    sourceRef: '/faq#general-questions'
  },
  {
    id: 'guild-tokens-page-error',
    category: 'Data & Sync',
    question: 'The guild tokens page is showing an error',
    keywords: ['tokens', 'error', 'guild', 'page', 'broken'],
    answer:
      'This has previously been caused by a temporary outage on the official Tacticus API (upstream), not a dashboard bug — it resolves on its own once the upstream service recovers. If the error persists for more than an hour, ask an officer to escalate it.',
    sourceRef: '/faq#support-contact'
  },
  {
    id: 'another-guild-data-stale',
    category: 'Data & Sync',
    question:
      "Another guild's boss loop/level looks stale or wrong compared to the in-game leaderboard",
    keywords: [
      'stale',
      'wrong',
      'guild',
      'loop',
      'level',
      'leaderboard',
      'sync',
      'outdated'
    ],
    answer:
      "This is a data-sync lag issue, not a display bug — a guild's data only updates once its own sync has run. It can look behind the in-game leaderboard until the next sync cycle completes. If it stays stale for a long time, flag it for an officer/admin to check that guild's sync status.",
    sourceRef: '/faq#api-keys-data-sync'
  },
  {
    id: 'meta-teams-filter-not-working',
    category: 'Roster & Meta',
    question:
      "The Meta Teams filter on the roster page doesn't seem to do anything",
    keywords: ['meta', 'teams', 'filter', 'roster', 'not working', 'broken'],
    answer:
      'This is a known gap — the Meta Teams filter on the roster page does not currently work. Use the "Raid Teams" section on the Player Stats page instead; it surfaces the same team-composition information.',
    sourceRef: '/faq#meta-analysis'
  },
  {
    id: 'season-config-source',
    category: 'Season Planning',
    question:
      'How do you know which guild season config is currently active and which one is next?',
    keywords: [
      'season',
      'config',
      'active',
      'next',
      'upcoming',
      'guild season'
    ],
    answer:
      'The current season is read from the live in-game config, overlaid with the marketing/build-preview config where one has been published for the next season. There is no way to anticipate further ahead than whatever the marketing config has revealed.',
    sourceRef: '/faq#api-keys-data-sync'
  },
  {
    id: 'war-board-personal-score-inflated-fixed',
    category: 'War Tracking',
    question:
      'My personal War Board score looks too high compared to my actual damage',
    keywords: [
      'war board',
      'personal score',
      'inflated',
      'wrong',
      'too high',
      'zone',
      'capture'
    ],
    answer:
      'This was a real bug — zone-capture bonus points were being added on top of personal damage-based scores — and it has been fixed (personal score is now capped per-war at the damage-based score). If you still see inflated personal scores, this may be a regression; escalate it.',
    sourceRef: '/faq#support-contact'
  },
  {
    id: 'herald-emoji-shortcodes-literal',
    category: 'Playbooks & Herald',
    question:
      'Herald Discord posts show emoji shortcodes as literal text instead of icons',
    keywords: [
      'herald',
      'emoji',
      'shortcode',
      'literal',
      'discord',
      'icon',
      'not rendering'
    ],
    answer:
      "This was mostly fixed — Herald emoji now resolve by the unit's in-game name. A small number of unit classes that are catalogued only by class name rather than individual name (e.g. Custodes) may still show as literal text; report which specific unit is affected so it can be added to the catalogue.",
    sourceRef: '/faq#support-contact'
  },
  {
    id: 'boss-prime-portraits-missing-known-issue',
    category: 'Playbooks & Herald',
    question:
      'A new boss prime (mini-boss) is showing initials instead of its portrait in Playbooks',
    keywords: [
      'boss',
      'prime',
      'portrait',
      'missing',
      'initials',
      'playbook',
      'image'
    ],
    answer:
      "This is a known open issue for newly added primes: their portrait asset sometimes isn't seeded correctly when first added, so the UI falls back to initials. A fix for the underlying naming/seeding gap is in progress; if you see this on a recently added boss, report it rather than assuming it will self-resolve.",
    sourceRef: '/faq#support-contact'
  },
  {
    id: 'herald-notes-reverting-open-issue',
    category: 'Known Issues (Open)',
    question:
      'My notes on a Herald encounter keep reverting or disappearing after I save them',
    keywords: ['notes', 'revert', 'disappear', 'save', 'herald', 'lost'],
    answer:
      'This is a known active issue as of late June 2026 — edits to encounter notes have intermittently failed to persist. Workaround: save in smaller increments and confirm the save took before navigating away. If you lose important notes, escalate to guild leadership/the developer — this has not yet been confirmed fixed.',
    sourceRef: '/faq#support-contact'
  }
]
