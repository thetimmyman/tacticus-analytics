import type { StorybookConfig } from '@storybook/nextjs-vite'
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
    name: '@storybook/nextjs-vite',
    options: {}
  },
  staticDirs: ['../public'],
  docs: {
    autodocs: 'tag'
  },
  viteFinal: async (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        alias: [
          {
            find: /^@\/app\/lib\/db\/client$/,
            replacement: resolve(
              process.cwd(),
              '.storybook/fixtures/db-client.ts'
            )
          },
          { find: '@', replacement: resolve(process.cwd()) },
          // Resolve the workspace package to this checkout, not to whichever
          // checkout installed the root node_modules link.
          {
            find: /^@tacticus\/ui-kit$/,
            replacement: resolve(process.cwd(), 'packages/ui-kit/src/index.ts')
          }
        ]
      }
    })
}

export default config
