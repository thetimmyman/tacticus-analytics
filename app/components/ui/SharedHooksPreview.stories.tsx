import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BossCatalog } from '@/app/lib/catalogs/bosses'
import {
  useBossData,
  useGuildConfig,
  useGuildMembers,
  usePlayerRoster,
  useSeasonData
} from '@/app/lib/hooks/shared'

type PreviewMode = 'loaded' | 'loading' | 'error'

type HookStatus = {
  status: 'Loading' | 'Error' | 'Ready'
  error: Error | null
}

const GUILD_CODE = 'DEMO'
const SEASON_NUMBER = '99'

const buildQueryClient = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false
      }
    }
  })

  const bossCatalog = new BossCatalog({
    bosses: [
      {
        bossId: 'avatarofkhaine',
        displayName: 'Avatar of Khaine',
        faction: 'Unknown',
        turnLimit: 0,
        setNumber: 1,
        portraits: {
          icon: '/images/bosses/icons/avatarofkhaine.png',
          thumbnail: '/images/bosses/thumbnails/avatarofkhaine.png',
          portrait: '/images/bosses/portraits/avatarofkhaine.png'
        },
        tiers: [],
        boards: [],
        bossType: 'AvatarOfKhaine',
        encounterIndex: 0,
        unitId: 'GuildBoss1',
        primes: []
      },
      {
        bossId: 'hivetyrant',
        displayName: 'Hive Tyrant',
        faction: 'Unknown',
        turnLimit: 0,
        setNumber: 2,
        portraits: {
          icon: '/images/bosses/icons/hive_tyrant.png',
          thumbnail: '/images/bosses/thumbnails/hive_tyrant.png',
          portrait: '/images/bosses/portraits/hive_tyrant.png'
        },
        tiers: [],
        boards: [],
        bossType: 'HiveTyrant',
        encounterIndex: 0,
        unitId: 'GuildBoss2',
        primes: []
      }
    ],
    mappings: [
      {
        id: 1,
        boss_type: 'AvatarOfKhaine',
        boss_name: 'Avatar of Khaine',
        encounter_index: 0,
        unit_id: 'GuildBoss1',
        icon_path: null,
        portrait_path: null,
        thumbnail_path: null,
        asset_slug: null,
        map_metadata: null,
        map_display_name: null,
        map_slug: null,
        map_variant: null
      }
    ]
  })

  client.setQueryData(['boss-catalog'], bossCatalog)

  client.setQueryData(['player-roster'], {
    units: [
      {
        id: 'ultra_inceptor_01',
        name: 'Bellator',
        faction: 'Imperial',
        grandAlliance: 'Imperial',
        progressionIndex: 12,
        xpLevel: 50,
        rank: 18,
        shards: 0,
        abilities: [{ id: 'active', level: 45 }],
        engineId: 'ultra_inceptor_01',
        category: 'hero'
      },
      {
        id: 'sister_superior_01',
        name: 'Celestine',
        faction: 'Imperial',
        grandAlliance: 'Imperial',
        progressionIndex: 9,
        xpLevel: 35,
        rank: 14,
        shards: 0,
        abilities: [{ id: 'active', level: 40 }],
        engineId: 'sister_superior_01',
        category: 'hero'
      }
    ],
    machinesOfWar: [
      {
        id: 'mow_basilisk',
        name: 'Basilisk',
        progressionIndex: 8,
        xpLevel: 30,
        rank: 12,
        engineId: 'mow_basilisk',
        category: 'mow'
      }
    ]
  })

  client.setQueryData(['guild-config', GUILD_CODE], {
    guild_code: GUILD_CODE,
    display_name: 'DEMO',
    primary_assignment_tokens: 2,
    secondary_assignment_tokens: 1,
    token_offender_threshold: 40,
    token_abuser_threshold: 50
  })

  client.setQueryData(
    ['guild-members', GUILD_CODE],
    [
      {
        api_key_encrypted: null,
        assignment_notes: null,
        boss_preferences: null,
        avatar_unit_id: 'ultra_inceptor_01',
        player_level: 38,
        discord_user_id: '1234567890',
        display_name: 'Astra',
        guild_code: GUILD_CODE,
        is_current: true,
        last_sync_at: '2025-12-22T10:00:00Z',
        last_sync_bombs: 3,
        last_sync_tokens: 12,
        officer_notes: null,
        player_id: 'player-1',
        player_notes: null,
        primary_boss: 'AvatarOfKhaine',
        primary_team: null,
        role: 'leader',
        secondary_boss: 'HiveTyrant',
        secondary_team: null,
        tacticus_api_key_encrypted: null,
        tacticus_username: 'Astra',
        tertiary_team: null,
        user_id: '00000000-0000-0000-0000-000000000001'
      },
      {
        api_key_encrypted: null,
        assignment_notes: null,
        boss_preferences: null,
        avatar_unit_id: 'sister_superior_01',
        player_level: 32,
        discord_user_id: '9876543210',
        display_name: 'Kestrel',
        guild_code: GUILD_CODE,
        is_current: true,
        last_sync_at: '2025-12-22T10:05:00Z',
        last_sync_bombs: 1,
        last_sync_tokens: 8,
        officer_notes: null,
        player_id: 'player-2',
        player_notes: null,
        primary_boss: 'HiveTyrant',
        primary_team: null,
        role: 'member',
        secondary_boss: null,
        secondary_team: null,
        tacticus_api_key_encrypted: null,
        tacticus_username: 'Kestrel',
        tertiary_team: null,
        user_id: '00000000-0000-0000-0000-000000000002'
      }
    ]
  )

  client.setQueryData(['guild-token-availability', GUILD_CODE, SEASON_NUMBER], {
    players: [
      {
        player_id: 'player-1',
        tokens_available: 3,
        token_cooldown: '00:10:00',
        next_token_seconds: 600
      },
      {
        player_id: 'player-2',
        tokens_available: 1,
        token_cooldown: '00:30:00',
        next_token_seconds: 1800
      }
    ]
  })

  client.setQueryData(['season-data', 'global', 'current'], {
    success: true,
    seasonNumber: 99,
    configId: 'cfg-99',
    bosses: [
      {
        boss_type: 'AvatarOfKhaine',
        boss_name: 'Avatar of Khaine',
        set: 0,
        encounter_id: 0,
        rarity: 'Legendary'
      },
      {
        boss_type: 'HiveTyrant',
        boss_name: 'Hive Tyrant',
        set: 1,
        encounter_id: 0,
        rarity: 'Legendary'
      }
    ],
    levels: ['L1', 'L2'],
    resolvedAt: '2025-12-22T12:00:00Z'
  })

  client.setQueryData(['season-data', 'global', 'upcoming'], {
    success: true,
    seasonNumber: 99,
    currentConfigId: 'cfg-99',
    nextConfigId: 'cfg-100',
    bosses: [
      {
        boss_type: 'HiveTyrant',
        boss_name: 'Hive Tyrant',
        set: 0,
        encounter_id: 0,
        rarity: 'Legendary'
      }
    ],
    levels: ['L1'],
    resolvedAt: '2025-12-22T12:00:00Z'
  })

  return client
}

