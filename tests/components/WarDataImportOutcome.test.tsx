import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WarDataImport from '@/app/(dashboard)/wars/_components/WarDataImport'

/** The paste clears only when the response is ok and `success !== false`. */
describe('WarDataImport outcome handling (PS-413)', () => {
  const pastedJson = JSON.stringify({
    wars: [
      {
        war_id: 'war-1',
        opponent_guild_name: 'Enemy Guild',
        war_status: 'completed'
      }
    ]
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function pasteAndGetTextarea() {
    render(<WarDataImport guildCode="TESTGUILD" userRole="leader" />)
    const textarea = screen.getByPlaceholderText(
      /war_id/
    ) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: pastedJson } })
    return textarea
  }

  it('keeps the pasted text when the server reports 200 success:false', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: false,
          message: '1 row(s) failed and were not imported.',
          counts: { wars: 0, zones: 0, attempts: 0, participation: 0 }
        })
    })

    const textarea = pasteAndGetTextarea()
    fireEvent.click(screen.getByRole('button', { name: /Import Data/i }))

    await waitFor(() =>
      expect(screen.getByText(/row\(s\) failed/i)).toBeInTheDocument()
    )
    expect(textarea.value).toBe(pastedJson)
  })

  it('keeps the pasted text when the server reports a non-2xx (502) failure', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      text: async () =>
        JSON.stringify({
          success: false,
          error:
            'Import failed — 1 row(s) could not be saved and nothing was imported.'
        })
    })

    const textarea = pasteAndGetTextarea()
    fireEvent.click(screen.getByRole('button', { name: /Import Data/i }))

    await waitFor(() =>
      expect(screen.getByText(/could not be saved/i)).toBeInTheDocument()
    )
    expect(textarea.value).toBe(pastedJson)
  })

  // A Cloudflare 5xx replaces JSON with an HTML page.
  it('shows a controlled generic message — never raw HTML — for a real HTML 502 response, and retains the paste', async () => {
    const htmlBody =
      '<!DOCTYPE html><html><head><title>502</title></head><body>error code: 502</body></html>'
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(htmlBody, {
        status: 502,
        headers: { 'content-type': 'text/html' }
      })
    )

    const textarea = pasteAndGetTextarea()
    fireEvent.click(screen.getByRole('button', { name: /Import Data/i }))

    await waitFor(() =>
      expect(screen.getByText(/unreadable response/i)).toBeInTheDocument()
    )
    expect(document.body.innerHTML).not.toContain('<!DOCTYPE html>')
    expect(document.body.innerHTML).not.toContain('error code: 502')
    expect(textarea.value).toBe(pastedJson)
  })

  it('shows a controlled generic message for a real empty-body 502 response, and retains the paste', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('', { status: 502 })
    )

    const textarea = pasteAndGetTextarea()
    fireEvent.click(screen.getByRole('button', { name: /Import Data/i }))

    await waitFor(() =>
      expect(screen.getByText(/unreadable response/i)).toBeInTheDocument()
    )
    expect(textarea.value).toBe(pastedJson)
  })

  it('shows a controlled generic message for a real invalid-JSON 502 response, and retains the paste', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{not valid json', {
        status: 502,
        headers: { 'content-type': 'application/json' }
      })
    )

    const textarea = pasteAndGetTextarea()
    fireEvent.click(screen.getByRole('button', { name: /Import Data/i }))

    await waitFor(() =>
      expect(screen.getByText(/unreadable response/i)).toBeInTheDocument()
    )
    expect(textarea.value).toBe(pastedJson)
  })

  it('clears the pasted text when the server reports 200 success:true', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          message:
            'Imported 1 war(s), 0 zone(s), 0 attempt(s), 0 participation record(s)',
          counts: { wars: 1, zones: 0, attempts: 0, participation: 0 }
        })
    })

    const textarea = pasteAndGetTextarea()
    fireEvent.click(screen.getByRole('button', { name: /Import Data/i }))

    await waitFor(() => expect(textarea.value).toBe(''))
  })
})
