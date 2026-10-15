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