const resolveStatus = (
  mode: PreviewMode,
  isLoading: boolean,
  error: Error | null
): HookStatus => {
  if (mode === 'loading') {
    return { status: 'Loading', error: null }
  }
  if (mode === 'error') {
    return { status: 'Error', error: new Error('Demo error state') }
  }
  if (error) {
    return { status: 'Error', error }
  }
  if (isLoading) {
    return { status: 'Loading', error: null }
  }
  return { status: 'Ready', error: null }
}

const statusStyles: Record<HookStatus['status'], string> = {
  Loading: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  Error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  Ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
}

const HookCard = ({
  title,
  status,
  description
}: {
  title: string
  status: HookStatus
  description: string
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 shadow-lg">
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-slate-100">{title}</div>
      <span
        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyles[status.status]}`}
      >
        {status.status}
      </span>
    </div>
    <div className="mt-2 text-xs text-slate-400">{description}</div>
    {status.error && (
      <div className="mt-2 text-xs text-rose-200">{status.error.message}</div>
    )}
  </div>
)

const SharedHooksPreview = ({ mode }: { mode: PreviewMode }) => {
  const bossData = useBossData()
  const seasonData = useSeasonData()
  const rosterData = usePlayerRoster()
  const membersData = useGuildMembers({
    guildCode: GUILD_CODE,
    includeTokens: true,
    activeOnly: true,
    seasonNumber: SEASON_NUMBER
  })
  const guildConfig = useGuildConfig(GUILD_CODE)

  const bossStatus = resolveStatus(mode, bossData.isLoading, bossData.error)
  const seasonStatus = resolveStatus(
    mode,
    seasonData.isLoading,
    seasonData.error
  )
  const rosterStatus = resolveStatus(
    mode,
    rosterData.isLoading,
    rosterData.error
  )
  const memberStatus = resolveStatus(
    mode,
    membersData.isLoading,
    membersData.error
  )
  const configStatus = resolveStatus(
    mode,
    guildConfig.isLoading,
    guildConfig.error
  )

  const bossSample = bossData.bosses[0]?.displayName || 'n/a'
  const seasonLabel = seasonData.currentSeason?.seasonNumber ?? 'n/a'

  return (
    <div className="w-full max-w-4xl space-y-4">
      <HookCard
        title="useBossData"
        status={bossStatus}
        description={`Bosses: ${bossData.bosses.length} | Sample: ${bossSample}`}
      />
      <HookCard
        title="useSeasonData"
        status={seasonStatus}
        description={`Current season: ${seasonLabel} | Progress: ${(seasonData.seasonProgress * 100).toFixed(0)}%`}
      />
      <HookCard
        title="usePlayerRoster"
        status={rosterStatus}
        description={`Heroes: ${rosterData.heroes.length} | MOW: ${rosterData.machinesOfWar.length}`}
      />
      <HookCard
        title="useGuildMembers"
        status={memberStatus}
        description={`Members: ${membersData.members.length} | Tokens: ${membersData.members.filter((member) => member.tokensAvailable !== null).length}`}
      />
      <HookCard
        title="useGuildConfig"
        status={configStatus}
        description={`Primary tokens: ${guildConfig.data?.primary_assignment_tokens ?? 'n/a'} | Secondary tokens: ${guildConfig.data?.secondary_assignment_tokens ?? 'n/a'}`}
      />
    </div>
  )
}

const meta: Meta<typeof SharedHooksPreview> = {
  title: 'UI/Foundations/Shared Hooks',
  component: SharedHooksPreview,
  args: {
    mode: 'loaded'
  },
  argTypes: {
    mode: {
      control: 'radio',
      options: ['loaded', 'loading', 'error']
    }
  }
}

export default meta

type Story = StoryObj<typeof SharedHooksPreview>

const renderPreview = (args: { mode: PreviewMode }) => {
  const client = buildQueryClient()
  return (
    <QueryClientProvider client={client}>
      <SharedHooksPreview mode={args.mode} />
    </QueryClientProvider>
  )
}

export const Loaded: Story = {
  args: { mode: 'loaded' },
  render: renderPreview
}

export const Loading: Story = {
  args: { mode: 'loading' },
  render: renderPreview
}

export const ErrorState: Story = {
  args: { mode: 'error' },
  render: renderPreview
}
