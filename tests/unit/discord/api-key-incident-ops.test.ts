import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendApiKeyIncidentOpsAlert } from '@/app/lib/services/api-key-incident-ops'

const rollup = {
  noRecipientEscalationDays: 7,
  staleInvalidKeyIncidentsWithoutRecipients: 2,
  oldestStaleInvalidKeyIncidentDays: 9
}
const fetchMock = vi.fn()

describe('API key incident operations delivery', () => {
  beforeEach(() => {
    vi.stubEnv(
      'MONITORING_WEBHOOK_URL',
      'https://discord.com/api/webhooks/synthetic/token'
    )
    vi.stubEnv('DISCORD_ALERTS_ENABLED', 'true')
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('posts the rollup and requires confirmation of a saved message', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'synthetic-message' }))

    await expect(sendApiKeyIncidentOpsAlert(rollup)).resolves.toEqual({
      status: 'delivered',
      messageId: 'synthetic-message'
    })

    const [url, request] = fetchMock.mock.calls[0]
    expect(new URL(url).searchParams.get('wait')).toBe('true')
    expect(request.method).toBe('POST')
    const payload = JSON.parse(request.body)
    expect(payload.allowed_mentions).toEqual({ parse: [] })
    expect(payload.embeds[0].description).toContain(
      '2 invalid API key incident(s)'
    )
    expect(payload.embeds[0].description).toContain('more than 7 days')
    expect(payload.embeds[0].fields).toContainEqual({
      name: 'Oldest incident (days)',
      value: '9',
      inline: true
    })
    expect(payload.embeds[0].description).toContain('Operations must arrange')
  })

  it('sends nothing when there are no stale incidents', async () => {
    await expect(
      sendApiKeyIncidentOpsAlert({
        ...rollup,
        staleInvalidKeyIncidentsWithoutRecipients: 0
      })
    ).resolves.toEqual({ status: 'not-needed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['', 'false'])(
    'fails visibly if operations alerts are disabled (%s)',
    async (enabled) => {
      vi.stubEnv('DISCORD_ALERTS_ENABLED', enabled)
      await expect(sendApiKeyIncidentOpsAlert(rollup)).rejects.toThrow(
        'not enabled/configured'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('fails visibly when the operations webhook is missing', async () => {
    vi.stubEnv('MONITORING_WEBHOOK_URL', '')
    await expect(sendApiKeyIncidentOpsAlert(rollup)).rejects.toThrow(
      'not enabled/configured'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([429, 500])(
    'does not acknowledge an HTTP %s failure',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('', { status }))
      await expect(sendApiKeyIncidentOpsAlert(rollup)).rejects.toThrow(
        'operations delivery failed'
      )
    }
  )

  it('does not acknowledge a response without a saved message ID', async () => {
    fetchMock.mockResolvedValue(Response.json({}))
    await expect(sendApiKeyIncidentOpsAlert(rollup)).rejects.toThrow(
      'operations delivery failed'
    )
  })

  it('keeps webhook credentials out of network failure messages', async () => {
    fetchMock.mockRejectedValue(
      new Error(
        'network error https://discord.com/api/webhooks/synthetic/token'
      )
    )
    await expect(sendApiKeyIncidentOpsAlert(rollup)).rejects.toThrow(
      /^API key incident operations delivery failed$/
    )
  })
})
