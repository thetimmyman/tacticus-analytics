const status = document.querySelector('#status')
async function refresh(value) {
  if (!value.capabilities)
    throw new Error(value.error ?? 'Local state is unavailable.')
  document.querySelector('#personal').textContent = JSON.stringify(
    value.personal ?? 'Player access required',
    null,
    2
  )
  status.textContent = `${value.status}; Guild: ${value.capabilities.Guild ?? 'optional'}; Guild Raid: ${value.capabilities['Guild Raid'] ?? 'optional'}. Previously synced data remains readable offline.`
}
async function request(operation, body, retry = true) {
  const response = await fetch(`/desktop/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const value = await response.json()
  // Native main renews the session through its private channel. A chosen file stays in the supervisor.
  if (!response.ok && value.code === 'ESESSION' && retry)
    return request(operation, body, false)
  if (!response.ok) throw new Error(value.error)
  return value
}
for (const [id, operation] of [
  ['connect', 'connect-official'],
  ['skip', 'skip-optional'],
  ['guild', 'connect-official'],
  ['raid', 'connect-official'],
  ['reuse', 'connect-official'],
  ['disconnect', 'disconnect/player'],
  ['export', 'export-personal'],
  ['import', 'import-personal']
]) {
  document.querySelector(`#${id}`).addEventListener('click', async () => {
    status.textContent = 'Opening secure native input…'
    try {
      const body =
        id === 'guild'
          ? { requested: ['Guild'] }
          : id === 'raid'
            ? { requested: ['Guild', 'Guild Raid'] }
            : id === 'reuse'
              ? { reuse: true }
              : {}
      const value = await request(operation, body)
      if (value.exported) status.textContent = `Exported ${value.filename}`
      else await refresh(value)
    } catch (error) {
      status.textContent = error.message
    }
  })
}
document.querySelector('#demo').addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const value = await request('demo-setup', {
      sample: document.querySelector('#sample').checked
    })
    location.href = value.destination
  } catch (error) {
    status.textContent = error.message
  }
})
fetch('/desktop/official-state')
  .then((response) => response.json())
  .then(refresh)
  .catch((error) => {
    status.textContent = error.message
  })
