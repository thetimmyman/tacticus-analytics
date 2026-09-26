import type { GuildTheme } from './types'

export const guildThemes1: Record<string, GuildTheme> = {
  IW: {
    name: 'Iron Warriors',
    primary: '#C0C0C0',
    secondary: '#696969',
    accent: '#FFD700',
    background: {
      from: '#232526',
      via: '#414345',
      to: '#232526'
    },
    cardBg: 'rgba(105, 105, 105, 0.2)',
    cardBorder: 'rgba(192, 192, 192, 0.3)',
    text: {
      primary: '#C0C0C0',
      secondary: '#A9A9A9',
      accent: '#FFD700'
    },
    heraldry: '⚙️',
    motto: 'Iron Within, Iron Without',
    pattern: 'hazard',
    palette: {
      brass: '#b5a56d',
      smoke: '#2b2b2b',
      blood: '#6c2e2e',
      fxPsychic: '#59c1ff',
      fxNurgle: '#88a347',
      fxNecron: '#7af77a',
      fxEldar: '#ffb357'
    },
    motifs: [
      'hazard chevrons',
      'iron skulls',
      'riveted plating',
      'smoke-choked trenches',
      'daemon engines'
    ],
    renderStyle:
      'grim, high-contrast, painterly comic panels, warm desaturated tones, heavy vignette, no text labels',
    camera:
      'dynamic angles, silhouettes readable against fog, frames with parallax space',
    post: {
      vignette: 0.35,
      grain: 0.18,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'warm'
    },
    overlays: {
      chevronUrl: '/overlays/chevrons.svg',
      logoUrl: '/logos/iron-skull.png'
    }
  },

  AL: {
    name: 'Alpha Legion',
    primary: '#00CED1',
    secondary: '#008B8B',
    accent: '#20B2AA',
    background: {
      from: '#0F2027',
      via: '#203A43',
      to: '#2C5364'
    },
    cardBg: 'rgba(0, 139, 139, 0.1)',
    cardBorder: 'rgba(0, 206, 209, 0.3)',
    text: {
      primary: '#00CED1',
      secondary: '#B0E0E6',
      accent: '#40E0D0'
    },
    heraldry: '🐍',
    motto: 'Hydra Dominatus',
    pattern: 'scales',
    palette: {
      smoke: '#1f2e31',
      blood: '#5f2f3e',
      fxPsychic: '#4ec8cf',
      fxNurgle: '#7b9b5b',
      fxNecron: '#6ef4cf',
      fxEldar: '#e7c77a'
    },
    motifs: [
      'serpentine sigils',
      'covert fog',
      'hydra glyphs',
      'scaled armor highlights'
    ],
    renderStyle:
      'covert, cold-contrast painterly comic panels, cyan-leaning grade, no text labels',
    camera:
      'oblique stealth angles, silhouette-first framing, dramatic backlight through smoke',
    post: {
      vignette: 0.28,
      grain: 0.14,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'cool'
    },
    overlays: { logoUrl: '/logos/alpha-legion.png' }
  },

  IH: {
    name: 'Iron Hydras',
    primary: '#2F4F4F',
    secondary: '#556B2F',
    accent: '#00CED1',
    background: {
      from: '#0f1419',
      via: '#1e3a1e',
      to: '#0f1419'
    },
    cardBg: 'rgba(47, 79, 79, 0.2)',
    cardBorder: 'rgba(47, 79, 79, 0.3)',
    text: {
      primary: '#708090',
      secondary: '#B0C4DE',
      accent: '#20B2AA'
    },
    heraldry: '🐍',
    motto: 'Hydra Eternal',
    pattern: 'hydra',
    palette: {
      smoke: '#203435',
      blood: '#5d3a34',
      fxPsychic: '#4bc4d1',
      fxNurgle: '#7ea35f',
      fxNecron: '#76e8bb',
      fxEldar: '#f0be78'
    },
    motifs: [
      'sea-scale plating',
      'mist-sheathed steel',
      'hydra crests',
      'wet sheen armor'
    ],
    renderStyle:
      'moody comic realism, sea-green shadows, metallic painterly finish, no text labels',
    camera:
      'low-angle hero shots, mist-separated layers, cinematic depth for motion passes',
    post: {
      vignette: 0.3,
      grain: 0.16,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'cool'
    }
  },

  DA: {
    name: 'Dark Angels',
    primary: '#006400',
    secondary: '#2F4F2F',
    accent: '#F5DEB3',
    background: {
      from: '#0F2027',
      via: '#1B3A1B',
      to: '#0F2027'
    },
    cardBg: 'rgba(0, 100, 0, 0.2)',
    cardBorder: 'rgba(0, 100, 0, 0.3)',
    text: {
      primary: '#228B22',
      secondary: '#90EE90',
      accent: '#F5DEB3'
    },
    heraldry: '⚔️',
    motto: 'Repent! For tomorrow you die!',
    pattern: 'gothic',
    palette: {
      smoke: '#1f2c1f',
      blood: '#6a2f2f',
      fxPsychic: '#53bbef',
      fxNurgle: '#88a85a',
      fxNecron: '#74f07b',
      fxEldar: '#f3be78'
    },
    motifs: [
      'cathedral arches',
      'winged sigils',
      'parchment banners',
      'gothic stone'
    ],
    renderStyle:
      'gothic comic realism, emerald shadows and parchment highlights, no text labels',
    camera:
      'cathedral-scale framing, dramatic vertical compositions, readable silhouettes',
    post: {
      vignette: 0.26,
      grain: 0.14,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'neutral'
    },
    overlays: { logoUrl: '/logos/dark-angels.png' }
  },

  RG: {
    name: 'Raven Guard',
    primary: '#1C1C1C',
    secondary: '#000000',
    accent: '#FFFFFF',
    background: {
      from: '#000000',
      via: '#2a2a2a',
      to: '#000000'
    },
    cardBg: 'rgba(28, 28, 28, 0.3)',
    cardBorder: 'rgba(255, 255, 255, 0.1)',
    text: {
      primary: '#FFFFFF',
      secondary: '#C0C0C0',
      accent: '#808080'
    },
    heraldry: '🦅',
    motto: 'Victorus aut Mortis',
    pattern: 'shadow',
    palette: {
      smoke: '#191919',
      blood: '#61313a',
      fxPsychic: '#5cb9ff',
      fxNurgle: '#7d9a58',
      fxNecron: '#6deea3',
      fxEldar: '#f1bc7b'
    },
    motifs: [
      'matte raven plate',
      'hard rain silhouettes',
      'storm shadows',
      'stealth iconography'
    ],
    renderStyle:
      'high-contrast noir comic panels, stark blacks with controlled white rim light, no text labels',
    camera:
      'aggressive diagonals, rain-cut depth, hero silhouettes isolated against haze',
    post: {
      vignette: 0.4,
      grain: 0.17,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'cool'
    }
    // background.via is lifted off pure black to soften gradient banding.
    // text.accent stays gray-on-black on purpose for guild-code styling.
  },

  HL: {
    name: 'The Heresy Lodge',
    primary: '#4B0082',
    secondary: '#2F1B69',
    accent: '#9370DB',
    background: {
      from: '#1a0933',
      via: '#2d1b4e',
      to: '#1a0933'
    },
    cardBg: 'rgba(75, 0, 130, 0.2)',
    cardBorder: 'rgba(75, 0, 130, 0.3)',
    text: {
      primary: '#9370DB',
      secondary: '#BA55D3',
      accent: '#DDA0DD'
    },
    heraldry: '🌙',
    motto: 'In Shadow We Trust',
    pattern: 'lodge',
    palette: {
      smoke: '#2a2035',
      blood: '#6b2d4a',
      fxPsychic: '#74b8ff',
      fxNurgle: '#839a56',
      fxNecron: '#79f0ad',
      fxEldar: '#f3bb80'
    },
    motifs: [
      'stained glass shards',
      'candle smoke',
      'lodge sigils',
      'ornate ritual geometry'
    ],
    renderStyle:
      'baroque grimdark comic art, mixed warm-cool contrast, ink-heavy painterly edges, no text labels',
    camera:
      'ritual-circle framing, dramatic profile silhouettes, layered foreground haze',
    post: {
      vignette: 0.34,
      grain: 0.18,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'neutral'
    }
  },

  TS: {
    name: 'Thousand Sons',
    primary: '#4169E1',
    secondary: '#191970',
    accent: '#FFD700',
    background: {
      from: '#0F0C29',
      via: '#302B63',
      to: '#24243e'
    },
    cardBg: 'rgba(65, 105, 225, 0.1)',
    cardBorder: 'rgba(65, 105, 225, 0.3)',
    text: {
      primary: '#4169E1',
      secondary: '#6495ED',
      accent: '#FFD700'
    },
    heraldry: '🔮',
    motto: 'All is Dust',
    pattern: 'runes',
    palette: {
      smoke: '#251f43',
      blood: '#6a2d3e',
      fxPsychic: '#5ad3ff',
      fxNurgle: '#8aa85b',
      fxNecron: '#7cf17d',
      fxEldar: '#f5b567'
    },
    motifs: [
      'arcane runes',
      'warpfire swirls',
      'ornate gold trim',
      'cyclopean iconography'
    ],
    renderStyle:
      'arcane painterly comic panels, crimson-gold contrast, radiant warp light, no text labels',
    camera:
      'spiraling compositions, sorcerous light cones, readable silhouettes in smoke',
    post: {
      vignette: 0.32,
      grain: 0.16,
      gutterPx: 4,
      cornerRadius: 16,
      gradeBias: 'warm'
    },
    overlays: { logoUrl: '/logos/thousand-sons.png' }
  },

  UM: {
    name: 'Ultramarines',
    primary: '#003a70',
    secondary: '#1e3a8a',
    accent: '#ffd700',
    background: {
      from: '#0c2340',
      via: '#1e3a8a',
      to: '#0c2340'
    },
    cardBg: 'rgba(0, 58, 112, 0.2)',
    cardBorder: 'rgba(0, 58, 112, 0.3)',
    text: {
      primary: '#60a5fa',
      secondary: '#93c5fd',
      accent: '#ffd700'
    },
    heraldry: '⚔️',
    motto: 'Courage and Honour!',
    pattern: 'roman'
  },

  BA: {
    name: 'Blood Angels',
    primary: '#dc2626',
    secondary: '#991b1b',
    accent: '#ffd700',
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
      accent: '#ffd700'
    },
    heraldry: '🩸',
    motto: 'For Sanguinius!',
    pattern: 'wings'
  },

  IF: {
    name: 'Imperial Fists',
    primary: '#fbbf24',
    secondary: '#f59e0b',
    accent: '#1f2937',
    background: {
      from: '#451a03',
      via: '#78350f',
      to: '#451a03'
    },
    cardBg: 'rgba(251, 191, 36, 0.2)',
    cardBorder: 'rgba(251, 191, 36, 0.3)',
    text: {
      primary: '#fbbf24',
      secondary: '#fcd34d',
      accent: '#1f2937'
    },
    // Accent is yellow-300 because dark gray is invisible on the brown background.
    semanticOverrides: {
      accent: '#fde047'
    },
    heraldry: '🏰',
    motto: 'Fortify!',
    pattern: 'fortress'
  },

  WS: {
    name: 'White Scars',
    primary: '#f3f4f6',
    secondary: '#e5e7eb',
    accent: '#dc2626',
    background: {
      from: '#111827',
      via: '#374151',
      to: '#111827'
    },
    cardBg: 'rgba(243, 244, 246, 0.1)',
    cardBorder: 'rgba(243, 244, 246, 0.2)',
    text: {
      primary: '#f9fafb',
      secondary: '#f3f4f6',
      accent: '#dc2626'
    },
    heraldry: '🐎',
    motto: 'For the Khan and the Emperor!',
    pattern: 'lightning'
  },

  SW: {
    name: 'Space Wolves',
    primary: '#6b7280',
    secondary: '#4b5563',
    accent: '#fbbf24',
    background: {
      from: '#1f2937',
      via: '#374151',
      to: '#1f2937'
    },
    cardBg: 'rgba(107, 114, 128, 0.2)',
    cardBorder: 'rgba(107, 114, 128, 0.3)',
    text: {
      primary: '#9ca3af',
      secondary: '#d1d5db',
      accent: '#fbbf24'
    },
    heraldry: '🐺',
    motto: 'For Russ and the Allfather!',
    pattern: 'wolves'
  },

  SA: {
    name: 'Salamanders',
    primary: '#16a34a',
    secondary: '#15803d',
    accent: '#f97316',
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
      accent: '#f97316'
    },
    heraldry: '🔥',
    motto: 'Into the fires of battle!',
    pattern: 'flames'
  },

  EC: {
    name: "Emperor's Children",
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
    motto: 'Children of the Emperor!',
    pattern: 'excess'
  }
}
