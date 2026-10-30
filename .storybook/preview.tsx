import type { Preview } from '@storybook/react-vite'
import React from 'react'
import '../app/globals.css'
import { PublicThemeProvider } from '@/app/components/PublicThemeProvider'

const preview: Preview = {
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: '/home' }
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i
      }
    },
    backgrounds: {
      default: 'mechanicus-dark',
      values: [
        { name: 'mechanicus-dark', value: '#0f172a' },
        { name: 'light', value: '#f3f4f6' }
      ]
    },
    layout: 'centered'
  },
  decorators: [
    (Story, context) => (
      <PublicThemeProvider>
        <div
          className={`min-h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)] ${context.parameters.layout === 'fullscreen' ? '' : 'p-6'}`}
        >
          <Story />
        </div>
      </PublicThemeProvider>
    )
  ]
}

export default preview
