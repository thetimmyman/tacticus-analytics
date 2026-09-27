import { YouTubeIcon } from '@/app/components/icons/YouTubeIcon'
import { TikTokIcon } from '@/app/components/icons/TikTokIcon'
import { GoogleSheetsIcon } from '@/app/components/icons/GoogleSheetsIcon'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import { GitHubIcon } from '@/app/components/icons/GitHubIcon'
import { Film, Globe, MessageCircle } from 'lucide-react'

type LinkType =
  | 'youtube'
  | 'tiktok'
  | 'sheets'
  | 'sheets2'
  | 'website'
  | 'github'
  | 'reddit'
  | 'discord'

type ResourceLink = {
  type: LinkType
  url: string
  label?: string
}

type ResourceEntry = {
  name: string
  description: string
  links: ResourceLink[]
}

const LINK_BUTTON_CLASS: Record<LinkType, string> = {
  youtube:
    'bg-gradient-to-r from-red-600 to-red-500 hover:brightness-110 border-red-500/50',
  tiktok:
    'bg-gradient-to-r from-[var(--bg-from)] to-[var(--bg-to)] hover:brightness-110 border-[var(--card-border)]',
  sheets:
    'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 border-green-500/50',
  sheets2:
    'bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 border-green-500/50',
  website:
    'bg-gradient-to-r from-[var(--primary)] to-blue-500 hover:from-blue-500 hover:to-blue-400 border-blue-500/50',
  github:
    'bg-gradient-to-r from-[var(--card-bg)] to-[var(--bg-via)] hover:brightness-110 border-[var(--card-border)]',
  reddit:
    'bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-400 border-orange-500/50',
  discord:
    'bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 border-indigo-500/50'
}

const LINK_DEFAULT_LABEL: Record<LinkType, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  sheets: 'T.A.C.T.I.U.S',
  sheets2: 'Planner',
  website: 'Website',
  github: 'GitHub',
  reddit: 'Reddit',
  discord: 'Discord'
}

function LinkIcon({ type }: { type: LinkType }) {
  switch (type) {
    case 'youtube':
      return <YouTubeIcon className="w-4 h-4 mr-2" />
    case 'tiktok':
      return <TikTokIcon className="w-4 h-4 mr-2" />
    case 'sheets':
    case 'sheets2':
      return <GoogleSheetsIcon className="w-4 h-4 mr-2" />
    case 'website':
      return <Globe className="w-4 h-4 mr-2" />
    case 'github':
      return <GitHubIcon className="w-4 h-4 mr-2" />
    case 'reddit':
      return <MessageCircle className="w-4 h-4 mr-2" />
    case 'discord':
      return <DiscordIcon className="w-4 h-4 mr-2" />
  }
}

