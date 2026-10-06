import { afterEach, expect, test, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import {
  ContributionControls,
  type ContributionControlAdapter
} from '../../packages/contribution/ContributionControls'

afterEach(cleanup)

test('no background calls; exact preview and separate enrollment consent are required', async () => {
  const adapter: ContributionControlAdapter = {
    changePolicy: vi.fn(async () => {}),
    inspectQueue: vi.fn(async () => 'No pending jobs'),
    previewFields: vi.fn(
      async () => 'Guild identifier, member identifier, season, damage; no keys'
    ),
    requestOfficialReadEnrollment: vi.fn(async () => {}),
    revokeEnrollment: vi.fn(async () => {}),
    deleteContributions: vi.fn(async () => {})
  }
  render(
    <ContributionControls
      initialPolicy={{
        revision: 0,
        enabled: false,
        paused: false,
        datasets: { raid: false, war: false, replay: false }
      }}
      adapter={adapter}
    />
  )
  for (const method of Object.values(adapter))
    expect(method).not.toHaveBeenCalled()
  expect(
    (screen.getByLabelText('Enable future contribution') as HTMLInputElement)
      .disabled
  ).toBe(true)
  expect(
    (
      screen.getByRole('button', {
        name: 'Enroll through secure input'
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview exact fields and identifiers' })
  )
  await waitFor(() =>
    expect(
      (screen.getByLabelText('Enable future contribution') as HTMLInputElement)
        .disabled
    ).toBe(false)
  )
  fireEvent.click(screen.getByLabelText('Enable future contribution'))
  await waitFor(() =>
    expect(adapter.changePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1, enabled: true })
    )
  )
  expect(adapter.requestOfficialReadEnrollment).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByLabelText(
      'I separately consent to official read credential enrollment for verification.'
    )
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Enroll through secure input' })
  )
  await waitFor(() =>
    expect(adapter.requestOfficialReadEnrollment).toHaveBeenCalledOnce()
  )
  expect(screen.queryByLabelText(/API key/)).toBeNull()
})
