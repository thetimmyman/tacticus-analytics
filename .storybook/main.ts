import type { StorybookConfig } from '@storybook/react-vite'
import { resolve } from 'node:path'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  stories: ['../app/components/ui/**/*.stories.@(ts|tsx|mdx)'],
  addons: [
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
    '@storybook/addon-vitest'
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {}
  },
  staticDirs: ['../public'],
  docs: {
    autodocs: 'tag'
  },
  viteFinal: async (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        alias: {
          '@': resolve(process.cwd())
        }
      }
    })
}

export default config
