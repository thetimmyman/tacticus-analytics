import type { GuildTheme } from './types'

export const guildThemes3: Record<string, GuildTheme> = {
  TITANS: {
    name: 'Collegia Titanica',
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
    heraldry: '🏭',
    motto: 'Walk with the Machine God',
    pattern: 'titans',
    // Red-text collapse on dark-red cardBg.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  NECRONS: {
    name: 'Necron Dynasties',
    primary: '#16a34a',
    secondary: '#15803d',
    accent: '#1f2937',
    background: {
      from: '#052e16',
      via: '#15803d',
      to: '#052e16'
    },
    cardBg: 'rgba(22, 163, 74, 0.2)',
    cardBorder: 'rgba(22, 163, 74, 0.3)',
    text: {
      primary: '#22c55e',
      secondary: '#4ade80',
      accent: '#fbbf24'
    },
    // Amber-gold accent because dark gray is invisible on the dark green background.
    semanticOverrides: {
      accent: '#fbbf24'
    },
    heraldry: '💀',
    motto: 'Death is Temporary',
    pattern: 'hieroglyphs'
  },

  TAU: {
    name: "T'au Empire",
    primary: '#f59e0b',
    secondary: '#d97706',
    accent: '#dc2626',
    background: {
      from: '#451a03',
      via: '#92400e',
      to: '#451a03'
    },
    cardBg: 'rgba(245, 158, 11, 0.2)',
    cardBorder: 'rgba(245, 158, 11, 0.3)',
    text: {
      primary: '#fb923c',
      secondary: '#fdba74',
      accent: '#dc2626'
    },
    heraldry: '🛸',
    motto: 'For the Greater Good',
    pattern: 'tech',
    // Red accent + warm orange cardBg = hue clash, white reads cleanly.
    semanticOverrides: {
      accent: '#FFFFFF'
    }
  },

  DELDAR: {
    name: 'Drukhari',
    primary: '#581c87',
    secondary: '#3730a3',
    accent: '#16a34a',
    background: {
      from: '#1e1065',
      via: '#581c87',
      to: '#1e1065'
    },
    cardBg: 'rgba(88, 28, 135, 0.2)',
    cardBorder: 'rgba(88, 28, 135, 0.3)',
    text: {
      primary: '#a855f7',
      secondary: '#c084fc',
      accent: '#22c55e'
    },
    heraldry: '🗡️',
    motto: 'Pain is Pleasure',
    pattern: 'spikes'
  },

  GENESTEALER: {
    name: 'Genestealer Cults',
    primary: '#7c2d12',
    secondary: '#92400e',
    accent: '#d946ef',
    background: {
      from: '#431407',
      via: '#7c2d12',
      to: '#431407'
    },
    cardBg: 'rgba(124, 45, 18, 0.2)',
    cardBorder: 'rgba(124, 45, 18, 0.3)',
    text: {
      primary: '#ea580c',
      secondary: '#fb923c',
      accent: '#d946ef'
    },
    heraldry: '🦄',
    motto: 'The Star Gods Call',
    pattern: 'cult'
  },

  CRAFTWORLD_ULTHWE: {
    name: 'Craftworld Ulthwé',
    primary: '#1f2937',
    secondary: '#111827',
    accent: '#fbbf24',
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
      accent: '#fbbf24'
    },
    heraldry: '🔮',
    motto: 'Foresight is Wisdom',
    pattern: 'psychic',
    // Gray secondary text faded on dark bg.
    semanticOverrides: {
      textSecondary: '#d1d5db'
    }
  },

  CRAFTWORLD_BIEL_TAN: {
    name: 'Craftworld Biel-Tan',
    primary: '#16a34a',
    secondary: '#15803d',
    accent: '#f3f4f6',
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
      accent: '#f3f4f6'
    },
    heraldry: '🌿',
    motto: 'The Swordwind Comes',
    pattern: 'leaf'
  },

  CRAFTWORLD_SAIM_HANN: {
    name: 'Craftworld Saim-Hann',
    primary: '#dc2626',
    secondary: '#991b1b',
    accent: '#f3f4f6',
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
      accent: '#f3f4f6'
    },
    heraldry: '🏍️',
    motto: 'Wild Riders',
    pattern: 'speed'
  },

  HARLEQUINS: {
    name: 'Harlequins',
    primary: '#d946ef',
    secondary: '#a21caf',
    accent: '#fbbf24',
    background: {
      from: '#581c87',
      via: '#7c3aed',
      to: '#581c87'
    },
    cardBg: 'rgba(217, 70, 239, 0.2)',
    cardBorder: 'rgba(217, 70, 239, 0.3)',
    text: {
      primary: '#e879f9',
      secondary: '#f0abfc',
      accent: '#fbbf24'
    },
    heraldry: '🎭',
    motto: 'Dance of Death',
    pattern: 'diamond'
  },

  VOTANN: {
    name: 'Leagues of Votann',
    primary: '#FF8C00',
    secondary: '#4682B4',
    accent: '#FFD700',
    background: {
      from: '#1a0f00',
      via: '#2a1a05',
      to: '#1a0f00'
    },
    cardBg: 'rgba(255, 140, 0, 0.1)',
    cardBorder: 'rgba(255, 140, 0, 0.3)',
    text: {
      primary: '#FF8C00',
      secondary: '#FFA500',
      accent: '#FFD700'
    },
    heraldry: '⚒️',
    motto: 'The Ancestors Endure',
    pattern: 'geometric'
  },

  CHAOS_DAEMONS: {
    name: 'Chaos Daemons',
    primary: '#dc2626',
    secondary: '#581c87',
    accent: '#16a34a',
    background: {
      from: '#450a0a',
      via: '#581c87',
      to: '#450a0a'
    },
    cardBg: 'rgba(220, 38, 38, 0.2)',
    cardBorder: 'rgba(220, 38, 38, 0.3)',
    text: {
      primary: '#ef4444',
      secondary: '#a855f7',
      accent: '#22c55e'
    },
    heraldry: '👹',
    motto: 'Embrace Chaos',
    pattern: 'chaos',
    // Purple secondary on dark-red cardBg = chromatic clash.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  KHORNE: {
    name: 'Khorne Daemons',
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

  TZEENTCH: {
    name: 'Tzeentch Daemons',
    primary: '#3b82f6',
    secondary: '#1e40af',
    accent: '#d946ef',
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
      accent: '#d946ef'
    },
    heraldry: '🔮',
    motto: 'Change is the Only Constant',
    pattern: 'mutation'
  },

  NURGLE: {
    name: 'Nurgle Daemons',
    primary: '#84cc16',
    secondary: '#365314',
    accent: '#7c2d12',
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
      accent: '#7c2d12'
    },
    heraldry: '☠️',
    motto: "Grandfather's Gifts",
    pattern: 'decay',
    // Brown accent invisible on green cardBg.
    semanticOverrides: {
      accent: '#FFFFFF'
    }
  },

  SLAANESH: {
    name: 'Slaanesh Daemons',
    primary: '#d946ef',
    secondary: '#a21caf',
    accent: '#fbbf24',
    background: {
      from: '#581c87',
      via: '#7c3aed',
      to: '#581c87'
    },
    cardBg: 'rgba(217, 70, 239, 0.2)',
    cardBorder: 'rgba(217, 70, 239, 0.3)',
    text: {
      primary: '#e879f9',
      secondary: '#f0abfc',
      accent: '#fbbf24'
    },
    heraldry: '🎭',
    motto: 'Perfection Through Excess',
    pattern: 'excess'
  },

  LEGION_DAMNED: {
    name: 'Legion of the Damned',
    primary: '#000000',
    secondary: '#FF4500',
    accent: '#FFFFFF',
    background: {
      from: '#000000',
      via: '#2a1a00',
      to: '#000000'
    },
    cardBg: 'rgba(255, 69, 0, 0.2)',
    cardBorder: 'rgba(255, 69, 0, 0.4)',
    text: {
      primary: '#FF4500',
      secondary: '#FF6347',
      accent: '#FFFFFF'
    },
    heraldry: '🔥',
    motto: 'In Dedicato Imperatum',
    pattern: 'flames',
    // Orange-red secondary faded on near-black bg.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  RENEGADES: {
    name: 'Chaos Renegades',
    primary: '#8B4513',
    secondary: '#800000',
    accent: '#FF4500',
    background: {
      from: '#1a0a00',
      via: '#2a1506',
      to: '#1a0a00'
    },
    cardBg: 'rgba(139, 69, 19, 0.2)',
    cardBorder: 'rgba(139, 69, 19, 0.3)',
    text: {
      primary: '#CD853F',
      secondary: '#DEB887',
      accent: '#FF4500'
    },
    heraldry: '☠️',
    motto: 'No Gods, No Masters',
    pattern: 'anarchist',
    // Tan secondary text low contrast on brown cardBg.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  DAEMON_HUNTERS: {
    name: 'Ordo Malleus',
    primary: '#DC143C',
    secondary: '#C0C0C0',
    accent: '#FFD700',
    background: {
      from: '#1a0000',
      via: '#2a0a0a',
      to: '#1a0000'
    },
    cardBg: 'rgba(220, 20, 60, 0.2)',
    cardBorder: 'rgba(220, 20, 60, 0.3)',
    text: {
      primary: '#DC143C',
      secondary: '#FF6B6B',
      accent: '#FFD700'
    },
    heraldry: '🔨',
    motto: 'Innocentia Nihil Probat',
    pattern: 'inquisition',
    // Red text fading on very-dark cardBg.
    semanticOverrides: {
      textSecondary: '#ffcccc'
    }
  },

  STEEL_LEGION: {
    name: 'Armageddon Steel Legion',
    primary: '#708090',
    secondary: '#2F4F4F',
    accent: '#FFD700',
    background: {
      from: '#0f0f0f',
      via: '#1a1a1a',
      to: '#0f0f0f'
    },
    cardBg: 'rgba(112, 128, 144, 0.1)',
    cardBorder: 'rgba(112, 128, 144, 0.3)',
    text: {
      primary: '#708090',
      secondary: '#A9A9A9',
      accent: '#FFD700'
    },
    heraldry: '⚙️',
    motto: 'Steel Within, Steel Without',
    pattern: 'industrial'
  },

  VALHALLAN: {
    name: 'Valhallan Ice Warriors',
    primary: '#4682B4',
    secondary: '#FFFFFF',
    accent: '#DC143C',
    background: {
      from: '#0a1929',
      via: '#1a2b3d',
      to: '#0a1929'
    },
    cardBg: 'rgba(70, 130, 180, 0.1)',
    cardBorder: 'rgba(70, 130, 180, 0.3)',
    text: {
      primary: '#87CEEB',
      secondary: '#B0C4DE',
      accent: '#FF6B6B'
    },
    heraldry: '❄️',
    motto: 'Ice and Iron',
    pattern: 'snowflake',
    // Red accent clashes with the cool blue cardBg.
    semanticOverrides: {
      accent: '#e0f2fe'
    }
  }
}
