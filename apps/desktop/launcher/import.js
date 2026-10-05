import { parseRaidFile } from './raid-file-validation.mjs'
const form = document.querySelector('form')
async function analyticsLink() {
  const response = await fetch('/desktop/workspace-info')
  if (!response.ok) return
  const info = await response.json()
  const link = document.querySelector('#analytics')
  if (info?.guildCode && Number.isInteger(info.season)) {
    link.href = `/player-performance?guild=${encodeURIComponent(info.guildCode)}&season=${info.season}`
    link.hidden = false
  }
}
analyticsLink().catch(() => {})
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const status = document.querySelector('#import-status'),
    button = form.querySelector('button')
  button.disabled = true
  status.textContent = 'Validating your local file…'
  try {
    const file = document.querySelector('#raid-file').files[0]
    if (!file || file.size > 8 * 1024 * 1024)
      throw new Error('Choose a raid JSON file no larger than 8 MiB.')
    const contents = await file.text()
    parseRaidFile(contents)
    const response = await fetch('/desktop/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents
      })
    })
    const result = await response.json()
    if (!response.ok)
      throw new Error(
        result.error || 'Import failed. Existing data was preserved.'
      )
    document.querySelector('#raid-file').value = ''
    status.textContent = `Imported ${result.inserted} new records from ${result.entries} entries${result.repeated ? ' (file already imported)' : ''}.`
    await analyticsLink()
  } catch (error) {
    status.textContent = error.message
  } finally {
    button.disabled = false
  }
})
