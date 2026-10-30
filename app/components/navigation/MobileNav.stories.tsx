import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { MobileNav } from './MobileNav'

const meta: Meta<typeof MobileNav> = {
  id: 'navigation-mobile-nav',
  title: 'Navigation/MobileNav',
  component: MobileNav,
  parameters: { layout: 'fullscreen' }
}
export default meta
type Story = StoryObj<typeof meta>

function ExampleNavigation({
  role,
  inactive = false
}: {
  role: 'member' | 'officer'
  inactive?: boolean
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false }
        }
      })
  )
  const [signedOut, setSignedOut] = useState(false)
  if (signedOut)
    return (
      <p role="status" className="p-4">
        Example signed out.
      </p>
    )
  return (
    <QueryClientProvider client={client}>
      <MobileNav
        user={{ id: `example-${inactive ? 'inactive' : role}-user` }}
        profile={
          inactive
            ? null
            : {
                display_name: 'Example Vanguard with a long display name',
                guild_code: 'EXAMPLE',
                role
              }
        }
        effectiveRole={inactive ? 'onboarding' : role}
        hasProfile={!inactive}
        currentSeason="112"
        onLogout={() => setSignedOut(true)}
      />
      <div className="mobile-page-bottom-reserve safe-x">
        <main className="p-4">
          <h1 className="text-lg font-semibold">Example guild overview</h1>
          <p className="mt-2 text-sm">
            Synthetic navigation fixture. No live account or data source is
            connected.
          </p>
        </main>
      </div>
    </QueryClientProvider>
  )
}

export const Member: Story = {
  render: () => <ExampleNavigation role="member" />
}
export const Officer: Story = {
  render: () => <ExampleNavigation role="officer" />
}
export const InactiveAccount: Story = {
  render: () => <ExampleNavigation role="member" inactive />
}