function ResourceLinkButton({ link }: { link: ResourceLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center px-4 py-2 ${LINK_BUTTON_CLASS[link.type]} text-[var(--text-primary)] text-sm font-bold rounded-lg transition-all duration-200 border`}
    >
      <LinkIcon type={link.type} />
      {link.label ?? LINK_DEFAULT_LABEL[link.type]}
    </a>
  )
}

function ResourceGrid({ entries }: { entries: ResourceEntry[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {entries.map((entry) => (
        <div
          key={entry.name}
          className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 backdrop-blur-sm rounded-lg border border-[var(--card-border)] p-6 hover:border-red-500/50 transition-all duration-200"
        >
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 overflow-hidden bg-gradient-to-br from-red-500 to-red-700 border border-red-500/30">
              <Film className="h-7 w-7 text-[var(--text-primary)]" />
            </div>
            <h3 className="text-lg font-semibold text-red-400 mb-2 tracking-wide">
              {entry.name}
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {entry.description}
            </p>
            <div className="flex flex-col space-y-2">
              {entry.links.map((link) => (
                <ResourceLinkButton key={link.url} link={link} />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ContentCreators() {
  const officialResources: ResourceEntry[] = [
    {
      name: 'TACTICUS GAME',
      description: 'Official game website',
      links: [
        {
          type: 'website',
          url: 'https://tacticusgame.com/',
          label: 'Official Site'
        }
      ]
    },
    {
      name: 'TACTICUS STORE',
      description: 'Official merchandise and rewards hub',
      links: [
        {
          type: 'website',
          url: 'https://hub.tacticusgame.com/',
          label: 'Store'
        }
      ]
    },
    {
      name: 'TACTICUS DISCORD',
      description: 'Official community Discord server',
      links: [
        {
          type: 'discord',
          url: 'https://discord.com/invite/tacticus-874393406531596419'
        }
      ]
    }
  ]

  const clusterCreators: ResourceEntry[] = [
    {
      name: 'NANDI',
      description: 'Tacticus content creator and strategy expert',
      links: [{ type: 'youtube', url: 'https://www.youtube.com/@Nandi40k' }]
    },
    {
      name: 'THECORPSEEMPEROR',
      description: 'Guild raid specialist and tactical analysis',
      links: [
        {
          type: 'youtube',
          url: 'https://www.youtube.com/@TheCorpseEmperor40k'
        },
        { type: 'tiktok', url: 'https://www.tiktok.com/@thecorpseemperor' }
      ]
    },
    {
      name: 'TOWEN',
      description: 'Battle strategies and unit optimization',
      links: [
        {
          type: 'sheets',
          url: 'https://docs.google.com/spreadsheets/d/1al2IWwvTP3QOhHtfr6P8stdlA48ED4JFrtK8wDKznrk/edit?gid=1786019917'
        }
      ]
    },
    {
      name: 'TABLETHETABLE',
      description: 'Tacticus guides and tier lists',
      links: [
        {
          type: 'website',
          url: 'https://www.tacticustable.com/',
          label: 'Tacticus Table'
        }
      ]
    }
  ]

  const communityCreators: ResourceEntry[] = [
    {
      name: 'HOMINA',
      description: 'Discord bot for guild management and analytics',
      links: [
        {
          type: 'github',
          url: 'https://github.com/sigubrat/Homina'
        }
      ]
    },
    {
      name: 'TACTICUS PLANNER',
      description: 'Planning and roster optimization tools',
      links: [
        {
          type: 'website',
          url: 'https://tacticusplanner.app/',
          label: 'Tacticus Planner'
        }
      ]
    },
    {
      name: 'TERMINUS MAXIMUS',
      description: 'Tacticus tools, analysis, and guild raid infographics',
      links: [
        {
          type: 'website',
          url: 'https://terminusmaximus.com'
        },
        {
          type: 'reddit',
          url: 'https://www.reddit.com/user/Terminus_Maximus/submitted/'
        }
      ]
    },
    {
      name: 'DBPREACHER',
      description: 'Tacticus gameplay videos and tutorials',
      links: [
        {
          type: 'youtube',
          url: 'https://www.youtube.com/channel/UCH1LnWpEBQkT8zIYIeKazlw'
        },
        {
          type: 'sheets2',
          url: 'https://docs.google.com/spreadsheets/d/1YKUtgG4TNCNmhSZQaZ_aEXS3EzCfXzPW_V0w7zld6Dw/edit?gid=1809623018#gid=1809623018'
        }
      ]
    },
    {
      name: 'TACTIFUCHS',
      description: 'Mostly analyzing in game economics and characters',
      links: [
        {
          type: 'youtube',
          url: 'https://youtube.com/@tactifuchs?si=a_ST3RSDc3KCHXKN'
        }
      ]
    },
    {
      name: 'TACTICUS CODEX',
      description: 'Game database and reference',
      links: [
        {
          type: 'website',
          url: 'https://www.tacticuscodex.com/'
        }
      ]
    },
    {
      name: 'TACTICUS WIKI',
      description: 'Community-driven wiki and game guides',
      links: [
        {
          type: 'website',
          url: 'https://tacticus.wiki.gg/'
        }
      ]
    },
    {
      name: 'TACTICUS DB',
      description: 'Community database for Tacticus stats and references',
      links: [
        {
          type: 'website',
          url: 'https://tacticusdb.com/'
        }
      ]
    },
    {
      name: 'AHRIMAN',
      description: 'Roster and raid planning companion',
      links: [
        {
          type: 'website',
          url: 'https://ahriman.app'
        }
      ]
    },
    {
      name: 'RAIDMAN REPLAYS',
      description: 'Guild raid replay browser',
      links: [
        {
          type: 'website',
          url: 'https://tacticus-raidman.com'
        }
      ]
    },
    {
      name: 'SIMULATOR',
      description: 'Tacticus battle simulator',
      links: [
        {
          type: 'website',
          url: 'https://tacticussim.com/'
        }
      ]
    },
    {
      name: 'GW TILE MAPPING',
      description:
        'Interactive map tool for Guild War tile planning and layouts',
      links: [
        {
          type: 'website',
          url: 'https://lpzie2.github.io/tacticus-gw-tile-mapping/',
          label: 'Tile Map'
        }
      ]
    },
    {
      name: 'GW TOKEN CHECKER',
      description:
        'Quickly track and verify Guild War token usage and player counts',
      links: [
        {
          type: 'website',
          url: 'https://lpzie2.github.io/tacticus-gw-token-checker/',
          label: 'Token Checker'
        }
      ]
    },
    {
      name: 'PAINHAWK',
      description:
        'Guild raid replays, mythic quest walkthroughs, and game mechanics breakdowns',
      links: [{ type: 'youtube', url: 'https://www.youtube.com/@Painhawk' }]
    },
    {
      name: 'CPUNERD',
      description: 'Tacticus Planner guides and tutorials',
      links: [{ type: 'youtube', url: 'https://www.youtube.com/@cpunerd-ch' }]
    },
    {
      name: 'DEADMYTH GAMING',
      description: 'Tacticus content creator',
      links: [
        {
          type: 'youtube',
          url: 'https://www.youtube.com/@DeadMyth-Gaming'
        }
      ]
    },
    {
      name: 'NOX TEMPEST',
      description: 'Tacticus content creator',
      links: [{ type: 'youtube', url: 'https://www.youtube.com/@noxtempest' }]
    },
    {
      name: 'LORD KRAETOR',
      description: 'Tacticus content creator',
      links: [{ type: 'youtube', url: 'https://www.youtube.com/@LordKraetor' }]
    },
    {
      name: 'LORD BUZZKILLINGTON',
      description: 'Tacticus content creator',
      links: [
        {
          type: 'youtube',
          url: 'https://www.youtube.com/@LordBuzzKillington'
        }
      ]
    },
    {
      name: 'NELSHIRAI',
      description: 'Tacticus content creator (Spanish-language)',
      links: [
        {
          type: 'youtube',
          url: 'https://www.youtube.com/@nelshirai-jw8wj'
        }
      ]
    }
  ]

  return (
    <div>
      <div className="mb-8">
        <div className="text-center mb-6">
          <h3 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] mb-2 tracking-wide">
            OFFICIAL RESOURCES
          </h3>
          <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent mx-auto"></div>
        </div>
        <ResourceGrid entries={officialResources} />
      </div>

      <ResourceGrid entries={clusterCreators} />

      {/* Non-Cluster Community Creators */}
      <div className="mt-8">
        <div className="text-center mb-6">
          <h3 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] mb-2 tracking-wide">
            COMMUNITY TOOLS & RESOURCES
          </h3>
          <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-red-500 to-transparent mx-auto"></div>
        </div>

        <ResourceGrid entries={communityCreators} />
      </div>
    </div>
  )
}
