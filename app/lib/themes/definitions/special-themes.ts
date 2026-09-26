import type { GuildTheme } from './types'

export const specialThemes: Record<string, GuildTheme> = {
  dark: {
    name: 'Dark Mode',
    primary: '#60a5fa',
    secondary: '#3b82f6',
    accent: '#93c5fd',
    background: {
      from: '#0f172a',
      via: '#1e293b',
      to: '#0f172a'
    },
    cardBg: 'rgba(30, 41, 59, 0.8)',
    cardBorder: 'rgba(71, 85, 105, 0.5)',
    text: {
      primary: '#f3f4f6',
      secondary: '#d1d5db',
      accent: '#60a5fa'
    }
  },

  light: {
    name: 'Light Mode',
    primary: '#1d4ed8',
    secondary: '#1e40af',
    accent: '#1d4ed8',
    background: {
      from: '#ffffff',
      via: '#f9fafb',
      to: '#f3f4f6'
    },
    cardBg: 'rgba(255, 255, 255, 0.9)',
    cardBorder: 'rgba(209, 213, 219, 1)',
    text: {
      primary: '#0f172a',
      secondary: '#475569',
      accent: '#1d4ed8'
    },
    // Lighter blues fade on white cardBg, so accent is blue-700 (~7.4:1).
    // Success and danger use 600-tier variants to clear WCAG AA on white.
    semanticOverrides: {
      accent: '#1d4ed8',
      success: '#15803d',
      danger: '#b91c1c',
      info: '#0369a1',
      warning: '#a16207'
    }
  },

  HORUS_HERESY: {
    name: 'Horus Heresy',
    primary: '#DC143C',
    secondary: '#FFD700',
    accent: '#FF6347',
    background: {
      from: '#1a0000',
      via: '#330000',
      to: '#1a0000'
    },
    cardBg: 'rgba(139, 0, 0, 0.3)',
    cardBorder: 'rgba(220, 20, 60, 0.5)',
    text: {
      primary: '#FFD700',
      secondary: '#FFA500',
      accent: '#FF6347'
    },
    heraldry: '⚔️',
    motto: 'Let the Galaxy Burn',
    pattern: 'chaos'
  },

  visitor: {
    name: 'Visitor',
    primary: '#60a5fa',
    secondary: '#3b82f6',
    accent: '#93c5fd',
    background: {
      from: '#0f172a',
      via: '#1e293b',
      to: '#0f172a'
    },
    cardBg: 'rgba(30, 41, 59, 0.8)',
    cardBorder: 'rgba(71, 85, 105, 0.5)',
    text: {
      primary: '#f3f4f6',
      secondary: '#d1d5db',
      accent: '#60a5fa'
    }
  },

  WINTER_WONDERLAND: {
    name: 'Winter Wonderland',
    primary: '#60a5fa',
    secondary: '#1e40af',
    accent: '#e0f2fe',
    background: {
      from: '#0c1929',
      via: '#1e3a5f',
      to: '#0c1929'
    },
    cardBg: 'rgba(96, 165, 250, 0.1)',
    cardBorder: 'rgba(147, 197, 253, 0.3)',
    text: {
      primary: '#f0f9ff',
      secondary: '#bae6fd',
      accent: '#7dd3fc'
    },
    heraldry: '❄️',
    motto: 'Let It Snow',
    pattern: 'snowflakes'
  },

  CHRISTMAS_HERESY: {
    name: 'Christmas Heresy',
    primary: '#dc2626',
    secondary: '#16a34a',
    accent: '#fbbf24',
    background: {
      from: '#1a0a0a',
      via: '#0a1a0a',
      to: '#1a0a0a'
    },
    cardBg: 'rgba(220, 38, 38, 0.15)',
    cardBorder: 'rgba(255, 215, 0, 0.4)',
    text: {
      primary: '#fef2f2',
      secondary: '#bbf7d0',
      accent: '#fbbf24'
    },
    heraldry: '🎄',
    motto: 'Peace on Terra, War on Xenos',
    pattern: 'holly'
  },

  FESTIVE_MECHANICUS: {
    name: 'Festive Mechanicus',
    primary: '#dc2626',
    secondary: '#16a34a',
    accent: '#fbbf24',
    background: {
      from: '#1a0505',
      via: '#051a05',
      to: '#1a0505'
    },
    cardBg: 'rgba(220, 38, 38, 0.2)',
    cardBorder: 'rgba(22, 163, 74, 0.4)',
    text: {
      primary: '#fecaca',
      secondary: '#bbf7d0',
      accent: '#fcd34d'
    },
    heraldry: '🎅',
    motto: 'Praise the Omnissiah of Gifts',
    pattern: 'binary-snow'
  }
}
