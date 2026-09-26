import { type ComponentType, type SVGProps } from 'react'
import {
  Trophy,
  Target,
  Zap,
  UserPlus,
  FileText,
  Terminal,
  Package,
  Calendar,
  Swords
} from 'lucide-react'

export interface WebhookConfig {
  id?: string
  webhook_type: string
  webhook_url: string
  enabled: boolean
  description?: string
  last_tested?: string
  guild_code?: string
  cluster_id?: string | null
  thread_id?: string | null
}
export interface RawWebhook {
  id?: string
  webhook_type: string
  webhook_url?: string | null
  enabled?: boolean
  description?: string
  last_tested?: string | null
  cluster_id?: string | null
  thread_id?: string | null
}
export interface WebhookCategory {
  title: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  webhooks: WebhookConfig[]
}

export const WEBHOOK_TYPES = {
  overall_leaderboard: {
    label: 'Overall Leaderboard',
    description: 'Cluster performance rankings',
    icon: Trophy,
    color: 'text-yellow-400',
    category: 'leaderboards',
    details: {
      trigger: 'Automatic scheduled update',
      frequency: 'Every hour on the hour (24/7 during raids)',
      action: 'Posts top 5 performers across all guilds with team compositions',
      example:
        '**Iron Warriors - Season 83**\n**Battle Damage Leaderboards**\n\n*Updates every hour with new high scores*\n\n**M1 - Mortarion**\n**1. 8,500,000** - PlayerOne\nTeam: Ragnar, Thaddeus, Incisus\n**2. 8,200,000** - PlayerTwo\nTeam: Celestine, Actus, Volk'
    }
  },
  boss_leaderboard: {
    label: 'Boss Leaderboards',
    description: 'Main boss performance rankings',
    icon: Target,
    color: 'text-red-400',
    category: 'leaderboards',
    details: {
      trigger: 'Automatic scheduled update',
      frequency: 'Every hour on the hour',
      action: 'Posts top performers for each Main boss (L1-L5, M1)',
      example:
        '**L1 - Ghazghkull Thraka**\n**1. 4,500,000** - PlayerOne\nTeam: Bellator, Thaddeus, Archimedes\n**2. 4,200,000** - PlayerTwo\nTeam: Ragnar, Incisus, Volk\n**3. 3,900,000** - PlayerThree\nTeam: Ulfar, Actus, Thaurissan\n4th **3,700,000** - PlayerFour\n5th **3,500,000** - PlayerFive'
    }
  },
  prime_leaderboard: {
    label: 'Prime Leaderboards',
    description: 'Prime boss performance rankings',
    icon: Zap,
    color: 'text-[var(--accent)]',
    category: 'leaderboards',
    details: {
      trigger: 'Automatic scheduled update',
      frequency: 'Every hour on the hour',
      action: 'Posts top performers for Prime bosses (left/right variants)',
      example:
        "**M1 - Avatar (Left)**\n**1. 6,200,000** - PlayerOne\nTeam: Abraxas, Njal, Isabella\n**2. 5,900,000** - PlayerTwo\nTeam: Yarrick, Makhotep, Rotbone\n**3. 5,500,000** - PlayerThree\nTeam: Sho'Syl, Celestine, Volk"
    }
  },
  new_member: {
    label: 'New Member Joined',
    description: 'Welcome notifications for new guild members',
    icon: UserPlus,
    color: 'text-[var(--accent)]',
    category: 'events',
    details: {
      trigger: 'When "Existing Members" signup form is submitted',
      frequency: 'Immediately upon member joining',
      action: 'Sends welcome message with member details',
      example:
        'New Member Joined!\n\n**Player Information:**\nIn-Game Name: BattleBrother\nTacticus ID: XYZ789\n\nGuild: Iron Warriors\nJoin Date: 1/16/2025\nAccount Status: Dashboard Access Granted\n\nWelcome to Iron Warriors, BattleBrother!'
    }
  },
  season_summary: {
    label: 'Season Summary',
    description: 'End-of-season totals and highlights',
    icon: FileText,
    color: 'text-[var(--accent)]',
    category: 'events',
    details: {
      trigger: 'Automatic detection when new season starts',
      frequency: 'Daily check at 2:00 AM UTC',
      action: 'Posts complete season statistics and top performers',
      example:
        'Season 83 Summary - Tacticus Analytics\n\nSeason 83 has ended! Here are the final statistics:\n\nTotal Damage: 1,234,567,890\nTotal Battles: 8,456\nActive Players: 142\nUnique Bosses: 36\nAvg Damage/Battle: 145,987\nTop Performer: PlayerOne\n45,678,901 total'
    }
  },
  herald: {
    label: 'Herald Announcer',
    description:
      'Announces boss-defeat and boss-availability events for Legendary/Mythic guild raids',
    icon: Swords,
    color: 'text-yellow-400',
    category: 'events',
    details: {
      trigger:
        'During the guild raid sync, when a battle row has remainingHp=0 and rarity=Legendary/Mythic — or when a new boss becomes available',
      frequency:
        'Real-time — every 15-min guild sync checks for new kills and availability transitions',
      action:
        'Posts a plain-text announcement with boss name, killer, tier, and set to the configured channel. Defeat alerts can be muted independently in guild settings.',
      example:
        '**Ghazghkull Thraka** has been defeated!\nSlain by **Roy** • Tier 5 • Set 2\n\n(Per-guild channel. Dedup protected — same kill never posts twice.)'
    }
  },
  daily_summary: {
    label: 'Daily Summary',
    description: 'Daily battle statistics and highlights',
    icon: Calendar,
    color: 'text-blue-400',
    category: 'events',
    details: {
      trigger: 'Automatic scheduled report',
      frequency: 'Every day at 2:00 AM UTC',
      action: "Posts previous day's battle statistics and top performances",
      example:
        'Daily Summary - Thursday, January 15, 2025\n\nBattle Statistics\nTotal Battles: 342\nTotal Damage: 45,678,901\nAverage Damage: 133,573\n\nParticipation\nActive Players: 89\nActive Guilds: 6\nUnique Bosses: 18\n\nMVP of the Day\nPlayerX\n2,834,567 total damage\n\nTop Battles:\n1. PlayerX (IW) - 850K vs Mortarion\n2. PlayerY (AL) - 750K vs Ghazghkull'
    }
  },
  technical_summary: {
    label: 'Technical Summaries',
    description: 'System health and function execution reports',
    icon: Terminal,
    color: 'text-emerald-400',
    category: 'technical',
    details: {
      trigger: 'After critical functions complete or error',
      frequency: 'Variable - triggered by system events',
      action: 'Reports function status, errors, and performance metrics',
      example:
        '**Sync Complete:** 42 updates, 128 skipped, 5 new\n\nOr if errors:\n\n**Sync Errors:**\n• No webhook configured for guild XYZ\n• Rate limit reached after 50 messages\n• Failed to send header for ABC'
    }
  },
  version_update: {
    label: 'Version Updates',
    description: 'Deployment and version change notifications',
    icon: Package,
    color: 'text-violet-400',
    category: 'technical',
    details: {
      trigger: 'Git pre-push hook during deployment',
      frequency: 'Each time code is deployed to production',
      action: 'Announces new version with changes',
      example:
        'Version 1.39.78 Deployed\n\nChanges:\n- feat: enhance webhook descriptions with detailed trigger info\n- fix: webhook persistence and Discord mentions\n- improve: add type safety and extract common styles\n\nEnvironment: Production\nAuthor: thetimmyman'
    }
  }
}

export type WebhookTypeDefinition =
  (typeof WEBHOOK_TYPES)[keyof typeof WEBHOOK_TYPES]
