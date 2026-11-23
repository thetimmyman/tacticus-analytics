import { YouTubeIcon } from '@/app/components/icons/YouTubeIcon'
import { TikTokIcon } from '@/app/components/icons/TikTokIcon'
import { GoogleSheetsIcon } from '@/app/components/icons/GoogleSheetsIcon'
import { DiscordIcon } from '@/app/components/icons/DiscordIcon'
import { GitHubIcon } from '@/app/components/icons/GitHubIcon'
import { Film, Globe, MessageCircle } from 'lucide-react'

export type LinkType =
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

// Every style states its fill and its label together. Brand fills are dark
// tiers with a white label (4.5:1 or better at both stops, and on hover, where
// the fill darkens); the website style uses the theme's on-primary pair.
// Hover never brightens: the global link rule is switched off so a white label
// does not lose contrast on a lighter fill.
export const LINK_BUTTON_CLASS: Record<LinkType, string> = {
  youtube:
    'bg-linear-to-r from-red-700 to-red-600 hover:from-red-800 hover:to-red-700 border-red-500/50 text-white',
  tiktok:
    'bg-linear-to-r from-zinc-950 to-zinc-800 hover:from-black hover:to-zinc-900 border-zinc-600 text-white',
  sheets:
    'bg-linear-to-r from-green-800 to-green-700 hover:from-green-900 hover:to-green-800 border-green-600/50 text-white',
  sheets2:
    'bg-linear-to-r from-green-800 to-green-700 hover:from-green-900 hover:to-green-800 border-green-600/50 text-white',
  website:
    'bg-primary-wh40k hover:bg-accent-wh40k border-primary-wh40k hover:border-accent-wh40k text-on-primary-wh40k hover:text-on-accent-wh40k',
  github:
    'bg-linear-to-r from-slate-900 to-slate-700 hover:from-slate-950 hover:to-slate-800 border-slate-500 text-white',
  reddit:
    'bg-linear-to-r from-orange-800 to-orange-700 hover:from-orange-900 hover:to-orange-800 border-orange-600/50 text-white',
  discord:
    'bg-linear-to-r from-indigo-700 to-indigo-600 hover:from-indigo-800 hover:to-indigo-700 border-indigo-500/50 text-white'
}

// Focus: a white ring between two black bands, so it shows on dark and light
// cards and on any fill; hover lifts, and reduced motion keeps the button still.
// no-transition: the website style changes fill and label together on hover,
// and two fades toward opposite ends cross at about 1:1 mid-way.
const LINK_BUTTON_BASE =
  'inline-flex items-center justify-center px-4 py-2 text-sm font-bold rounded-lg border no-transition hover:filter-none hover:-translate-y-0.5 hover:shadow-lg motion-reduce:hover:translate-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-white focus-visible:shadow-[0_0_0_6px_black]'

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
      className={`${LINK_BUTTON_BASE} ${LINK_BUTTON_CLASS[link.type]}`}
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
          className="bg-(--card-bg) hover:bg-card/80 transition-colors duration-200 backdrop-blur-xs rounded-lg border border-(--card-border) p-6 hover:border-red-500/50 transition-all duration-200"
        >
          <div className="text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 overflow-hidden bg-linear-to-br from-red-500 to-red-700 border border-red-500/30">
              <Film className="h-7 w-7 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-primary-wh40k mb-2 tracking-wide">
              {entry.name}
            </h3>
            <p className="text-sm text-secondary-wh40k mb-4">
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
          <h3 className="text-xl md:text-2xl font-bold text-primary-wh40k mb-2 tracking-wide">
            OFFICIAL RESOURCES
          </h3>
          <div className="w-24 h-0.5 bg-linear-to-r from-transparent via-red-500 to-transparent mx-auto"></div>
        </div>
        <ResourceGrid entries={officialResources} />
      </div>

      <ResourceGrid entries={clusterCreators} />

      {/* Non-Cluster Community Creators */}
      <div className="mt-8">
        <div className="text-center mb-6">
          <h3 className="text-xl md:text-2xl font-bold text-primary-wh40k mb-2 tracking-wide">
            COMMUNITY TOOLS & RESOURCES
          </h3>
          <div className="w-24 h-0.5 bg-linear-to-r from-transparent via-red-500 to-transparent mx-auto"></div>
        </div>

        <ResourceGrid entries={communityCreators} />
      </div>
    </div>
  )
}
