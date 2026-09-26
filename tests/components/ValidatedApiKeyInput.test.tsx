import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {
  InputHTMLAttributes,
  ButtonHTMLAttributes,
  LabelHTMLAttributes
} from 'react'
import { ValidatedApiKeyInput } from '@/app/components/validation/ValidatedApiKeyInput'

vi.mock('@tacticus/ui-kit', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Label: (props: LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('ValidatedApiKeyInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders instructions by default', () => {
    render(<ValidatedApiKeyInput value="" onChange={vi.fn()} />)

    expect(screen.getByText(/How to get your API key/i)).toBeInTheDocument()
  })

  it('validates a guild API key successfully', async () => {
    const onValidationChange = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        summary: { message: 'All good' }
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    render(
      <ValidatedApiKeyInput
        value="GUILD-KEY"
        onChange={vi.fn()}
        onValidationChange={onValidationChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /validate/i }))

    expect(await screen.findByText('API Key Valid!')).toBeInTheDocument()
    expect(screen.getByText('All good')).toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith(true, 'All good')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/guild/test-api-key',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('validates a player API key failure', async () => {
    const onValidationChange = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        message: 'Bad key'
      })
    })

    vi.stubGlobal('fetch', fetchMock)

    render(
      <ValidatedApiKeyInput
        value="PLAYER-KEY"
        onChange={vi.fn()}
        onValidationChange={onValidationChange}
        validationScope="player"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /validate/i }))

    expect(await screen.findByText('Validation Failed')).toBeInTheDocument()
    expect(screen.getByText('Bad key')).toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith(false, 'Bad key')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/player/test-api-key',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('handles validation network errors', async () => {
    const onValidationChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network')))

    render(
      <ValidatedApiKeyInput
        value="KEY"
        onChange={vi.fn()}
        onValidationChange={onValidationChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /validate/i }))

    expect(
      await screen.findByText(/Failed to validate API key/i)
    ).toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith(
      false,
      'Failed to validate API key. Please try again.'
    )
  })
})
