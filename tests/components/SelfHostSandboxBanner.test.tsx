import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SelfHostSandboxBanner from '@/app/components/environment/SelfHostSandboxBanner'

const ENV_KEY = 'NEXT_PUBLIC_SELFHOST_SANDBOX_MODE'
const originalValue = process.env[ENV_KEY]

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = originalValue
  }
})

describe('SelfHostSandboxBanner', () => {
  it('renders the banner when sandbox mode is enabled', () => {
    process.env[ENV_KEY] = 'true'

    render(<SelfHostSandboxBanner />)

    expect(
      screen.getByText('SANDBOX MODE - DATA NOT SAVED TO PRODUCTION')
    ).toBeInTheDocument()
  })

  it('renders nothing when sandbox mode is disabled', () => {
    process.env[ENV_KEY] = 'false'

    const { container } = render(<SelfHostSandboxBanner />)

    expect(container).toBeEmptyDOMElement()
  })
})
