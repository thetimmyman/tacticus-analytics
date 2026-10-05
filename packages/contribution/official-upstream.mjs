const ORIGIN = 'https://api.tacticusgame.com'

export class OfficialGuildRaidSource {
  constructor({ fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.fetch = fetchImpl
    this.now = now
  }
  async fetchGuildRaid(credential, season) {
    if (!Number.isSafeInteger(season) || season < 0)
      throw new Error('Invalid season')
    const get = async (path) => {
      const response = await this.fetch(`${ORIGIN}${path}`, {
        method: 'GET',
        redirect: 'error',
        headers: { 'X-API-KEY': credential, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        const error = new Error('Official API unavailable')
        error.code = response.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE'
        throw error
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('Missing official response')
      let size = 0
      const chunks = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 4 * 1024 * 1024) {
          await reader.cancel()
          throw new Error('Official response exceeds limit')
        }
        chunks.push(value)
      }
      const text = Buffer.concat(chunks).toString('utf8')
      return JSON.parse(text)
    }
    const guild = await get('/api/v1/guild'),
      raid = await get(`/api/v1/guildRaid/${season}`)
    return {
      guild: guild.guild,
      raid,
      fetchedAt: new Date(this.now()).toISOString()
    }
  }
}
