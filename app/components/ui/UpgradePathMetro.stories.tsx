import type { Meta, StoryObj } from '@storybook/react-vite'
import { UpgradePathMetro } from '@/app/(dashboard)/meta-atlas/components/UpgradePathMetro'
import { METRO_FIXTURE_PROPS } from './upgrade-path-metro.fixture'

/**
 * Qualification fixture for the Personal Potential upgrade path. The panel
 * paints its own dark surface on every theme, so it opts into `scheme-dark`
 * and keeps explicit foreground colours. Synthetic names and numbers only;
 * the light page is the case that matters, the dark page is the control.
 */

const meta: Meta = {
  title: 'UI/Upgrade path metro',
  parameters: { layout: 'fullscreen' }
}

export default meta

type Story = StoryObj

function Surface({
  scheme,
  children
}: {
  scheme: 'light' | 'dark' | 'theme'
  children: React.ReactNode
}) {
  // 'theme' follows the active application theme (set localStorage
  // theme-override before load); the other two pin the page colours.
  const pinned = scheme !== 'theme'
  return (
    <section
      data-fixture={scheme}
      style={
        pinned
          ? {
              colorScheme: scheme,
              backgroundColor: scheme === 'light' ? '#ffffff' : '#0f172a',
              color: scheme === 'light' ? '#111827' : '#f1f5f9'
            }
          : {
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)'
            }
      }
      className="space-y-6 p-6"
    >
      <p className="text-sm">Page surface: {scheme}</p>
      {children}
    </section>
  )
}

function Path() {
  return <UpgradePathMetro {...METRO_FIXTURE_PROPS} />
}

export const PersonalPotentialLight: Story = {
  render: () => (
    <Surface scheme="light">
      <Path />
    </Surface>
  )
}

export const PersonalPotentialDark: Story = {
  render: () => (
    <Surface scheme="dark">
      <Path />
    </Surface>
  )
}

export const PersonalPotentialActiveTheme: Story = {
  render: () => (
    <Surface scheme="theme">
      <Path />
    </Surface>
  )
}
