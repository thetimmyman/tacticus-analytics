import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'
import containerQueries from '@tailwindcss/container-queries'
import debugScreens from 'tailwindcss-debug-screens'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './packages/ui-kit/src/**/*.{js,ts,jsx,tsx}'
  ],
  // Only used in HTML-string templates, which the JIT scanner may miss.
  safelist: [
    'hidden',
    'block',
    'md:hidden',
    'md:block',
    'space-y-2',
    'space-y-1',
    'space-y-0.5'
  ],
  theme: {
    extend: {
      // Channel-form tokens keep `bg-card/30` opacity; `bg-[var(--card-bg)]/30` silently drops it.
      colors: {
        card: 'rgb(var(--card-bg-rgb) / <alpha-value>)',
        'card-border': 'rgb(var(--card-border-rgb) / <alpha-value>)'
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))'
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.75rem' }] // 10px
      },
      animation: {
        'bounce-slow': 'bounce 3s infinite'
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)'
      },
      transitionTimingFunction: {
        default: 'var(--ease-default)',
        bounce: 'var(--ease-bounce)'
      }
    }
  },
  plugins: [
    typography,
    containerQueries,
    ...(process.env.NODE_ENV === 'development' ? [debugScreens] : [])
  ]
}
export default config
