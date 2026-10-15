import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import MonitorTelemetryStrip from '@/app/(dashboard)/_components/MonitorTelemetryStrip'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('identifies filtered webhook log counts without presenting them as provider API calls', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        last_poll_at: null,
        poll_cadence_seconds: 60,
        api_calls_24h: 12,
        errors_24h: 3
      })
    )
  )
  render(<MonitorTelemetryStrip />)
  expect(await screen.findByText('12')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByText('Webhook logs (24h)')).toBeInTheDocument()
  expect(screen.getByText('Failed webhook logs (24h)')).toBeInTheDocument()
  expect(screen.queryByText('API Calls (24h)')).not.toBeInTheDocument()
})

it('leaves measured cadence unavailable when the response only provides a legacy interval', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        last_poll_at: '2026-01-01T00:00:00.000Z',
        poll_cadence_seconds: 60,
        api_calls_24h: 12,
        errors_24h: 3
      })
    )
  )
  render(<MonitorTelemetryStrip />)
  const cadence = await screen.findByText('Cadence')
  expect(cadence.parentElement).toHaveTextContent('Unavailable')
  expect(cadence.parentElement).not.toHaveTextContent('1 min')
})
