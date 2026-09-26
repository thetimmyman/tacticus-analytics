import type { ReactElement, ReactNode } from 'react'
import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export interface ProvidersOptions extends Omit<RenderOptions, 'queries'> {
  queryClient?: QueryClient
}

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: false
      }
    }
  })

export function renderWithProviders(
  ui: ReactElement,
  { queryClient = createTestQueryClient(), ...options }: ProvidersOptions = {}
) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options })
  }
}
