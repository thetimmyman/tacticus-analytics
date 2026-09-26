import type { GuildTheme } from './types'

export const guildThemes2: Record<string, GuildTheme> = {
  WE: {
    name: 'World Eaters',
    primary: '#dc2626',
    secondary: '#7f1d1d',
    accent: '#fbbf24',
    background: {
      from: '#450a0a',
      via: '#991b1b',
      to: '#450a0a'
    },
    cardBg: 'rgba(220, 38, 38, 0.3)',
    cardBorder: 'rgba(220, 38, 38, 0.4)',
    text: {
      primary: '#ef4444',
      secondary: '#f87171',
      accent: '#fbbf24'
    },
    heraldry: '⚔️',
    motto: 'Blood for the Blood God!',
    pattern: 'skulls',
    // Red-text collapse on dark-red cardBg.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  DG: {
    name: 'Death Guard',
    primary: '#84cc16',
    secondary: '#365314',
    accent: '#a3a3a3',
    background: {
      from: '#1a2e05',
      via: '#365314',
      to: '#1a2e05'
    },
    cardBg: 'rgba(132, 204, 22, 0.2)',
    cardBorder: 'rgba(132, 204, 22, 0.3)',
    text: {
      primary: '#a3e635',
      secondary: '#bef264',
      accent: '#a3a3a3'
    },
    heraldry: '☠️',
    motto: "Papa Nurgle's Gift",
    pattern: 'plague'
  },

  NL: {
    name: 'Night Lords',
    primary: '#1e3a8a',
    secondary: '#1e1b4b',
    accent: '#fbbf24',
    background: {
      from: '#0c1139',
      via: '#1e1b4b',
      to: '#0c1139'
    },
    cardBg: 'rgba(30, 58, 138, 0.2)',
    cardBorder: 'rgba(30, 58, 138, 0.3)',
    text: {
      primary: '#3b82f6',
      secondary: '#60a5fa',
      accent: '#fbbf24'
    },
    heraldry: '🦇',
    motto: 'Ave Dominus Nox',
    pattern: 'lightning'
  },

  WB: {
    name: 'Word Bearers',
    primary: '#dc2626',
    secondary: '#450a0a',
    accent: '#a3a3a3',
    background: {
      from: '#450a0a',
      via: '#7f1d1d',
      to: '#450a0a'
    },
    cardBg: 'rgba(220, 38, 38, 0.2)',
    cardBorder: 'rgba(220, 38, 38, 0.3)',
    text: {
      primary: '#ef4444',
      secondary: '#f87171',
      accent: '#a3a3a3'
    },
    heraldry: '📜',
    motto: 'The Emperor was False',
    pattern: 'scripture'
  },

  IH_LOYALIST: {
    name: 'Iron Hands',
    primary: '#1f2937',
    secondary: '#111827',
    accent: '#f3f4f6',
    background: {
      from: '#030712',
      via: '#1f2937',
      to: '#030712'
    },
    cardBg: 'rgba(31, 41, 55, 0.3)',
    cardBorder: 'rgba(31, 41, 55, 0.4)',
    text: {
      primary: '#d1d5db',
      secondary: '#9ca3af',
      accent: '#f3f4f6'
    },
    heraldry: '⚙️',
    motto: 'The Flesh is Weak',
    pattern: 'mechanical',
    // Gray secondary text faded on dark bg.
    semanticOverrides: {
      textSecondary: '#d1d5db'
    }
  },

  CF: {
    name: 'Crimson Fists',
    primary: '#1e40af',
    secondary: '#1e3a8a',
    accent: '#dc2626',
    background: {
      from: '#0c2340',
      via: '#1e3a8a',
      to: '#0c2340'
    },
    cardBg: 'rgba(30, 64, 175, 0.2)',
    cardBorder: 'rgba(30, 64, 175, 0.3)',
    text: {
      primary: '#3b82f6',
      secondary: '#60a5fa',
      accent: '#dc2626'
    },
    heraldry: '✊',
    motto: 'No Pity! No Remorse! No Fear!',
    pattern: 'fists'
  },

  BT: {
    name: 'Black Templars',
    primary: '#111827',
    secondary: '#1f2937',
    accent: '#f3f4f6',
    background: {
      from: '#030712',
      via: '#111827',
      to: '#030712'
    },
    cardBg: 'rgba(17, 24, 39, 0.3)',
    cardBorder: 'rgba(17, 24, 39, 0.4)',
    text: {
      primary: '#f9fafb',
      secondary: '#f3f4f6',
      accent: '#dc2626'
    },
    // Red-600 accent and dimmer secondary keep hierarchy against near-white body text.
    semanticOverrides: {
      accent: '#dc2626',
      textSecondary: '#9ca3af'
    },
    heraldry: '⚔️',
    motto: 'No Pity! No Remorse! No Fear!',
    pattern: 'crosses'
  },

  GREY_KNIGHTS: {
    name: 'Grey Knights',
    primary: '#C0C0C0',
    secondary: '#4169E1',
    accent: '#FFD700',
    background: {
      from: '#1a1a2e',
      via: '#16213e',
      to: '#0f0e17'
    },
    cardBg: 'rgba(192, 192, 192, 0.1)',
    cardBorder: 'rgba(65, 105, 225, 0.3)',
    text: {
      primary: '#C0C0C0',
      secondary: '#87CEEB',
      accent: '#FFD700'
    },
    heraldry: '⚔️',
    motto: 'Daemon Hunters',
    pattern: 'psychic'
  },

  DEATHWATCH: {
    name: 'Deathwatch',
    primary: '#C0C0C0',
    secondary: '#000000',
    accent: '#DC143C',
    background: {
      from: '#000000',
      via: '#1a1a1a',
      to: '#000000'
    },
    cardBg: 'rgba(192, 192, 192, 0.1)',
    cardBorder: 'rgba(192, 192, 192, 0.3)',
    text: {
      primary: '#C0C0C0',
      secondary: '#808080',
      accent: '#DC143C'
    },
    heraldry: '🛡️',
    motto: 'Suffer Not the Alien',
    pattern: 'xenos-hunter'
  },

  LAMENTERS: {
    name: 'Lamenters',
    primary: '#FFD700',
    secondary: '#000000',
    accent: '#8B0000',
    background: {
      from: '#1a1a00',
      via: '#2a2a00',
      to: '#1a1a00'
    },
    cardBg: 'rgba(255, 215, 0, 0.1)',
    cardBorder: 'rgba(255, 215, 0, 0.3)',
    text: {
      primary: '#FFD700',
      secondary: '#FFA500',
      accent: '#DC143C'
    },
    heraldry: '😢',
    motto: 'For Those We Cherish',
    pattern: 'checkerboard',
    // Dark-red accent is invisible on the gold cardBg; use gold.
    semanticOverrides: {
      accent: '#FFD700'
    }
  },

  ORKS: {
    name: 'Ork Waaagh!',
    primary: '#16a34a',
    secondary: '#15803d',
    accent: '#fbbf24',
    background: {
      from: '#052e16',
      via: '#166534',
      to: '#052e16'
    },
    cardBg: 'rgba(22, 163, 74, 0.2)',
    cardBorder: 'rgba(22, 163, 74, 0.3)',
    text: {
      primary: '#22c55e',
      secondary: '#4ade80',
      accent: '#fbbf24'
    },
    heraldry: '💚',
    motto: 'WAAAGH!',
    pattern: 'crude'
  },

  ELDAR: {
    name: 'Asuryani Craftworlds',
    primary: '#3b82f6',
    secondary: '#1e40af',
    accent: '#fbbf24',
    background: {
      from: '#0c2340',
      via: '#1e40af',
      to: '#0c2340'
    },
    cardBg: 'rgba(59, 130, 246, 0.2)',
    cardBorder: 'rgba(59, 130, 246, 0.3)',
    text: {
      primary: '#60a5fa',
      secondary: '#93c5fd',
      accent: '#fbbf24'
    },
    heraldry: '🔮',
    motto: 'For Isha and Khaine',
    pattern: 'runes'
  },

  TYRANIDS: {
    name: 'Tyranid Hive Fleets',
    primary: '#7c2d12',
    secondary: '#451a03',
    accent: '#dc2626',
    background: {
      from: '#1c0a00',
      via: '#451a03',
      to: '#1c0a00'
    },
    cardBg: 'rgba(124, 45, 18, 0.2)',
    cardBorder: 'rgba(124, 45, 18, 0.3)',
    text: {
      primary: '#ea580c',
      secondary: '#fb923c',
      accent: '#dc2626'
    },
    heraldry: '🦠',
    motto: 'The Great Devourer',
    pattern: 'organic'
  },

  CADIA: {
    name: 'Cadian Shock Troops',
    primary: '#7c2d12',
    secondary: '#451a03',
    accent: '#fbbf24',
    background: {
      from: '#1c0a00',
      via: '#451a03',
      to: '#1c0a00'
    },
    cardBg: 'rgba(124, 45, 18, 0.2)',
    cardBorder: 'rgba(124, 45, 18, 0.3)',
    text: {
      primary: '#ea580c',
      secondary: '#fb923c',
      accent: '#fbbf24'
    },
    heraldry: '🎖️',
    motto: 'Cadia Stands!',
    pattern: 'military'
  },

  CATACHAN: {
    name: 'Catachan Jungle Fighters',
    primary: '#16a34a',
    secondary: '#15803d',
    accent: '#7c2d12',
    background: {
      from: '#052e16',
      via: '#166534',
      to: '#052e16'
    },
    cardBg: 'rgba(22, 163, 74, 0.2)',
    cardBorder: 'rgba(22, 163, 74, 0.3)',
    text: {
      primary: '#22c55e',
      secondary: '#4ade80',
      accent: '#7c2d12'
    },
    heraldry: '🌿',
    motto: 'Born to Fight',
    pattern: 'jungle',
    // Brown accent invisible on green cardBg.
    semanticOverrides: {
      accent: '#FFFFFF'
    }
  },

  MECHANICUS: {
    name: 'Adeptus Mechanicus',
    primary: '#dc2626',
    secondary: '#7f1d1d',
    accent: '#fbbf24',
    background: {
      from: '#450a0a',
      via: '#7f1d1d',
      to: '#450a0a'
    },
    cardBg: 'rgba(220, 38, 38, 0.2)',
    cardBorder: 'rgba(220, 38, 38, 0.3)',
    text: {
      primary: '#ef4444',
      secondary: '#f87171',
      accent: '#fbbf24'
    },
    heraldry: '⚙️',
    motto: 'Praise the Omnissiah',
    pattern: 'binary',
    // Brighter textSecondary breaks red-on-red collapse on the dark-red cardBg.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  INQUISITION: {
    name: 'Imperial Inquisition',
    primary: '#1f2937',
    secondary: '#111827',
    accent: '#dc2626',
    background: {
      from: '#030712',
      via: '#1f2937',
      to: '#030712'
    },
    cardBg: 'rgba(31, 41, 55, 0.3)',
    cardBorder: 'rgba(31, 41, 55, 0.4)',
    text: {
      primary: '#d1d5db',
      secondary: '#9ca3af',
      accent: '#dc2626'
    },
    heraldry: '👁️',
    motto: 'Innocence Proves Nothing',
    pattern: 'inquisition',
    // Dark-red accent + faded gray secondary text on dark bg — bump both.
    semanticOverrides: {
      accent: '#ff6b6b',
      textSecondary: '#d1d5db'
    }
  },

  SISTERS: {
    name: 'Adepta Sororitas',
    primary: '#1f2937',
    secondary: '#450a0a',
    accent: '#fbbf24',
    background: {
      from: '#030712',
      via: '#450a0a',
      to: '#030712'
    },
    cardBg: 'rgba(31, 41, 55, 0.3)',
    cardBorder: 'rgba(31, 41, 55, 0.4)',
    text: {
      primary: '#dc2626',
      secondary: '#ef4444',
      accent: '#fbbf24'
    },
    heraldry: '🔥',
    motto: 'Faith is my Shield',
    pattern: 'fleur',
    // Text and danger share one red family; primary and secondary are pulled apart.
    semanticOverrides: {
      textPrimary: '#fef2f2',
      textSecondary: '#fda4af'
    }
  },

  CUSTODES: {
    name: 'Adeptus Custodes',
    primary: '#fbbf24',
    secondary: '#f59e0b',
    accent: '#dc2626',
    background: {
      from: '#451a03',
      via: '#78350f',
      to: '#451a03'
    },
    cardBg: 'rgba(251, 191, 36, 0.3)',
    cardBorder: 'rgba(251, 191, 36, 0.4)',
    text: {
      primary: '#fbbf24',
      secondary: '#fcd34d',
      accent: '#dc2626'
    },
    heraldry: '👑',
    motto: 'Only in Death',
    pattern: 'aquila'
  },

  NAVY: {
    name: 'Imperial Navy',
    primary: '#1e40af',
    secondary: '#1e3a8a',
    accent: '#fbbf24',
    background: {
      from: '#0c2340',
      via: '#1e3a8a',
      to: '#0c2340'
    },
    cardBg: 'rgba(30, 64, 175, 0.2)',
    cardBorder: 'rgba(30, 64, 175, 0.3)',
    text: {
      primary: '#3b82f6',
      secondary: '#60a5fa',
      accent: '#fbbf24'
    },
    heraldry: '⚓',
    motto: 'Rule the Void',
    pattern: 'nautical'
  },

  KNIGHTS: {
    name: 'Imperial Knights',
    primary: '#4b5563',
    secondary: '#374151',
    accent: '#dc2626',
    background: {
      from: '#111827',
      via: '#374151',
      to: '#111827'
    },
    cardBg: 'rgba(75, 85, 99, 0.2)',
    cardBorder: 'rgba(75, 85, 99, 0.3)',
    text: {
      primary: '#9ca3af',
      secondary: '#d1d5db',
      accent: '#dc2626'
    },
    heraldry: '🏰',
    motto: 'Honor Above All',
    pattern: 'heraldic'
  }
}
