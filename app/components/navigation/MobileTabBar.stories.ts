import type { Meta, StoryObj } from '@storybook/react-vite'
import { MobileTabBar } from './MobileTabBar'
import { workspaces } from './workspaces'

const meta = {
  title: 'Navigation/MobileTabBar',
  component: MobileTabBar,
  parameters: { layout: 'fullscreen' }
} satisfies Meta<typeof MobileTabBar>

export default meta
type Story = StoryObj<typeof meta>

/** All five marked workspaces, as the phone shell renders them. */
export const FiveTabs: Story = {
  args: { workspaces, currentSeason: null }
}
