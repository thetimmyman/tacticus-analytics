import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ButtonHTMLAttributes,
  ComponentProps,
  Dispatch,
  ReactNode,
  SetStateAction
} from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ClusterCreationWizard from '@/app/(dashboard)/clusters/create/ClusterCreationWizard'
import type { ClusterData } from '@/app/(dashboard)/clusters/create/_lib/cluster-types'

interface StepBasicInfoMockProps {
  data: ClusterData
  setData: Dispatch<SetStateAction<ClusterData>>
}

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock })
}))

vi.mock('@tacticus/ui-kit', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  )
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/components/ui/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onCancel,
    onConfirm
  }: {
    open: boolean
    title: string
    description?: ReactNode
    confirmLabel?: string
    cancelLabel?: string
    onCancel: () => void
    onConfirm: () => void
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {description}
        <button onClick={onCancel}>{cancelLabel}</button>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null
}))

vi.mock('@/app/(dashboard)/clusters/create/_components/StepBasicInfo', () => ({
  StepBasicInfo: ({ data, setData }: StepBasicInfoMockProps) => (
    <>
      <label>
        Cluster code
        <input
          aria-label="Cluster code"
          value={data.clusterCode}
          onChange={(event) =>
            setData((current) => ({
              ...current,
              clusterCode: event.target.value
            }))
          }
        />
      </label>
      <label>
        Display name
        <input
          aria-label="Display name"
          value={data.displayName}
          onChange={(event) =>
            setData((current) => ({
              ...current,
              displayName: event.target.value
            }))
          }
        />
      </label>
    </>
  )
}))

vi.mock('@/app/(dashboard)/clusters/create/_components/StepBranding', () => ({
  StepBranding: () => <div data-testid="branding" />
}))

vi.mock('@/app/(dashboard)/clusters/create/_components/StepDiscord', () => ({
  StepDiscord: () => <div data-testid="discord" />
}))

vi.mock('@/app/(dashboard)/clusters/create/_components/StepSettings', () => ({
  StepSettings: () => <div data-testid="settings" />
}))

vi.mock(
  '@/app/(dashboard)/clusters/create/_components/StepSetupMethod',
  () => ({ StepSetupMethod: () => <div data-testid="setup-method" /> })
)

vi.mock('@/app/(dashboard)/clusters/create/_components/StepReview', () => ({
  StepReview: () => <div data-testid="review" />
}))

describe('ClusterCreationWizard completion state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const finishCreationAndDismiss = async (
    props: ComponentProps<typeof ClusterCreationWizard> = {}
  ) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cluster: { cluster_code: 'TEST' },
        setupMethod: 'direct'
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<ClusterCreationWizard {...props} />)

    fireEvent.change(screen.getByLabelText('Cluster code'), {
      target: { value: 'TEST' }
    })
    fireEvent.change(screen.getByLabelText('Display name'), {
      target: { value: 'Test Cluster' }
    })

    for (let step = 0; step < 5; step++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    }

    fireEvent.click(screen.getByRole('button', { name: /create cluster/i }))

    expect(
      await screen.findByRole('dialog', { name: 'Cluster created' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    return fetchMock
  }

  it('keeps completion durable and can continue to the cluster later', async () => {
    const fetchMock = await finishCreationAndDismiss()

    expect(
      screen.getByText(/Cluster TEST created with 0 founding guilds/)
    ).toBeInTheDocument()
    const completedButton = screen.getByRole('button', {
      name: /cluster created/i
    })
    expect(completedButton).toBeDisabled()

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(continueButton)
    fireEvent.click(continueButton)

    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/leaderboards?cluster=TEST')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invokes onClusterCreated once when continuing after dismissal', async () => {
    const onClusterCreated = vi.fn()
    const fetchMock = await finishCreationAndDismiss({ onClusterCreated })

    const continueButton = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(continueButton)
    fireEvent.click(continueButton)

    expect(onClusterCreated).toHaveBeenCalledTimes(1)
    expect(onClusterCreated).toHaveBeenCalledWith({
      cluster_code: 'TEST',
      inviteCode: undefined,
      setupMethod: 'direct'
    })
    expect(pushMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: /cluster created/i })
    ).toBeDisabled()
  })
})
