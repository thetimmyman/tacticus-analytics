import type { StorybookConfig } from '@storybook/react-vite'
import { resolve } from 'node:path'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  stories: [
    '../app/components/ui/**/*.stories.@(ts|tsx|mdx)',
    '../app/components/navigation/**/*.stories.@(ts|tsx|mdx)'
  ],
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
          '@': resolve(process.cwd()),
          // Resolve the workspace package to this checkout, not to whichever
          // checkout installed the root node_modules link.
          '@tacticus/ui-kit': resolve(
            process.cwd(),
            'packages/ui-kit/src/index.ts'
          ),
          'next/navigation': resolve(
            process.cwd(),
            '.storybook/stubs/next-navigation.ts'
          )
        }
      }
    })
}

export default config
